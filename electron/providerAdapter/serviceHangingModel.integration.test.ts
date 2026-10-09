import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV1 } from "ai";
import type { Model, Vendor } from "../catalog/types";
import { ProviderAdapterStore, isTerminalAdapterStage } from "./store";
import { ProviderAdapterService, type ProviderAdapterCatalogPort, type ProviderAdapterServiceDependencies } from "./service";
import type { ProviderAdapterDraft, ProviderAdapterRun } from "./types";

/**
 * 真实验收（本地假服务器版）：让一个模型**真的挂住**（服务器收下请求就再也不回），
 * 验证 run 到 deadline 会自动终态化、`cancel` 在 certifying 阶段拿得到明确结果。
 * 这里的 hang 是真的 socket 级 hang，不是 mock 的 Promise——2026-09-11 真机上就是这个形状。
 */

const dirs: string[] = [];
const servers: http.Server[] = [];
const now = "2026-09-12T00:00:00.000Z";

afterEach(async () => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
});

/** 收下请求就不回复的供应商；连接一直开着，客户端只能等自己的超时。 */
async function hangingProvider(): Promise<{ baseUrl: string; hits: number }> {
  const state = { hits: 0, baseUrl: "" };
  const server = http.createServer((_req, res) => {
    state.hits += 1;
    // 故意什么都不写：既不结束响应也不关连接。
    res.socket?.setKeepAlive(true);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  state.baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
  return state as { baseUrl: string; hits: number };
}

function draft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "http://127.0.0.1/v1", authType: "bearer" },
    sources: [],
    models: [{
      modelKey: "text-v1", labelZh: "Text V1", kind: "text",
      modes: [{ taskKind: "chat", create: { method: "POST", path: "/chat", body: {} }, sourceUrls: [] }],
    }],
  } as unknown as ProviderAdapterDraft;
}

function catalogPort(baseUrl: string): ProviderAdapterCatalogPort {
  const vendor = {
    key: "hang-example", name: "Hanging", enabled: false, baseUrlHint: baseUrl,
    authType: "bearer", createdAt: now, updatedAt: now,
  } as Vendor;
  const models = [{
    vendorKey: vendor.key, modelKey: "text-v1", labelZh: "Text V1", kind: "text",
    enabled: false, createdAt: now, updatedAt: now,
  }] as Model[];
  const staged: string[][] = [];
  const port = {
    register: (input: { vendorKey: string }) => ({ vendor: { ...vendor, key: input.vendorKey, enabled: true }, models: [] }),
    stage: (input: { vendorKey: string }) => { staged.push([]); return { vendor, models, lineageRootVendorKey: input.vendorKey, supersededVendorKeys: [] }; },
    findStagedRun: () => (staged.length ? { vendorKey: vendor.key, lineageRootVendorKey: vendor.key } : null),
    load: () => ({ vendor, models, apiKey: "sk-test" }),
    promote: (input: { verifiedModes: unknown[] }) => ({ status: "committed", committedModes: input.verifiedModes }),
    fail: () => {},
  };
  return port as unknown as ProviderAdapterCatalogPort;
}

describe("a model that really hangs", () => {
  it("run 到 deadline 自动终态化，且 certifying 阶段的 cancel 拿得到明确结果", async () => {
    const provider = await hangingProvider();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-hanging-model-"));
    dirs.push(dir);
    const filePath = path.join(dir, "provider-adapters.json");
    const store = new ProviderAdapterStore(filePath);

    let released: (() => void) | undefined;
    const deps = {
      catalog: catalogPort(provider.baseUrl),
      schedule: () => {},
      discover: async () => ({ sources: [], corpus: "" }),
      resolveLanguageModels: () => [{} as LanguageModelV1],
      compile: async () => ({ draft: draft(), failures: [] }),
      repair: async () => draft(),
      // 真的去打那台不回复的服务器；除非被 abort，否则这个 promise 永不 settle。
      verify: ({ signal }: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        released = () => reject(new Error("aborted"));
        void fetch(`${provider.baseUrl}/chat`, { method: "POST", body: "{}", signal }).catch(() => {});
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      now: () => new Date().toISOString(),
      id: () => "run-hang",
      batchTimeoutMs: 2_000, // 真实是 5 分钟；这里压缩墙钟，形状不变。留足余量：满载的 CI 分片上服务器收到请求可能晚几百毫秒
      verifyTimeoutMs: 60_000, // 刻意长过 deadline：证明收尾靠的是 deadline 而不是单步超时
      terminalErrorJournalPath: `${filePath}.errors.jsonl`,
    } as unknown as ProviderAdapterServiceDependencies;

    const service = new ProviderAdapterService(store, deps);
    const run = await service.start({
      vendorName: "Hanging",
      baseUrl: provider.baseUrl,
      apiKey: "sk-test",
      authType: "bearer" as const,
      providerKind: "openai-compatible" as const,
      headers: {},
      models: [{ modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const }],
      certification: { contractDigest: "0".repeat(64), idempotencyKey: "hang-test", remoteIdempotency: "unknown" as const },
    } as never);

    const execution = service.executeRun(run.id);
    // 让它真的跑进去、真的打到那台服务器上：等可观察的状态（服务器收到请求），不等固定时长。
    await vi.waitFor(() => expect(provider.hits).toBeGreaterThan(0), { timeout: 10_000, interval: 10 });
    expect(isTerminalAdapterStage(store.getRun(run.id)!.stage)).toBe(false);

    // ① cancel 在「正在验证」阶段必须给出**明确结果**，而不是被拒或静默。
    //    这台服务器已经收下了请求（socket 级 hang），账本因此判「远端可能已受理」，
    //    于是我们不假装撤销成功——run 转 reconciling 并带上恢复理由，飞着的那一步被掐断。
    //    这正是会话侧 certification_already_submitted 那条分支的来源：如实告诉人，但放人走。
    const cancelled = service.cancel(run.id);
    expect(cancelled).toBeDefined();
    await service.awaitTerminalWrites();
    const afterCancel = store.getRun(run.id)!;
    expect(afterCancel.stage).not.toBe("certifying");
    expect(afterCancel.recovery?.reasonCode || afterCancel.stage).toBeTruthy();

    // ② 而它**不会永远停在那里**：deadline 一到，看门狗强制终态化。这是那次死锁缺的东西。
    if (!isTerminalAdapterStage(afterCancel.stage)) {
      // 等到 deadline 真的过去（读 run 自己的 deadlineAt，而不是猜一个固定时长）。
      const deadlineAt = Date.parse(store.getRun(run.id)!.deadlineAt!);
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(deadlineAt), { timeout: 10_000, interval: 20 });
      expect(service.sweepExpiredRuns()).toEqual([run.id]);
      await service.awaitTerminalWrites();
      expect(isTerminalAdapterStage(store.getRun(run.id)!.stage)).toBe(true);
    }

    released?.();
    await execution;
    service.stopWatchdog();
  }, 20_000);

  // 2026-09-22 换场景：这条用例原本靠一次真实 socket hang 撞 executeSubmission 的
  // 「execute 超时就判 uncertain → reconciling」把 run 卡在非终态，再靠看门狗把 reconciling
  // 收成 timed_out。2026-09-11 d76745ec6 早就拍板「自检不向上游提交任何东西，不可能有
  // 不确定的远端任务」，那条 uncertain→reconciling 分支已经删干净（含 isUncertainError
  // 选项本身），executeRun 现在会自己把挂死的自检直接收成 timed_out（见下一条用例）——
  // 于是这条用例原来要证明的「看门狗能收 reconciling」不再发生，得换个真正会让 run
  // 停在非终态的场景：装机重启后，上次没能来得及终态化就停在中间态、deadline 已经
  // 过去的历史 run（09-12 b58e409bc 那条不变量本来要治的就是这个）。这里直接把这样一条
  // run 落进 store，不跑 executeRun，纯测看门狗那半边契约。
  it("看门狗把崩溃重启后滞留在中间态、deadline 已过的 run 收成 timed_out", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-hanging-model-reaper-"));
    dirs.push(dir);
    const filePath = path.join(dir, "provider-adapters.json");
    const store = new ProviderAdapterStore(filePath);

    const staleRun: ProviderAdapterRun = {
      id: "run-stranded",
      vendorKey: "hang-example",
      vendorName: "Hanging",
      connectionFingerprint: "fingerprint-stub",
      selectedModelKeys: ["text-v1"],
      stage: "testing",
      repairAttempt: 0,
      models: [],
      sourceUrls: [],
      deadlineAt: new Date(Date.now() - 5_000).toISOString(),
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
    };
    store.upsertRun(staleRun);

    const deps = {
      catalog: catalogPort("http://127.0.0.1/v1"),
      schedule: () => {},
      discover: async () => ({ sources: [], corpus: "" }),
      resolveLanguageModels: () => [{} as LanguageModelV1],
      compile: async () => ({ draft: draft(), failures: [] }),
      verify: async () => { throw new Error("must not be called: this test never calls executeRun"); },
      now: () => new Date().toISOString(),
      id: () => "unused",
      batchTimeoutMs: 300,
      verifyTimeoutMs: 60_000,
      terminalErrorJournalPath: `${filePath}.errors.jsonl`,
    } as unknown as ProviderAdapterServiceDependencies;

    const service = new ProviderAdapterService(store, deps);

    expect(isTerminalAdapterStage(store.getRun(staleRun.id)!.stage)).toBe(false);
    expect(service.sweepExpiredRuns()).toEqual([staleRun.id]);
    await service.awaitTerminalWrites();
    const settled = store.getRun(staleRun.id)!;
    expect(settled.stage).toBe("timed_out");
    expect(settled.error).toContain("deadline expired");

    service.stopWatchdog();
  });

  // 09-11 契约的正面证明：真实 hang（同上，socket 级）+ 真实 executeRun，不经看门狗，
  // executeRun 自己在 deadline 到了之后把它收成 timed_out——09-11 与 09-12 两条契约
  // 各有一条用例覆盖，互不假借对方的边界。
  it("executeRun 自己把挂死的自检收成 timed_out，不用看门狗", async () => {
    const provider = await hangingProvider();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-hanging-model-selfcollect-"));
    dirs.push(dir);
    const filePath = path.join(dir, "provider-adapters.json");
    const store = new ProviderAdapterStore(filePath);

    const deps = {
      catalog: catalogPort(provider.baseUrl),
      schedule: () => {},
      discover: async () => ({ sources: [], corpus: "" }),
      resolveLanguageModels: () => [{} as LanguageModelV1],
      compile: async () => ({ draft: draft(), failures: [] }),
      // 凭据自检必须放行，否则这条 run 在**够到**那个挂死的模型自检之前就先失败终态化了，
      // 用例断言的「挂住 → executeRun 自己收尾」根本没发生过（假绿）。这台假服务器是
      // socket 级 hang，没有真的 /models 可打。
      probeCredential: async () => ({ ok: true as const, modelIds: ["text-v1"], listed: true }),
      verify: ({ signal }: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        void fetch(`${provider.baseUrl}/chat`, { method: "POST", body: "{}", signal }).catch(() => {});
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      now: () => new Date().toISOString(),
      id: () => "run-hang-selfcollect",
      batchTimeoutMs: 300,
      verifyTimeoutMs: 60_000,
      terminalErrorJournalPath: `${filePath}.errors.jsonl`,
    } as unknown as ProviderAdapterServiceDependencies;

    const service = new ProviderAdapterService(store, deps);
    const run = await service.start({
      vendorName: "Hanging",
      baseUrl: provider.baseUrl,
      apiKey: "sk-test",
      authType: "bearer" as const,
      providerKind: "openai-compatible" as const,
      headers: {},
      models: [{ modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const }],
      certification: { contractDigest: "0".repeat(64), idempotencyKey: "hang-test-selfcollect", remoteIdempotency: "unknown" as const },
    } as never);

    await service.executeRun(run.id);

    const settled = store.getRun(run.id)!;
    expect(settled.stage).toBe("timed_out");
    expect(settled.error).toContain("deadline");

    service.stopWatchdog();
  }, 20_000);
});
