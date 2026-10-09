/**
 * 阳性对照：**确定没写出去**（连上之前就失败：连不上 / DNS）的提交，不许被记成「供应商可能已经收下」；
 * 反过来**连上之后才断**（UND_ERR_SOCKET / 连接被重置）的提交，一定不许被当成没写出去、更不许自动重发。
 *
 * 历史：2026-09-18 起 UND_ERR_SOCKET 被当成「没写出去」（为了治 keep-alive 复用到死连接），
 * 2026-10-02 真应用复现它会让不支持幂等的供应商收到两笔——这一类改判为「结果未知」，
 * 「旧连接」由付费提交每次新建连接从构造上消掉。下面的用例换成**连上之前**的失败来钉原来那三件事：
 *   ① 这一镜落在**确定**的失败态 `needs_attention`（`provider_not_reached`），不是
 *      `submission_unknown`（那一档的意思是「可能已扣费、只能人工对账、绝不自动重提」）；
 *   ② 这一笔的预算预留被 **provider-safe 地释放**（钱一分没花），不是挂成 `unsettled`；
 *   ③ 一镜失败**不带走整批**：兄弟镜照常派发、照常轮询、照常落地，Run 如实落到
 *      `needs_attention` 而不是停在 `running` 装死。
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Session } from "electron";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { createProductionRunService } from "./productionRunService";
import { decideShotClaim } from "../shared/decideShotClaim";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import type { ProductionGenerationShot } from "./productionRunTypes";
import { applySystemProxy, createFreshConnectionDispatcher } from "../systemProxy";
import { describeOutboundFailure } from "../outboundDispatchEvidence";
import { setSubmitOutboundDepsForTests } from "../vendor/vendorOutboundGuard";
import { landingThatBinds } from "./landFirstTestUtils";

const roots: string[] = [];
const now = () => new Date(Date.parse("2026-09-18T00:00:00.000Z")).toISOString();

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["image-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }],
  }],
}]);

/** 连不上：undici 的 `TypeError: fetch failed`，cause 是 connect ECONNREFUSED——请求一个字节都没写出去。 */
function connectRefusedFailure(): Error {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED", syscall: "connect" });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

/** 连上之后对面关了连接：和「写出去后被重置」抛出来的码一模一样，必须当「结果未知」。 */
function socketClosedFailure(): Error {
  const cause = Object.assign(new Error("other side closed"), { name: "SocketError", code: "UND_ERR_SOCKET", socket: { bytesWritten: 0, bytesRead: 0 } });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

function candidate(id: string, prompt: string): PlanCandidate {
  return { candidateId: id, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt, parameters: {}, references: [] };
}

function shotEntry(shotId: string, prompt: string): ProductionGenerationShot {
  const cand = candidate(`cand-${shotId}`, prompt);
  const contract = compileExecutionContract(cand, registry);
  return { shotId, candidate: { ...cand, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

/** 回环供应商的行为由 `failFor` 决定：它对某一镜的第 n 次提交抛「没写出去」那个错。 */
function provider(
  submits: string[],
  failFor: (idempotencyKey: string, attemptIndex: number) => boolean,
  options: { failure?: () => Error; idempotent?: boolean } = {},
): GenerationProvider {
  const attempts = new Map<string, number>();
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: options.idempotent ?? true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      const index = (attempts.get(idempotencyKey) ?? 0) + 1;
      attempts.set(idempotencyKey, index);
      submits.push(idempotencyKey);
      if (failFor(idempotencyKey, index)) throw (options.failure ?? connectRefusedFailure)();
      return { providerTaskId: `task-${submits.length}`, raw: { ok: true } };
    },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/project-1/${providerTaskId}.png` }] }),
  };
}

function setup(shots: ProductionGenerationShot[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-not-dispatched-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === "project-1" ? root : null), now });
  repository.createGenerationDraft({
    operationId: "op-batch", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: shots[0].candidate,
    // Sealing approves existing draft identities; it cannot introduce new shots.
    shots: shots.map(({ shotId, candidate: sealedCandidate, updatedAt }) => {
      const { sealedContractHash: _hash, ...candidate } = sealedCandidate;
      return { shotId, candidate, updatedAt };
    }),
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 2 },
  });
  sealAndApproveProductionGeneration({
    repository, projectId: "project-1", operationId: "op-batch",
    immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!,
    providers: [{
      providerId: "apimart",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input,
      submit: async () => ({ providerTaskId: "unused" }),
    }],
    multiShot: { shots, scope: shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId), planHash: "plan-hash-not-dispatched" },
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    receiptId: "receipt-plan",
    now: now(),
  });
  repository.execute("project-1", "op-batch", { commandId: "submit", expectedRevision: 2, type: "generation.submit", payload: {}, issuedAt: now() });
  return { root, repository };
}

function scheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, generationProvider: GenerationProvider) {
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", provider: generationProvider,
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now,
  });
  return createMultiShotBatchScheduler({
    repository, landShots: landingThatBinds(repository), submission, projectId: "project-1", runId: "op-batch",
    now,
  });
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("提交请求根本没写出去时（连不上）", () => {
  it("这一镜进确定的 needs_attention、预留被安全释放、整批不被带走", async () => {
    const shots = [shotEntry("shot-1", "a"), shotEntry("shot-2", "b"), shotEntry("shot-3", "c"), shotEntry("shot-4", "d")];
    const { root, repository } = setup(shots);
    const submits: string[] = [];
    // 只有第三镜、且只在它**每一次**提交时失败：这样即使将来加了「重发一次」，
    // 本条断言的对象（最终仍然失败的那一镜）不会变。
    const failing = provider(submits, (key) => key.includes("shot-3"));

    const outcome = await scheduler(root, repository, failing).runToQuiescence();
    expect(outcome).toBeTruthy(); // ③ 驱动必须正常收口，不是抛出去把整批带走

    const run = repository.read("project-1", "op-batch")!;
    const jobFor = (shotId: string) => run.jobs.find((job) => job.metadata?.shotId === shotId)!;

    // ① 确定态，不是「供应商可能已经收下」
    expect(jobFor("shot-3").status).toBe("needs_attention");
    expect(jobFor("shot-3").errorCode).toBe("provider_not_reached");
    expect(run.jobs.filter((job) => job.status === "submission_unknown")).toHaveLength(0);

    // ② 钱一分没花 ⇒ 预留 provider-safe 释放，不挂成 unsettled
    const ledger = repository.readBudgetLedger("project-1", "op-batch");
    const reservation = Object.entries(ledger.reservations).find(([id]) => id.includes("shot-3"))?.[1];
    expect(reservation?.status).toBe("released");
    expect(run.budget.unsettled).toBe(0);

    // ③ 兄弟镜照常跑完（没被这一镜带走），Run 如实落到 needs_attention 而不是停在 running
    for (const shotId of ["shot-1", "shot-2", "shot-4"]) {
      expect(["ready", "adopted"]).toContain(jobFor(shotId).status);
    }
    expect(run.status).toBe("needs_attention");
  });

  it("只是一次抖动时：确定没发出去 → 同一个幂等键重发一次就过，整批照常跑完", async () => {
    // 与上一条的唯一区别：这一镜只在**第一次**失败（连不上），第二次连上了。
    const shots = [shotEntry("shot-1", "a"), shotEntry("shot-2", "b"), shotEntry("shot-3", "c"), shotEntry("shot-4", "d")];
    const { root, repository } = setup(shots);
    const submits: string[] = [];
    const flaky = provider(submits, (key, index) => key.includes("shot-3") && index === 1);

    await scheduler(root, repository, flaky).runToQuiescence();

    const run = repository.read("project-1", "op-batch")!;
    for (const shotId of ["shot-1", "shot-2", "shot-3", "shot-4"]) {
      expect(["ready", "adopted"]).toContain(run.jobs.find((job) => job.metadata?.shotId === shotId)!.status);
    }
    expect(run.jobs.filter((job) => job.status === "submission_unknown")).toHaveLength(0);
    expect(run.status).not.toBe("needs_attention");
    // 第三镜发了两次，而且是**同一个幂等键**——重发不是第二次下单。
    const shot3 = submits.filter((key) => key.includes("shot-3"));
    expect(shot3).toHaveLength(2);
    expect(new Set(shot3).size).toBe(1);
    // 别的镜各一次，没有被连累重发。
    for (const shotId of ["shot-1", "shot-2", "shot-4"]) {
      expect(submits.filter((key) => key.includes(shotId))).toHaveLength(1);
    }
  });

});

describe("连上之后才断（结果未知）：不能当没写出去，更不能盲目重发", () => {
  const four = () => [shotEntry("shot-1", "a"), shotEntry("shot-2", "b"), shotEntry("shot-3", "c"), shotEntry("shot-4", "d")];
  const jobFor = (run: NonNullable<ReturnType<ReturnType<typeof createProductionRunRepository>["read"]>>, shotId: string) =>
    run.jobs.find((job) => job.metadata?.shotId === shotId)!;

  it("供应商不支持幂等：一次都不重发，这一镜是 submission_unknown，预留挂 unsettled", async () => {
    const { root, repository } = setup(four());
    const submits: string[] = [];
    const resetting = provider(submits, (key) => key.includes("shot-3"), { failure: socketClosedFailure, idempotent: false });

    await scheduler(root, repository, resetting).runToQuiescence();

    const run = repository.read("project-1", "op-batch")!;
    expect(jobFor(run, "shot-3").status).toBe("submission_unknown");
    expect(submits.filter((key) => key.includes("shot-3"))).toHaveLength(1);
    const ledger = repository.readBudgetLedger("project-1", "op-batch");
    expect(Object.entries(ledger.reservations).find(([id]) => id.includes("shot-3"))?.[1].status).not.toBe("released");
  });

  it("供应商真支持幂等：同一个键最多重发一次，重发成功就过", async () => {
    const { root, repository } = setup(four());
    const submits: string[] = [];
    const idempotent = provider(submits, (key, index) => key.includes("shot-3") && index === 1, { failure: socketClosedFailure, idempotent: true });

    await scheduler(root, repository, idempotent).runToQuiescence();

    const shot3 = submits.filter((key) => key.includes("shot-3"));
    expect(shot3).toHaveLength(2);
    expect(new Set(shot3).size).toBe(1);
    const run = repository.read("project-1", "op-batch")!;
    expect(["ready", "adopted"]).toContain(jobFor(run, "shot-3").status);
  });

  it("供应商真支持幂等但两次都被断：只发两次，最终是未知", async () => {
    const { root, repository } = setup(four());
    const submits: string[] = [];
    const idempotent = provider(submits, (key) => key.includes("shot-3"), { failure: socketClosedFailure, idempotent: true });

    await scheduler(root, repository, idempotent).runToQuiescence();

    expect(submits.filter((key) => key.includes("shot-3"))).toHaveLength(2);
    expect(jobFor(repository.read("project-1", "op-batch")!, "shot-3").status).toBe("submission_unknown");
  });

  it("先连不上（确定没发出去）、第二次连上却被断：最终是未知，不是「没发出去」", async () => {
    const { root, repository } = setup(four());
    const submits: string[] = [];
    const mixed = provider(submits, (key) => key.includes("shot-3"), { idempotent: false });
    const original = mixed.submit.bind(mixed);
    let calls = 0;
    mixed.submit = async (request, key) => {
      if (!key.includes("shot-3")) return original(request, key);
      calls += 1;
      submits.push(key);
      throw (calls === 1 ? connectRefusedFailure : socketClosedFailure)();
    };

    await scheduler(root, repository, mixed).runToQuiescence();

    const job = jobFor(repository.read("project-1", "op-batch")!, "shot-3");
    expect(calls).toBe(2);
    expect(job.status).toBe("submission_unknown");
    expect(job.errorCode).not.toBe("provider_not_reached");
  });

  it("连不上两次：最多重试一次，落「没发出去」", async () => {
    const { root, repository } = setup(four());
    const submits: string[] = [];
    const refused = provider(submits, (key) => key.includes("shot-3"), { idempotent: false });

    await scheduler(root, repository, refused).runToQuiescence();

    expect(submits.filter((key) => key.includes("shot-3"))).toHaveLength(2);
    expect(jobFor(repository.read("project-1", "op-batch")!, "shot-3").errorCode).toBe("provider_not_reached");
  });
});

/**
 * 宿主级（真闸）：供应商是本机 loopback 夹具，请求走真实的 requestJson → appFetch → undici → TCP，
 * 出站层一行都没 mock。四种连接层情形，逐条数「供应商到底收到几笔」：
 *   ① 读完请求再销毁 socket  ② 端口拒连  ③ 先拒连、再被收下后重置  ④ 支持幂等的供应商
 */
describe("宿主级：真实 socket 上付费提交的重发规则", () => {
  type FixtureMode = "destroy-after-read" | "accept" | "destroy-first-then-accept";
  const servers: http.Server[] = [];
  const sockets = new Set<net.Socket>();

  beforeAll(async () => {
    await applySystemProxy({ setProxy: async () => undefined } as unknown as Session, { mode: "off", customUrl: "" });
  });
  beforeEach(() => {
    setSubmitOutboundDepsForTests({
      resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      isApplicationProxyActive: () => false,
    });
  });
  afterEach(async () => {
    setSubmitOutboundDepsForTests(null);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  type Fixture = {
    origin: string;
    port: number;
    posts: Array<{ idempotencyHeader: string | undefined; body: string }>;
    reopen: (mode: FixtureMode) => Promise<void>;
  };

  async function fixture(mode: FixtureMode | "closed"): Promise<Fixture> {
    const posts: Fixture["posts"] = [];
    let current: FixtureMode = mode === "closed" ? "accept" : mode;
    const make = () => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          // 请求体读完才算「供应商收到」。
          posts.push({ idempotencyHeader: request.headers["idempotency-key"] as string | undefined, body: Buffer.concat(chunks).toString("utf8") });
          const destroy = current === "destroy-after-read" || (current === "destroy-first-then-accept" && posts.length === 1);
          if (destroy) { request.socket.destroy(); return; }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: [{ task_id: `task-${posts.length}` }] }));
        });
      });
      server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
      servers.push(server);
      return server;
    };
    let server = make();
    const listen = (port: number) => new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    await listen(0);
    const port = (server.address() as net.AddressInfo).port;
    if (mode === "closed") await new Promise<void>((resolve) => server.close(() => resolve()));
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      posts,
      reopen: async (next) => { current = next; server = make(); await listen(port); },
    };
  }

  /** 供应商适配器：真的 requestJson 打夹具；idempotent 决定档案声明 + 是否把键带到请求头上。 */
  function loopbackProvider(fx: Fixture, submitCalls: string[], options: { idempotent: boolean; afterFirstFailure?: () => Promise<void> }): GenerationProvider {
    return {
      providerId: "apimart",
      capabilities: { submitIdempotency: options.idempotent, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input,
      submit: async (_request, idempotencyKey) => {
        submitCalls.push(idempotencyKey);
        // 与生产适配器 apimartGenerationProvider 的 send 同一套原语：每次提交新连接的 dispatcher + fetch，
        // 失败时把 undici 的 cause 链原样挂在错误上（提交层靠它判「写出去没有」）。
        const url = `${fx.origin}/v1/generations`;
        const fresh = await createFreshConnectionDispatcher(undefined, url);
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", ...(options.idempotent ? { "Idempotency-Key": idempotencyKey } : {}) },
            body: JSON.stringify({ prompt: idempotencyKey }),
            dispatcher: fresh,
          } as RequestInit);
          const json = await response.json() as { data: Array<{ task_id: string }> };
          return { providerTaskId: json.data[0].task_id, raw: json };
        } catch (error) {
          if (submitCalls.length === 1 && options.afterFirstFailure) await options.afterFirstFailure();
          throw new Error(`apimart submission failed: ${describeOutboundFailure(error)}`, { cause: error });
        } finally {
          void fresh.close().catch(() => undefined);
        }
      },
      query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
      materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/project-1/${providerTaskId}.png` }] }),
    };
  }

  async function runOneShot(generationProvider: GenerationProvider) {
    const { root, repository } = setup([shotEntry("shot-1", "a")]);
    await scheduler(root, repository, generationProvider).runToQuiescence();
    const run = repository.read("project-1", "op-batch")!;
    return { run, job: run.jobs.find((job) => job.metadata?.shotId === "shot-1")! };
  }

  it("① 读完请求再销毁 socket：恰好 1 次 POST，状态「未知」", async () => {
    const fx = await fixture("destroy-after-read");
    const calls: string[] = [];
    const { job } = await runOneShot(loopbackProvider(fx, calls, { idempotent: false }));
    expect(fx.posts).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(job.status).toBe("submission_unknown");
    expect(job.errorCode).not.toBe("provider_not_reached");
  });

  it("⑤ 结果未知的镜：放行前画布不能生成；用户核对后放行 → 画布可以生成（走正常付费确认），放行本身不向供应商发任何请求", async () => {
    const fx = await fixture("destroy-after-read");
    const calls: string[] = [];
    const { root, repository } = setup([shotEntry("shot-1", "a")]);
    await scheduler(root, repository, loopbackProvider(fx, calls, { idempotent: false })).runToQuiescence();
    const run = () => repository.read("project-1", "op-batch")!;
    const job = () => run().jobs.find((candidate) => candidate.metadata?.shotId === "shot-1")!;
    expect(job().status).toBe("submission_unknown");
    expect(decideShotClaim(run(), "shot-1", "canvas")).toMatchObject({ granted: false, reason: "needs_reconcile" });

    const service = createProductionRunService({ repository, projectRootResolver: () => root });
    const base = { commandId: "release-1", expectedRevision: run().revision, type: "job.reconcile", payload: { jobId: job().jobId, outcome: "user_checked_abandon" }, issuedAt: "2026-10-02T12:00:00.000Z" };
    // 没有受信窗口的手势章（Agent / MCP 路径永远没有）：拒。
    await expect(service.command("project-1", "op-batch", base)).rejects.toThrow(/user gesture/);
    expect(job().status).toBe("submission_unknown");

    const before = fx.posts.length;
    await service.command("project-1", "op-batch", { ...base, humanGesture: true });
    expect(job()).toMatchObject({ status: "needs_attention", errorCode: "user_checked_abandoned" });
    expect(job().errorMessage).toContain("2026-10-02T12:00:00.000Z");
    expect(decideShotClaim(run(), "shot-1", "canvas")).toMatchObject({ granted: true });
    // 放行只是释放占用：不重发、不开拍（真正的生成要用户在付费确认卡上点）。
    expect(fx.posts.length).toBe(before);
    expect(calls).toHaveLength(1);
    const ledger = repository.readBudgetLedger("project-1", "op-batch");
    expect(Object.values(ledger.reservations).every((reservation) => reservation.status !== "unsettled")).toBe(true);
  });

  it("② 端口拒连：没有请求到达，状态「没发出去」，最多重试 1 次", async () => {
    const fx = await fixture("closed");
    const calls: string[] = [];
    const { job } = await runOneShot(loopbackProvider(fx, calls, { idempotent: false }));
    expect(fx.posts).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(job.status).toBe("needs_attention");
    expect(job.errorCode).toBe("provider_not_reached");
  });

  it("③ 先拒连、再被收下后重置：状态「未知」，不是「没发出去」", async () => {
    const fx = await fixture("closed");
    const calls: string[] = [];
    const { job } = await runOneShot(loopbackProvider(fx, calls, { idempotent: false, afterFirstFailure: () => fx.reopen("destroy-after-read") }));
    expect(calls).toHaveLength(2);
    expect(fx.posts).toHaveLength(1);
    expect(job.status).toBe("submission_unknown");
    expect(job.errorCode).not.toBe("provider_not_reached");
  });

  it("④ 支持幂等的供应商：被重置后同一个键最多重发 1 次，供应商两次收到的是同一个键", async () => {
    const fx = await fixture("destroy-first-then-accept");
    const calls: string[] = [];
    const { job } = await runOneShot(loopbackProvider(fx, calls, { idempotent: true }));
    expect(fx.posts).toHaveLength(2);
    expect(new Set(fx.posts.map((post) => post.idempotencyHeader)).size).toBe(1);
    expect(fx.posts[0].idempotencyHeader).toBeTruthy();
    expect(["ready", "adopted"]).toContain(job.status);
  });

  it("④b 支持幂等的供应商但两次都被重置：只发两次，最终「未知」", async () => {
    const fx = await fixture("destroy-after-read");
    const calls: string[] = [];
    const { job } = await runOneShot(loopbackProvider(fx, calls, { idempotent: true }));
    expect(fx.posts).toHaveLength(2);
    expect(job.status).toBe("submission_unknown");
  });
});
