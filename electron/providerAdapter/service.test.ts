import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV1 } from "ai";
import type { Model, Vendor } from "../catalog/types";
import type { ProviderAdapterDraft } from "./types";
import { ProviderAdapterStore } from "./store";
import type { AdapterVerificationResult } from "./verifier";
import { writeCertificationJsonAtomic } from "../integrationCertification/operationLedger";
import { OperationLedger } from "../integrationCertification/operationLedger";
import { certificationModeOperationKey } from "../integrationCertification/modeIdentity";
import { PromotionJournal } from "../integrationCertification/promotionJournal";
import {
  ProviderAdapterService,
  adapterModelMetadataForPromotion,
  prioritizeCompilerCandidates,
  type ProviderAdapterCatalogPort,
  type ProviderAdapterServiceDependencies,
} from "./service";
import {
  runCanonicalReservationRace,
  runCanonicalReservationTimeout,
} from "./tests/serviceReservationRaceFixture";
import { providedDocsUrn, resolveProviderDocs } from "./providedDocs";

type VerifyInput = Parameters<ProviderAdapterServiceDependencies["verify"]>[0];
type CompileInput = Parameters<ProviderAdapterServiceDependencies["compile"]>[0];

const dirs: string[] = [];
const now = "2026-08-07T00:00:00.000Z";

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function store(): ProviderAdapterStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-service-"));
  dirs.push(dir);
  return new ProviderAdapterStore(path.join(dir, "provider-adapters.json"));
}

function draft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "https://api.example.com/v1", authType: "bearer" },
    sources: [{ url: "https://docs.example.com/api", evidence: "API reference" }],
    models: [
      {
        modelKey: "text-v1",
        labelZh: "Text V1",
        kind: "text",
        modes: [
          {
            taskKind: "chat",
            create: { method: "POST", path: "/chat", body: { prompt: "{{request.prompt}}" }, response_mapping: { text: "text" } },
            sourceUrls: ["https://docs.example.com/api"],
          },
        ],
      },
      {
        modelKey: "paint-v2",
        labelZh: "Paint V2",
        kind: "image",
        modes: [
          {
            taskKind: "text_to_image",
            create: { method: "POST", path: "/images", body: { prompt: "{{request.prompt}}" } },
            sourceUrls: ["https://docs.example.com/api"],
          },
          {
            taskKind: "image_edit",
            create: { method: "POST", path: "/edits", body: { image: "{{request.params.referenceImages}}" } },
            referenceParam: "referenceImages",
            referenceShape: "array",
            sourceUrls: ["https://docs.example.com/api"],
          },
        ],
      },
    ],
  };
}

/**
 * 外部（驱动 Agent）交回来的说明卡：和上面的 draft() 不同，它必须**真的过得了**
 * validateProviderAdapterDraft——那正是这条路的全部安全性所在（编译器那条路的 draft() 走的是
 * compile mock，历史上从来没被真校验过）。
 */
function externalDraft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "https://api.example.com/v1", authType: "bearer" },
    sources: [{ url: "https://docs.example.com/api", evidence: "API reference" }],
    models: [
      {
        modelKey: "text-v1",
        labelZh: "Text V1",
        kind: "text",
        modes: [
          {
            taskKind: "chat",
            create: { method: "POST", path: "/chat", body: { prompt: "{{request.prompt}}" }, response_mapping: { text: "text" } },
            sourceUrls: ["https://docs.example.com/api"],
          },
        ],
      },
      {
        modelKey: "paint-v2",
        labelZh: "Paint V2",
        kind: "image",
        modes: [
          {
            taskKind: "text_to_image",
            create: {
              method: "POST",
              path: "/images",
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { image_url: "data.0.url" },
            },
            sourceUrls: ["https://docs.example.com/api"],
          },
        ],
      },
    ],
  };
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

function dependencies(catalog: ReturnType<typeof fakeCatalog>): ProviderAdapterServiceDependencies {
  return {
    catalog,
    schedule: () => {},
    discover: async () => ({
      sources: [{ url: "https://docs.example.com/api", text: "API reference" }],
      corpus: "API reference",
    }),
    resolveLanguageModels: () => [{} as LanguageModelV1],
    compile: async () => ({ draft: draft(), failures: [] }),
    probeCredential: async () => ({ ok: true as const, modelIds: [], listed: false }),
    verify: async ({ mode }) => ({ ok: true, taskKind: mode.taskKind }),
    now: () => now,
    id: () => "run-test",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const startInput = {
  vendorName: "Example",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  authType: "bearer" as const,
  providerKind: "openai-compatible" as const,
  headers: {},
  models: [
    { modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const },
    { modelKey: "paint-v2", labelZh: "Paint V2", kind: "image" as const },
  ],
  certification: {
    contractDigest: "0".repeat(64),
    idempotencyKey: "default-provider-adapter-test",
    remoteIdempotency: "unknown" as const,
  },
};

describe("ProviderAdapterService", () => {
  it("reports an unavailable pre-call credential probe without running or promoting a model", async () => {
    const catalog = fakeCatalog();
    catalog.load = async () => { throw new Error("credential still offline"); };
    const deps = dependencies(catalog);
    const verify = vi.spyOn(deps, "verify");
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, deps);
    const run = await service.start(startInput);
    await expect(service.executeRun(run.id)).resolves.toBeUndefined();
    expect(adapterStore.getRun(run.id)).toMatchObject({ stage: "failed", error: "credential still offline" });
    expect(verify).not.toHaveBeenCalled();
    expect(catalog.promoted).toEqual([]);
  });
  it("rejects direct starts that bypass the canonical certification contract", async () => {
    const service = new ProviderAdapterService(store(), dependencies(fakeCatalog()));
    const uncertified = { ...startInput } as Partial<typeof startInput>;
    delete uncertified.certification;

    await expect(service.start(uncertified as never)).rejects.toThrowError(/certification contract is required/i);
  });

  it("deduplicates across two real service instances before stage, store mutation, schedule, or provider create", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-two-services-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const catalog = fakeCatalog();
    const scheduled: Array<{ service: ProviderAdapterService; runId: string }> = [];
    const verify = vi.fn(async ({ mode }) => ({ ok: true as const, taskKind: mode.taskKind }));
    const firstDeps = dependencies(catalog);
    const secondDeps = dependencies(catalog);
    const services: { first?: ProviderAdapterService; second?: ProviderAdapterService } = {};
    firstDeps.id = () => "run-canonical";
    secondDeps.id = () => "run-duplicate";
    firstDeps.verify = verify;
    secondDeps.verify = verify;
    firstDeps.schedule = (runId) => scheduled.push({ service: services.first!, runId });
    secondDeps.schedule = (runId) => scheduled.push({ service: services.second!, runId });
    const firstService = services.first = new ProviderAdapterService(new ProviderAdapterStore(filePath), firstDeps);
    const secondService = services.second = new ProviderAdapterService(new ProviderAdapterStore(filePath), secondDeps);
    const certification = {
      contractDigest: "e".repeat(64),
      idempotencyKey: "two-service-canonical-start",
      remoteIdempotency: "unsupported" as const,
    };
    const input = { ...startInput, models: [startInput.models[0]], certification };

    const first = await firstService.start(input);
    const duplicate = await secondService.start(input);
    await Promise.all(scheduled.map(({ service, runId }) => service.executeRun(runId)));

    expect(duplicate.id).toBe(first.id);
    expect(catalog.staged).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(new ProviderAdapterStore(filePath).snapshot().runs.map((run) => run.id)).toEqual(["run-canonical"]);
  });

  it("keeps two different starts from real child processes without either store write overwriting the other", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-child-starts-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const workerPath = path.join(root, "start-worker.ts");
    const tsxCli = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
    const serviceModule = path.resolve(__dirname, "service.ts");
    const storeModule = path.resolve(__dirname, "store.ts");
    fs.writeFileSync(workerPath, `
      import { ProviderAdapterService } from ${JSON.stringify(serviceModule)};
      import { ProviderAdapterStore } from ${JSON.stringify(storeModule)};
      async function main() {
      const [filePath, suffix] = process.argv.slice(2);
      const vendorKey = \`vendor-\${suffix}\`;
      const modelKey = \`model-\${suffix}\`;
      const now = "2026-08-28T00:00:00.000Z";
      const catalog = {
        stage(input: any) {
          return {
            vendor: { key: vendorKey, name: vendorKey, enabled: false, baseUrlHint: input.baseUrl, authType: "bearer", createdAt: now, updatedAt: now },
            models: input.models.map((model: any) => ({ vendorKey, modelKey: model.modelKey, labelZh: model.labelZh, kind: model.kind, enabled: false, createdAt: now, updatedAt: now })),
            lineageRootVendorKey: vendorKey,
            supersededVendorKeys: [],
          };
        },
        load() { return null; },
        promote() { return { status: "no-lease" as const }; },
        fail() {},
      };
      const service = new ProviderAdapterService(new ProviderAdapterStore(filePath), {
        catalog: catalog as any,
        id: () => \`run-\${suffix}\`,
        now: () => now,
        schedule: () => {},
      });
      await service.start({
        vendorName: vendorKey,
        catalogVendorKey: vendorKey,
        baseUrl: \`https://\${vendorKey}.example/v1\`,
        apiKey: \`key-\${suffix}\`,
        authType: "bearer",
        models: [{ modelKey, labelZh: modelKey, kind: "text" }],
        certification: { contractDigest: suffix.repeat(64).slice(0, 64), idempotencyKey: \`start-\${suffix}\`, remoteIdempotency: "unsupported" },
      });
      }
      void main().catch((error) => { console.error(error); process.exitCode = 1; });
    `);
    const runChild = (suffix: "a" | "b") => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [tsxCli, workerPath, filePath, suffix], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
    });

    await Promise.all([runChild("a"), runChild("b")]);

    expect(new ProviderAdapterStore(filePath).snapshot().runs.map((run) => run.id).sort()).toEqual(["run-a", "run-b"]);
  }, 30_000);

  it("creates one canonical run for duplicate starts with the same immutable contract and idempotency key", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    let sequence = 0;
    deps.id = () => `run-${++sequence}`;
    deps.schedule = vi.fn();
    const service = new ProviderAdapterService(store(), deps);
    const certification = {
      contractDigest: "a".repeat(64),
      idempotencyKey: "confirm-example-models-1",
      remoteIdempotency: "unsupported" as const,
    };

    const first = await service.start({ ...startInput, certification });
    const duplicate = await service.start({ ...startInput, certification });

    expect(duplicate.id).toBe(first.id);
    expect(catalog.staged).toHaveLength(1);
    expect(deps.schedule).toHaveBeenCalledTimes(1);
  });

  it.each([
    "after_intent",
    "after_run_write",
    "after_run_checkpoint",
    "after_catalog_stage",
    "after_catalog_checkpoint",
    "after_commit",
  ] as const)("replays the prepared start transaction after a crash at %s", async (crashAt) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-start-tx-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const catalog = fakeCatalog();
    let sequence = 0;
    const deps = dependencies(catalog);
    deps.id = () => `run-${++sequence}`;
    deps.schedule = vi.fn();
    deps.certificationCheckpoint = (checkpoint) => {
      if (checkpoint === crashAt) throw new Error(`simulated crash at ${checkpoint}`);
    };
    const certification = {
      contractDigest: "c".repeat(64),
      idempotencyKey: `start-transaction-${crashAt}`,
      remoteIdempotency: "unsupported" as const,
    };

    await expect(new ProviderAdapterService(new ProviderAdapterStore(filePath), deps)
      .start({ ...startInput, certification })).rejects.toThrowError(/simulated crash/);
    delete deps.certificationCheckpoint;
    const restarted = new ProviderAdapterService(new ProviderAdapterStore(filePath), deps);
    restarted.resumeInterrupted();
    const recovered = await restarted.start({ ...startInput, certification });
    const state = new ProviderAdapterStore(filePath).snapshot();
    const ledgerText = fs.readFileSync(path.join(root, "integration-certification", "operations.json"), "utf8");
    const ledgerState = JSON.parse(ledgerText) as { operations: Array<{ startTransaction: { state: string } }> };

    expect(recovered.id).toBe("run-1");
    expect(state.runs.map((run) => run.id)).toEqual(["run-1"]);
    const safelyReplayable = ["after_catalog_stage", "after_catalog_checkpoint", "after_commit"].includes(crashAt);
    expect(ledgerState.operations[0].startTransaction.state).toBe(safelyReplayable ? "committed" : "rolled_back");
    expect(recovered.stage).toBe(safelyReplayable ? "queued" : "failed");
    expect(catalog.staged).toHaveLength(safelyReplayable ? 1 : 0);
    expect(ledgerText).not.toContain(certification.idempotencyKey);
  });

  it("rolls back a pre-stage intent on restart without leaving an orphan canonical id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-start-rollback-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.certificationCheckpoint = (checkpoint) => {
      if (checkpoint === "after_intent") throw new Error("crash after intent");
    };
    const certification = { contractDigest: "d".repeat(64), idempotencyKey: "rollback-intent", remoteIdempotency: "unknown" as const };
    await expect(new ProviderAdapterService(new ProviderAdapterStore(filePath), deps).start({ ...startInput, certification }))
      .rejects.toThrowError(/crash/);

    const schedule = vi.fn();
    const restarted = new ProviderAdapterService(new ProviderAdapterStore(filePath), { ...deps, certificationCheckpoint: undefined, schedule });
    restarted.resumeInterrupted();

    expect(restarted.getRun("run-test")).toMatchObject({
      stage: "failed",
      recovery: { reasonCode: "certification_start_rolled_back", userAction: "restart_certification" },
    });
    expect(schedule).not.toHaveBeenCalled();
    const ledgerState = JSON.parse(fs.readFileSync(path.join(root, "integration-certification", "operations.json"), "utf8"));
    expect(ledgerState.operations[0].startTransaction.state).toBe("rolled_back");
  });

  it("discovers an already-staged candidate after restart and commits the prepared transaction", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-start-stage-recovery-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const catalog = fakeCatalog();
    catalog.findStagedRun = () => catalog.staged.length
      ? { vendorKey: "api-example-com", lineageRootVendorKey: "api-example-com" }
      : null;
    const deps = dependencies(catalog);
    deps.certificationCheckpoint = (checkpoint) => {
      if (checkpoint === "after_catalog_stage") throw new Error("crash after catalog stage");
    };
    await expect(new ProviderAdapterService(new ProviderAdapterStore(filePath), deps).start(startInput)).rejects.toThrowError(/crash/);

    const schedule = vi.fn();
    const restarted = new ProviderAdapterService(new ProviderAdapterStore(filePath), { ...deps, certificationCheckpoint: undefined, schedule });
    restarted.resumeInterrupted();

    expect(restarted.getRun("run-test")?.stage).toBe("queued");
    expect(schedule).toHaveBeenCalledWith("run-test");
    const ledgerState = JSON.parse(fs.readFileSync(path.join(root, "integration-certification", "operations.json"), "utf8"));
    expect(ledgerState.operations[0].startTransaction.state).toBe("committed");
  });

  it("reconstructs a fail-closed canonical run when a committed start loses its run record", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-missing-committed-run-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.schedule = vi.fn();
    const first = new ProviderAdapterService(new ProviderAdapterStore(filePath), deps);
    const started = await first.start({
      ...startInput,
      certification: { contractDigest: "9".repeat(64), idempotencyKey: "missing-committed-run", remoteIdempotency: "unsupported" },
    });
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    persisted.runs = [];
    persisted.revision += 1;
    fs.writeFileSync(filePath, JSON.stringify(persisted));

    const restarted = new ProviderAdapterService(new ProviderAdapterStore(filePath), deps);
    restarted.resumeInterrupted();

    expect(restarted.getRun(started.id)).toMatchObject({
      id: started.id,
      stage: "failed",
      recovery: { reasonCode: "certification_start_rolled_back", userAction: "restart_certification" },
    });
  });


  it("binds idempotency to the credential, catalog lineage, and normalized custom-header identity", async () => {
    const catalog = fakeCatalog();
    const service = new ProviderAdapterService(store(), { ...dependencies(catalog), schedule: () => {} });
    const certification = {
      contractDigest: "f".repeat(64),
      idempotencyKey: "credential-bound-confirmation",
      remoteIdempotency: "supported" as const,
    };
    const first = await service.start({
      ...startInput,
      apiKey: "account-key-a",
      catalogVendorKey: "stable-lineage",
      headers: { "X-Account": "tenant-a", "X-Region": "cn" },
      certification,
    });

    expect((await service.start({
      ...startInput,
      apiKey: "account-key-a",
      catalogVendorKey: "stable-lineage",
      headers: { "x-region": "cn", "x-account": "tenant-a" },
      certification,
    })).id).toBe(first.id);
    await expect(service.start({
      ...startInput,
      apiKey: "account-key-b",
      catalogVendorKey: "stable-lineage",
      headers: { "X-Account": "tenant-a", "X-Region": "cn" },
      certification,
    })).rejects.toThrowError(/idempotency.*different contract|contract drift/i);
    await expect(service.start({
      ...startInput,
      apiKey: "account-key-a",
      catalogVendorKey: "stable-lineage",
      headers: { "X-Account": "tenant-b", "X-Region": "cn" },
      certification,
    })).rejects.toThrowError(/idempotency.*different contract|contract drift/i);
  });

  it("returns the cancelled original run when start races with cancel for the same idempotency key", async () => {
    const catalog = fakeCatalog();
    const service = new ProviderAdapterService(store(), { ...dependencies(catalog), schedule: () => {} });
    const certification = {
      contractDigest: "a".repeat(64),
      idempotencyKey: "confirm-cancel-race-1",
      remoteIdempotency: "unsupported" as const,
    };
    const first = await service.start({ ...startInput, certification });

    service.cancel(first.id);
    const duplicate = await service.start({ ...startInput, certification });

    expect(duplicate).toMatchObject({ id: first.id, stage: "cancelled" });
    expect(catalog.staged).toHaveLength(1);
  });

  it("keeps the catalog identity when adding models to an existing connection", async () => {
    const catalog = fakeCatalog();
    const originalStage = catalog.stage.bind(catalog);
    const stage = vi.spyOn(catalog, "stage").mockImplementation((input) => {
      const staged = originalStage(input);
      return { ...staged, vendor: { ...staged.vendor, key: input.vendorKey } };
    });
    const service = new ProviderAdapterService(store(), dependencies(catalog));

    const run = await service.start({
      ...startInput,
      catalogVendorKey: "my-user-assigned-provider-id",
      models: [startInput.models[1]],
    });

    expect(stage).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-user-assigned-provider-id",
      apiKey: "sk-test",
      models: [expect.objectContaining({ modelKey: "paint-v2" })],
    }));
    expect(run).toMatchObject({
      vendorKey: "my-user-assigned-provider-id",
      selectedModelKeys: ["paint-v2"],
    });
  });

  it("preserves the last-known-good model metadata when a new candidate has no verified mode", () => {
    const oldMeta = {
      parameters: [{ key: "quality", default: "stable" }],
      imageOptions: { supportsReferenceImages: true },
      adapter: { activeRevision: "revision-good" },
    };

    const next = adapterModelMetadataForPromotion({
      oldMeta,
      candidate: draft().models[1],
      modeResults: [{ taskKind: "text_to_image", state: "failed", attempts: 1, stage: "credential", selfCheckReason: "credential_rejected" }],
      runId: "run-new",
      revisionId: "revision-new",
      updatedAt: now,
    });

    expect(next.parameters).toEqual(oldMeta.parameters);
    expect(next.imageOptions).toEqual(oldMeta.imageOptions);
    expect(next.adapter).toMatchObject({ state: "failed", activeRevision: "revision-good" });
  });

  it("keeps a previously verified reference-image mode when a newer partial draft omits it", () => {
    const next = adapterModelMetadataForPromotion({
      oldMeta: {
        imageOptions: { supportsReferenceImages: true },
        adapter: { activeRevision: "revision-good" },
      },
      candidate: { ...draft().models[1], modes: [draft().models[1].modes[0]] },
      modeResults: [{ taskKind: "text_to_image", state: "verified", attempts: 1 }],
      runId: "run-new",
      revisionId: "revision-new",
      updatedAt: now,
    });

    expect(next.imageOptions).toMatchObject({ supportsReferenceImages: true });
  });

  it("tries one model per configured vendor before another model from the same failing vendor", () => {
    const candidates = [
      { vendorKey: "vendor-a", id: "a-1" },
      { vendorKey: "vendor-a", id: "a-2" },
      { vendorKey: "vendor-b", id: "b-1" },
      { vendorKey: "vendor-c", id: "c-1" },
    ];

    expect(prioritizeCompilerCandidates(candidates).map((candidate) => candidate.id)).toEqual([
      "a-1",
      "b-1",
      "c-1",
      "a-2",
    ]);
  });

  it("uses independent configured AI vendors before asking the provider under test to analyze itself", () => {
    const candidates = [
      { vendorKey: "target-vendor", id: "target" },
      { vendorKey: "vendor-a", id: "a-1" },
      { vendorKey: "vendor-b", id: "b-1" },
      { vendorKey: "vendor-a", id: "a-2" },
    ];

    expect(prioritizeCompilerCandidates(candidates, "target-vendor").map((candidate) => candidate.id)).toEqual([
      "a-1",
      "b-1",
      "a-2",
      "target",
    ]);
  });

  it("stages all selected models in one batch and promotes only verified modes", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.verify = async ({ mode }) =>
      mode.taskKind === "image_edit"
        ? { ok: false, taskKind: mode.taskKind, stage: "credential", selfCheckReason: "credential_rejected", error: "HTTP 400 image field" }
        : { ok: true, taskKind: mode.taskKind };
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start(startInput);

    await service.executeRun(started.id);

    expect(catalog.staged).toEqual([["text-v1", "paint-v2"]]);
    // 草稿次序＝先编译出来的媒体模型，再合入确定性的文本条目（分级，2026-08-12）。
    expect(catalog.promoted[0]?.verified).toEqual(["paint-v2/text_to_image", "text-v1/chat"]);
    expect(service.getRun(started.id)?.stage).toBe("partial");
  });

  // 回归钉子（2026-08-11 用户接 DeepSeek 踩到「自动修复一直失败」）：文本模型验证走
  // streamTextTask（生产同一条路）、根本不读编译出来的 HTTP 草稿，所以重修草稿对文本失败
  // 是个空操作——旧代码照样空转 2 轮、界面还写着「正在根据真实错误自动修复…」，用户白等。
  it("does not publish a failed candidate when no mode passed", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.compile = async () => ({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    deps.verify = async ({ mode }) => ({ ok: false, taskKind: mode.taskKind, stage: "credential", selfCheckReason: "credential_rejected", error: "HTTP 500" });
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(catalog.promoted).toEqual([]);
    expect(catalog.failed).toEqual([started.id]);
    expect(service.getRun(started.id)?.stage).toBe("failed");
  });

  it("does not persist a terminal success or revision when candidate cleanup fails", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.compile = async () => ({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    deps.verify = async ({ mode }) => ({ ok: false, taskKind: mode.taskKind, stage: "credential", selfCheckReason: "credential_rejected", error: "HTTP 500" });
    catalog.fail = () => {
      throw new Error("catalog cleanup failed");
    };
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await expect(service.executeRun(started.id)).rejects.toThrow("catalog cleanup failed");

    expect(catalog.promoted).toEqual([]);
    expect(adapterStore.snapshot().revisions).toEqual([]);
    expect(service.getRun(started.id)?.stage).not.toMatch(/^(completed|partial|failed|timed_out|cancelled|stale)$/);

    catalog.fail = function fail(run) {
      this.failed.push(run.id);
    };
    expect(service.cancel(started.id)?.stage).toBe("cancelled");
    expect(catalog.failed).toEqual([started.id]);
  });

  it("does not report completion when publishing the catalog result fails", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    catalog.promote = () => {
      throw new Error("catalog write failed");
    };
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)).toMatchObject({
      stage: "failed",
      error: "catalog write failed",
    });
    expect(catalog.failed).toEqual([started.id]);
  });

  it("keeps post-catalog journal failure in dedicated recovery and finalizes by fresh replay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-promotion-recovery-"));
    dirs.push(root);
    const filePath = path.join(root, "provider-adapters.json");
    const journalPath = path.join(root, "integration-certification", "promotion-journal.json");
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.compile = async () => ({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    let failedAfterCatalog = false;
    const journal = new PromotionJournal(journalPath, {
      write: (target, state) => {
        if (!failedAfterCatalog && state.entries.some((entry) => entry.state === "catalog_committed")) {
          failedAfterCatalog = true;
          throw new Error("simulated post-catalog journal fsync failure");
        }
        writeCertificationJsonAtomic(target, state);
      },
    });
    const first = new ProviderAdapterService(new ProviderAdapterStore(filePath), { ...deps, promotionJournal: journal });
    const started = await first.start({ ...startInput, models: [startInput.models[1]] });

    await first.executeRun(started.id);

    expect(first.getRun(started.id)).toMatchObject({
      stage: "reconciling",
      recovery: { reasonCode: "promotion_commit_unknown" },
    });
    expect(catalog.failed).toEqual([]);
    expect(catalog.promoted).toHaveLength(1);

    const restarted = new ProviderAdapterService(new ProviderAdapterStore(filePath), deps);
    restarted.resumeInterrupted();
    restarted.resumeInterrupted();

    expect(restarted.getRun(started.id)).toMatchObject({ stage: "completed", recovery: undefined });
    expect(catalog.failed).toEqual([]);
    expect(catalog.promoted).toHaveLength(2);
  });

  it("does not write completed state or a revision when promotion reports no lease", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    catalog.promote = () => ({ status: "no-lease" }) as never;
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("stale");
    expect(service.getRun(started.id)?.stage).not.toBe("completed");
    expect(adapterStore.snapshot().revisions).toEqual([]);
  });

  it("treats documentation discovery errors as missing optional evidence and verifies the generic contract", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = async () => {
      throw new Error("No official API documentation could be discovered");
    };
    deps.compile = vi.fn(deps.compile);
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(deps.compile).not.toHaveBeenCalled();
    expect(service.getRun(started.id)).toMatchObject({ stage: "completed" });
    expect(catalog.failed).toEqual([]);
    expect(catalog.promoted[0]?.draft.models[0]?.modes.map((mode) => mode.taskKind)).toEqual([
      "text_to_image",
      "image_edit",
    ]);
  });

  it("falls back to the generic contract when a custom public relay has no discoverable docs", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = async () => ({ sources: [], corpus: "" });
    deps.compile = vi.fn(deps.compile);
    deps.verify = async ({ mode }) => ({
      ok: false,
      taskKind: mode.taskKind,
      stage: "credential", selfCheckReason: "credential_rejected",
      error: "HTTP 404",
    });
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(deps.compile).not.toHaveBeenCalled();
    expect(catalog.failed).toEqual([started.id]);
    expect(catalog.promoted).toEqual([]);
    expect(service.getRun(started.id)?.stage).toBe("failed");
  });

  it("falls an uncompiled model back to the generic contract without blocking deterministic text", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    // 编译不出来的只可能是媒体模型——文本压根不进编译器（分级，2026-08-12）。
    deps.compile = async () => ({
      draft: { ...draft(), models: [] },
      failures: [{ modelKey: "paint-v2", error: "No documented image mode", reason: "docs_not_understood" as const }],
    });
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start(startInput);

    await service.executeRun(started.id);

    expect(catalog.promoted[0]?.verified).toEqual(expect.arrayContaining([
      "text-v1/chat",
      "paint-v2/text_to_image",
      "paint-v2/image_edit",
    ]));
    expect(service.getRun(started.id)).toMatchObject({
      stage: "completed",
      models: expect.arrayContaining([
        expect.objectContaining({
          modelKey: "paint-v2",
          modes: expect.arrayContaining([expect.objectContaining({ state: "verified" })]),
        }),
      ]),
    });
  });

  // 分级的核心不变量（2026-08-12）：文本的接法行业已统一，且文本验证走 streamTextTask、
  // 根本不读编译出来的草稿——查文档 + AI 编译对它是纯开销，还平添「文档没抓到 / 编译失败」
  // 这些真实使用路径没有的失败模式。用户接两个 DeepSeek 文本模型曾为此烧掉 132 秒后判死。
  it("never discovers docs or compiles when only text models were selected", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = vi.fn(async () => ({ sources: [{ url: "https://docs.example.com/api", text: "API reference" }], corpus: "API reference" }));
    deps.compile = vi.fn(async () => ({ draft: draft(), failures: [] }));
    deps.resolveLanguageModels = vi.fn(() => [{} as LanguageModelV1]);
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [{ modelKey: "text-v1", labelZh: "Text V1", kind: "text" as const }] });

    await service.executeRun(started.id);

    expect(deps.discover).not.toHaveBeenCalled();
    expect(deps.compile).not.toHaveBeenCalled();
    // 连「得先有个文本大脑」都不再需要——加第一个文本模型不该反过来要求已经有文本模型。
    expect(deps.resolveLanguageModels).not.toHaveBeenCalled();
    expect(catalog.promoted[0]?.verified).toEqual(["text-v1/chat"]);
    expect(service.getRun(started.id)?.stage).toBe("completed");
  });

  it("resumes pre-submission work after restart because no provider create can be duplicated", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    const schedule = vi.fn();
    deps.schedule = schedule;
    const adapterStore = store();
    const first = new ProviderAdapterService(adapterStore, { ...deps, schedule: () => {} });
    const started = await first.start(startInput);

    const restarted = new ProviderAdapterService(adapterStore, deps);
    restarted.resumeInterrupted();

    expect(schedule).toHaveBeenCalledWith(started.id);
    expect(restarted.getRun(started.id)).toMatchObject({
      stage: "queued",
    });
    expect(catalog.failed).toEqual([]);
  });

  it("persists bounded lifecycle progress when a run starts", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.batchTimeoutMs = 10_000;
    const service = new ProviderAdapterService(store(), deps);

    const started = await service.start(startInput);

    expect(started).toMatchObject({
      totalCount: 2,
      completedCount: 0,
      lastProgressAt: now,
      stageStartedAt: now,
      deadlineAt: "2026-08-07T00:00:10.000Z",
    });
  });

  it("falls back to the generic contract when optional documentation discovery times out", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = () => new Promise(() => {});
    deps.discoverTimeoutMs = 5;
    deps.batchTimeoutMs = 100;
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)).toMatchObject({
      stage: "completed",
      currentModelKey: undefined,
    });
    expect(catalog.failed).toEqual([]);
    expect(catalog.promoted[0]?.draft.models[0]?.modes).toHaveLength(2);
  });

  it("uses the batch deadline even when the current step allows more time", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = () => new Promise(() => {});
    deps.discoverTimeoutMs = 1_000;
    deps.batchTimeoutMs = 5;
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)).toMatchObject({
      stage: "timed_out",
      error: expect.stringContaining("deadline"),
    });
  });

  it("times out one model compilation, falls it back, and continues compiling later models", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    const compile = deferred<Awaited<ReturnType<ProviderAdapterServiceDependencies["compile"]>>>();
    deps.compile = vi.fn((input) => {
      const selected = input.selectedModels[0];
      if (selected?.modelKey === "paint-v2") return compile.promise;
      return Promise.resolve({
        draft: {
          provider: { baseUrl: input.providerBaseUrl, authType: input.authType },
          sources: [],
          models: [{
            modelKey: "paint-v3",
            labelZh: "Paint V3",
            kind: "image" as const,
            modes: [{
              taskKind: "text_to_image" as const,
              create: { method: "POST" as const, path: "/paint-v3" },
              sourceUrls: ["https://docs.example.com/api"],
            }],
          }],
        },
        failures: [],
      });
    });
    deps.compileTimeoutMs = 5;
    deps.batchTimeoutMs = 200;
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({
      ...startInput,
      models: [
        startInput.models[1],
        { modelKey: "paint-v3", labelZh: "Paint V3", kind: "image" as const },
      ],
    });

    await service.executeRun(started.id);
    compile.resolve({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    await Promise.resolve();

    expect(deps.compile).toHaveBeenCalledTimes(2);
    expect(service.getRun(started.id)?.stage).toBe("completed");
    expect(catalog.promoted[0]?.draft.models.map((model) => model.modelKey)).toEqual(["paint-v2", "paint-v3"]);
    expect(catalog.promoted[0]?.draft.models.find((model) => model.modelKey === "paint-v3")?.modes[0]?.create.path).toBe("/paint-v3");
  });

  it("uses the generic contract when documentation exists but no compiler AI is configured", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.resolveLanguageModels = () => [];
    deps.compile = vi.fn(deps.compile);
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start(startInput);

    await service.executeRun(started.id);

    expect(deps.compile).not.toHaveBeenCalled();
    expect(service.getRun(started.id)?.stage).toBe("completed");
    expect(catalog.promoted[0]?.verified).toEqual(expect.arrayContaining([
      "text-v1/chat",
      "paint-v2/text_to_image",
      "paint-v2/image_edit",
    ]));
  });

  it("publishes verified work when the batch deadline is reached during a later mode", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    let clock = now;
    deps.now = () => clock;
    deps.batchTimeoutMs = 1_000;
    deps.compile = async () => ({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    deps.verify = vi.fn(async ({ mode }): Promise<AdapterVerificationResult> => {
      if (mode.taskKind === "text_to_image") clock = "2026-08-07T00:00:02.000Z";
      return { ok: true, taskKind: mode.taskKind };
    });
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });

    await service.executeRun(started.id);

    expect(deps.verify).toHaveBeenCalledTimes(1);
    expect(service.getRun(started.id)).toMatchObject({
      stage: "partial",
      error: expect.stringContaining("deadline"),
      models: [expect.objectContaining({
        modes: expect.arrayContaining([
          expect.objectContaining({ taskKind: "text_to_image", state: "verified" }),
          expect.objectContaining({ taskKind: "image_edit", state: "failed" }),
        ]),
      })],
    });
    expect(catalog.promoted[0]?.verified).toEqual(["paint-v2/text_to_image"]);
  });

  it("marks a model with no generic contract as needing a manual script", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.discover = async () => ({ sources: [], corpus: "" });
    deps.resolveLanguageModels = () => [];
    deps.compile = vi.fn(deps.compile);
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({
      ...startInput,
      models: [{ modelKey: "mesh-v1", labelZh: "Mesh V1", kind: "model3d" as const }],
    });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)).toMatchObject({
      stage: "failed",
      models: [{
        modelKey: "mesh-v1",
        modes: [expect.objectContaining({
          taskKind: "text_to_3d",
          state: "failed",
          stage: "compile",
          error: expect.stringContaining("manual"),
        })],
      }],
    });
    expect(catalog.promoted).toEqual([]);
    expect(catalog.failed).toEqual([started.id]);
    expect(deps.compile).not.toHaveBeenCalled();
  });

  it("cancels active work and ignores its eventual result", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    const compile = deferred<Awaited<ReturnType<ProviderAdapterServiceDependencies["compile"]>>>();
    let compileSignal: AbortSignal | undefined;
    deps.compile = (input) => {
      compileSignal = input.signal;
      return compile.promise;
    };
    const service = new ProviderAdapterService(store(), deps);
    const started = await service.start({ ...startInput, models: [startInput.models[1]] });
    const running = service.executeRun(started.id);
    await vi.waitFor(() => expect(service.getRun(started.id)?.stage).toBe("compiling"));

    const cancelled = service.cancel(started.id);
    compile.resolve({ draft: { ...draft(), models: [draft().models[1]] }, failures: [] });
    await running;

    expect(cancelled?.stage).toBe("cancelled");
    expect(compileSignal?.aborted).toBe(true);
    expect(service.getRun(started.id)?.stage).toBe("cancelled");
    expect(catalog.promoted).toEqual([]);
    expect(catalog.failed).toEqual([started.id]);
  });

  it("does not resume cancelled, timed-out, or already-expired work", () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    const schedule = vi.fn();
    deps.schedule = schedule;
    deps.batchTimeoutMs = 60_000;
    const adapterStore = store();
    adapterStore.upsertRun({
      id: "expired",
      vendorKey: "api-example-com",
      vendorName: "Example",
      connectionFingerprint: "fingerprint",
      selectedModelKeys: ["paint-v2"],
      stage: "compiling",
      repairAttempt: 0,
      models: [],
      sourceUrls: [],
      deadlineAt: "2026-08-06T23:59:59.000Z",
      createdAt: "2026-08-06T23:00:00.000Z",
      updatedAt: "2026-08-06T23:00:00.000Z",
    });
    adapterStore.upsertRun({ ...adapterStore.getRun("expired")!, id: "cancelled", stage: "cancelled" });
    adapterStore.upsertRun({ ...adapterStore.getRun("expired")!, id: "timed-out", stage: "timed_out" });
    const restarted = new ProviderAdapterService(adapterStore, deps);

    restarted.resumeInterrupted();

    expect(schedule).not.toHaveBeenCalled();
    expect(restarted.getRun("expired")?.stage).toBe("timed_out");
    expect(restarted.getRun("cancelled")?.stage).toBe("cancelled");
    expect(restarted.getRun("timed-out")?.stage).toBe("timed_out");
    expect(catalog.failed).toEqual(["expired"]);
  });

  it("marks an older run stale and never lets it overwrite a newer run for the same provider", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    let sequence = 0;
    deps.id = () => `run-${++sequence}`;
    const service = new ProviderAdapterService(store(), deps);
    const older = await service.start({
      ...startInput,
      certification: { ...startInput.certification, idempotencyKey: "stale-older" },
    });
    const newer = await service.start({
      ...startInput,
      certification: { ...startInput.certification, idempotencyKey: "stale-newer" },
    });

    await service.executeRun(older.id);
    await service.executeRun(newer.id);

    expect(service.getRun(older.id)).toMatchObject({ stage: "stale" });
    expect(service.getRun(newer.id)).toMatchObject({ stage: "completed" });
    expect(catalog.promoted).toHaveLength(1);
    expect(catalog.failed).toContain(older.id);
  });

  it("keeps the event loop responsive while a duplicate waits for canonical materialization", async () => {
    const result = await runCanonicalReservationRace();

    expect(result.eventLoopResponsiveDuringWait).toBe(true);
    expect(result.duplicateRunId).toBe(result.canonicalRunId);
    expect(result.canonicalRunId).toBe("run-canonical");
    expect(result.stageCount).toBe(1);
    expect(result.scheduleCount).toBe(1);
    expect(result.createCount).toBe(1);
    expect(result.storedRunIds).toEqual(["run-canonical"]);
  }, 30_000);

  it("fails closed when the canonical reservation owner never materializes", async () => {
    const result = await runCanonicalReservationTimeout();

    expect(result.duplicateError).toBeInstanceOf(Error);
    expect(String(result.duplicateError)).toMatch(/timed out waiting for canonical run materialization/i);
    expect(result.stageCount).toBe(0);
    expect(result.scheduleCount).toBe(0);
    expect(result.createCount).toBe(0);
  });
  // ── 外部输入（2026-09-10）：接口文档与「外面编好的说明卡」两条路 ─────────────────
  //
  // 卡点 A：`nomi_integration begin` 一直收 docs，但它只到 session 就断了，编译器仍在猜域名。
  // 卡点 B：编译借的是用户已接的文本模型，一台还没接过任何模型的机器上直接判死（鸡生蛋）。

  it("feeds operator-supplied documentation to the compiler instead of guessing the provider docs site", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    // 用真实的文档来源边界（散文那条路不发任何请求），断言编译器吃到的确实是这份正文。
    deps.discover = resolveProviderDocs;
    let compiledWith: CompileInput | undefined;
    const compile = vi.fn(async (input: CompileInput) => {
      compiledWith = input;
      return { draft: draft(), failures: [] };
    });
    deps.compile = compile;
    const service = new ProviderAdapterService(store(), deps);
    const providedDocs = "POST /v1/images -> data[0].url; poll GET /v1/images/{id}";

    const run = await service.start({
      ...startInput,
      docs: providedDocs,
      certification: { ...startInput.certification, idempotencyKey: "provided-docs-reach-compiler" },
    });
    await service.executeRun(run.id);

    expect(compile).toHaveBeenCalledTimes(1);
    expect(compiledWith?.docs).toEqual([
      { url: providedDocsUrn(providedDocs), title: "Operator-supplied API documentation", text: providedDocs },
    ]);
  });

  it("certifies an externally compiled contract with no text model available", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    const discover = vi.fn(async () => ({ sources: [], corpus: "" }));
    const compile = vi.fn(async () => ({ draft: draft(), failures: [] }));
    deps.discover = discover;
    deps.compile = compile;
    // 鸡生蛋的那台机器：一个可用的文本模型都没有。
    deps.resolveLanguageModels = () => [];
    const verified: Array<{ modelKey: string; path: string }> = [];
    deps.verify = async ({ model, mode }) => {
      verified.push({ modelKey: model.modelKey, path: mode.create.path });
      return mode.taskKind === "chat"
        ? { ok: true as const, taskKind: mode.taskKind }
        : { ok: false as const, taskKind: mode.taskKind, stage: "contract" as const, error: "no executable request channel", selfCheckReason: "no_channel" as const };
    };
    const service = new ProviderAdapterService(store(), deps);

    const run = await service.start({
      ...startInput,
      adapterDraft: externalDraft(),
      certification: { ...startInput.certification, idempotencyKey: "external-contract-no-text-model" },
    });
    await service.executeRun(run.id);

    expect(discover).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    // 媒体模型跑的就是外部交回来的那张卡（/images 来自 externalDraft）；文本条目仍以
    // withTextModels 的确定性契约为单一真相（外部卡里的 /chat 被它盖掉，与编译器那条路一致）。
    expect(verified).toEqual([
      { modelKey: "paint-v2", path: "/images" },
      { modelKey: "text-v1", path: "/chat/completions" },
    ]);
    expect(catalog.promoted).toHaveLength(1);
    expect(catalog.promoted[0].verified).toEqual(["text-v1/chat"]);
  });

  it("fails closed when an externally compiled contract does not pass the adapter validator", async () => {
    const catalog = fakeCatalog();
    const deps = dependencies(catalog);
    deps.resolveLanguageModels = () => [];
    const adapterStore = store();
    const service = new ProviderAdapterService(adapterStore, deps);
    const invalid = externalDraft();
    // create 声明了运行时消费不了的响应键 —— 校验必须在执行边界拦住，不是「收件时看过就算」。
    invalid.models[1].modes[0].create = {
      ...invalid.models[1].modes[0].create,
      response_mapping: { totally_unsupported: "data.0.url" },
    };

    const run = await service.start({
      ...startInput,
      adapterDraft: invalid,
      certification: { ...startInput.certification, idempotencyKey: "external-contract-invalid" },
    });
    await service.executeRun(run.id);

    expect(adapterStore.getRun(run.id)?.stage).toBe("failed");
    expect(adapterStore.getRun(run.id)?.error).toMatch(/unsupported response mapping key/i);
    expect(catalog.promoted).toEqual([]);
  });
});
