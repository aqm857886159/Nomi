import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LanguageModelV1 } from "ai";
import type { Model, Vendor } from "../catalog/types";
import { ProviderAdapterStore, isTerminalAdapterStage } from "./store";
import { ProviderAdapterService, type ProviderAdapterCatalogPort, type ProviderAdapterServiceDependencies } from "./service";
import { readTerminalWriteFailures } from "./terminalGuarantee";
import type { ProviderAdapterDraft, ProviderAdapterRun } from "./types";

const dirs: string[] = [];
const now = "2026-09-12T00:00:00.000Z";
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function draft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "https://api.example.com/v1", authType: "bearer" },
    sources: [{ url: "https://docs.example.com/api", evidence: "API reference" }],
    models: [{
      modelKey: "text-v1", labelZh: "Text V1", kind: "text",
      modes: [{
        taskKind: "chat",
        create: { method: "POST", path: "/chat", body: { prompt: "{{request.prompt}}" }, response_mapping: { text: "text" } },
        sourceUrls: ["https://docs.example.com/api"],
      }],
    }],
  } as unknown as ProviderAdapterDraft;
}

function fakeCatalog(): ProviderAdapterCatalogPort & {
  promoted: Array<{ verified: string[]; draft: ProviderAdapterDraft }>;
  failed: string[];
  staged: string[][];
} {
  const vendor: Vendor = {
    key: "api-example-com",
    name: "Example",
    enabled: false,
    baseUrlHint: "https://api.example.com/v1",
    authType: "bearer",
    createdAt: now,
    updatedAt: now,
  };
  const models: Model[] = [
    { vendorKey: vendor.key, modelKey: "text-v1", labelZh: "Text V1", kind: "text", enabled: false, createdAt: now, updatedAt: now },
    { vendorKey: vendor.key, modelKey: "paint-v2", labelZh: "Paint V2", kind: "image", enabled: false, createdAt: now, updatedAt: now },
    { vendorKey: vendor.key, modelKey: "paint-v3", labelZh: "Paint V3", kind: "image", enabled: false, createdAt: now, updatedAt: now },
    { vendorKey: vendor.key, modelKey: "mesh-v1", labelZh: "Mesh V1", kind: "model3d", enabled: false, createdAt: now, updatedAt: now },
  ];
  return {
    promoted: [],
    failed: [],
    staged: [],
    register(input) {
      return {
        vendor: { ...vendor, key: input.vendorKey, enabled: true },
        models: input.models.map((selected) => ({
          vendorKey: input.vendorKey,
          modelKey: selected.modelKey,
          labelZh: selected.labelZh || selected.modelKey,
          kind: selected.kind,
          enabled: true,
          meta: { adapter: { state: "unverified", modes: [], updatedAt: input.savedAt } },
          createdAt: input.savedAt,
          updatedAt: input.savedAt,
        })),
      };
    },
    stage(input) {
      this.staged.push(input.models.map((model) => model.modelKey));
      return { vendor, models, lineageRootVendorKey: input.vendorKey, supersededVendorKeys: [] };
    },
    findStagedRun(_runId) {
      return this.staged.length ? { vendorKey: vendor.key, lineageRootVendorKey: vendor.key } : null;
    },
    // 与真实 defaultCatalog.load 一致：按本次选中的模型过滤（分级要靠它判断有没有媒体模型）。
    load(_vendorKey, selectedModelKeys) {
      const selected = new Set(selectedModelKeys);
      return { vendor, models: models.filter((model) => selected.has(model.modelKey)), apiKey: "sk-test" };
    },
    promote(input) {
      this.promoted.push({
        verified: input.verifiedModes.map((item) => `${item.modelKey}/${item.taskKind}`),
        draft: input.draft,
      });
      return { status: "committed", committedModes: input.verifiedModes };
    },
    fail(run) {
      this.failed.push(run.id);
    },
  };
}

const startInput = {
  vendorName: "Example",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  authType: "bearer" as const,
  providerKind: "openai-compatible" as const,
  headers: {},
  models: [{ modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const }],
  certification: {
    contractDigest: "0".repeat(64),
    idempotencyKey: "failure-path-test",
    remoteIdempotency: "unknown" as const,
  },
};

function harness(overrides: Partial<ProviderAdapterServiceDependencies> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-failure-path-"));
  dirs.push(dir);
  const filePath = path.join(dir, "provider-adapters.json");
  const store = new ProviderAdapterStore(filePath);
  const deps: ProviderAdapterServiceDependencies = {
    catalog: fakeCatalog(),
    schedule: () => {},
    discover: async () => ({ sources: [{ url: "https://docs.example.com/api", text: "API reference" }], corpus: "API reference" }),
    resolveLanguageModels: () => [{} as LanguageModelV1],
    compile: async () => ({ draft: draft(), failures: [] }),
    repair: async () => draft(),
    verify: async ({ mode }) => ({ ok: true, taskKind: mode.taskKind }),
    now: () => new Date().toISOString(),
    id: () => "run-failure-path",
    terminalErrorJournalPath: `${filePath}.errors.jsonl`,
    // 真实档位 3s/6s/12s/24s（合计 45s > 30s 租约）；测试按同样形状压缩墙钟，测的是逻辑。
    terminalWriteBackoffMs: [31_000, 31_000],
    terminalWriteTimer: (callback: () => void) => setTimeout(callback, 20),
    ...overrides,
  } as ProviderAdapterServiceDependencies;
  return { store, filePath, service: new ProviderAdapterService(store, deps), journalPath: `${filePath}.errors.jsonl` };
}

function plantLease(filePath: string, expiresInMs: number): void {
  fs.writeFileSync(`${filePath}.lock`, `${JSON.stringify({
    schemaVersion: 1, ownerId: "someone-else", pid: process.pid + 1,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    fencingEpoch: 1, nonce: "planted",
  })}\n`, "utf8");
}

describe("run failure path is as strong as the main path", () => {
  it("executeRun 不再把失败漏成 unhandled rejection，终态写被锁挡住也一定留下账", async () => {
    const { service, store, filePath, journalPath } = harness({
      catalog: Object.assign(fakeCatalog(), {
        load: () => { throw new Error("provider credentials vanished"); },
      }) as unknown as ProviderAdapterCatalogPort,
    });
    const run = await service.start(startInput);

    // 终态写的那一下正好撞上别人持锁 —— 就是 2026-09-11 死锁的现场。
    plantLease(filePath, 60_000);
    // 旧代码在这里会变成 unhandled rejection，run 永久停在中间态。现在必须正常 resolve。
    await expect(service.executeRun(run.id)).resolves.toBeUndefined();

    // 等重试链落定（等的是 promise 不是墙钟）。写还是进不去 —— 但**必须响**：旁路留一条。
    await service.awaitTerminalWrites();
    expect(isTerminalAdapterStage(store.getRun(run.id)!.stage)).toBe(false);
    const journal = readTerminalWriteFailures(journalPath);
    expect(journal.map((entry) => entry.runId)).toEqual([run.id]);
    expect(journal[0]?.writeError).toContain("lock timed out");

    // 「重启」：锁没了，resumeInterrupted 的补偿扫描必须把它收成终态并清账。
    fs.rmSync(`${filePath}.lock`, { force: true });
    service.resumeInterrupted();
    expect(store.getRun(run.id)).toMatchObject({ stage: "failed", error: "provider credentials vanished" });
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
    service.stopWatchdog();
  });

  it("看门狗把 deadline 过期的非终态 run 强制 timed_out", async () => {
    const { service, store } = harness();
    const run = await service.start(startInput);
    // 把 deadline 拨到过去：真实世界里这发生在「某个模型 hang 住、批次压线」时。
    store.updateRun(run.id, (current): ProviderAdapterRun => ({
      ...current,
      stage: "testing",
      deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    expect(service.sweepExpiredRuns()).toEqual([run.id]);
    const settled = store.getRun(run.id)!;
    expect(settled.stage).toBe("timed_out");
    expect(settled.error).toContain("deadline expired");
    service.stopWatchdog();
  });

  it("看门狗不碰 deadline 还没到的 run", async () => {
    const { service, store } = harness();
    const run = await service.start(startInput);
    store.updateRun(run.id, (current): ProviderAdapterRun => ({
      ...current,
      stage: "testing",
      deadlineAt: new Date(Date.now() + 600_000).toISOString(),
    }));
    expect(service.sweepExpiredRuns()).toEqual([]);
    expect(store.getRun(run.id)!.stage).toBe("testing");
    service.stopWatchdog();
  });
});
