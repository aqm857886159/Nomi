import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV1 } from "ai";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import {
  deleteModelCatalogVendor,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  readCatalog,
  upsertModelCatalogMapping,
} from "../catalog/catalogStore";
import { CURRENT_CATALOG_VERSION, type CatalogState } from "../catalog/types";
import { ProviderAdapterService, type ProviderAdapterServiceDependencies } from "./service";
import { defaultCatalog } from "./serviceCatalog";
import { ProviderAdapterStore } from "./store";
import type { ProviderAdapterDraft } from "./types";
import { resolveExecutableNodeFromCatalog } from "../../src/workbench/generationCanvas/runner/catalogTaskResolve";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";
import { ConnectionCertificationService } from "../integrationCertification/service";
import { HttpProviderConnector } from "../integrationCertification/httpConnector";

const now = "2026-08-28T00:00:00.000Z";
const rootVendorKey = "active-provider";
const targetModelKey = "image-v1";
const siblingModelKey = "video-sibling";
const textModelKey = "deepseek-v4-pro";

function encryptedCredential(vendorKey: string, value: string) {
  return {
    vendorKey,
    apiKey: Buffer.from(value).toString("base64"),
    enc: "safeStorage" as const,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function seedPublishedCatalog(): void {
  const state: CatalogState = {
    version: CURRENT_CATALOG_VERSION,
    vendors: [
      {
        key: rootVendorKey,
        name: "Active Provider",
        enabled: true,
        baseUrlHint: "https://active.example.test/v1",
        authType: "bearer",
        providerKind: "openai-compatible",
        createdAt: now,
        updatedAt: now,
      },
    ],
    models: [
      {
        vendorKey: rootVendorKey,
        modelKey: targetModelKey,
        labelZh: "Image V1",
        kind: "image",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        vendorKey: rootVendorKey,
        modelKey: siblingModelKey,
        labelZh: "Video sibling",
        kind: "video",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    mappings: [
      {
        id: "source-image",
        vendorKey: rootVendorKey,
        modelKey: targetModelKey,
        taskKind: "text_to_image",
        name: "source image",
        enabled: true,
        create: { method: "POST", path: "/source-image" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "source-video",
        vendorKey: rootVendorKey,
        modelKey: siblingModelKey,
        taskKind: "text_to_video",
        name: "source video",
        enabled: true,
        create: { method: "POST", path: "/source-video" },
        createdAt: now,
        updatedAt: now,
      },
    ],
    apiKeysByVendor: { [rootVendorKey]: encryptedCredential(rootVendorKey, "active-key") },
  };
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

function seedUnpublishedTextCatalog(): void {
  const state: CatalogState = {
    version: CURRENT_CATALOG_VERSION,
    vendors: [
      {
        key: rootVendorKey,
        name: "APIMart",
        // Credential writes de-publish the known vendor before the user enters
        // the canonical certification flow. Promotion must still target this
        // stable key once chat verification succeeds.
        enabled: false,
        baseUrlHint: "https://api.apimart.ai/v1",
        authType: "bearer",
        providerKind: "openai-compatible",
        createdAt: now,
        updatedAt: now,
      },
    ],
    models: [
      {
        vendorKey: rootVendorKey,
        modelKey: textModelKey,
        labelZh: textModelKey,
        kind: "text",
        enabled: false,
        meta: { adapter: { state: "unverified", modes: [], updatedAt: now } },
        createdAt: now,
        updatedAt: now,
      },
    ],
    mappings: [],
    apiKeysByVendor: { [rootVendorKey]: encryptedCredential(rootVendorKey, "apimart-key") },
  };
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

function candidateDraft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "https://candidate.example.test/v2", authType: "bearer", providerKind: "openai-compatible" },
    sources: [{ url: "https://candidate.example.test/docs", evidence: "API reference" }],
    models: [
      {
        modelKey: targetModelKey,
        labelZh: "Image V1 candidate",
        kind: "image",
        modes: [
          {
            taskKind: "text_to_image",
            create: { method: "POST", path: "/candidate-image", body: { prompt: "{{request.prompt}}" } },
            sourceUrls: ["https://candidate.example.test/docs"],
          },
        ],
      },
    ],
  };
}

function serviceDependencies(
  overrides: Partial<ProviderAdapterServiceDependencies> = {},
): Partial<ProviderAdapterServiceDependencies> {
  return {
    catalog: defaultCatalog,
    schedule: () => {},
    discover: async () => ({
      sources: [{ url: "https://candidate.example.test/docs", text: "API reference" }],
      corpus: "API reference",
    }),
    resolveLanguageModels: () => [{} as LanguageModelV1],
    compile: async () => ({ draft: candidateDraft(), failures: [] }),
    repair: async () => candidateDraft(),
    verify: async ({ mode }) => ({
      ok: false,
      taskKind: mode.taskKind,
      stage: "create",
      error: "provider rejected candidate",
    }),
    maxRepairs: 0,
    now: () => now,
    id: () => "run-real-failure",
    ...overrides,
  };
}

async function startCandidate(service: ProviderAdapterService) {
  const run = await service.start({
    catalogVendorKey: rootVendorKey,
    vendorName: "Candidate Provider",
    baseUrl: "https://candidate.example.test/v2",
    apiKey: "candidate-key",
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey: targetModelKey, labelZh: "Image V1 candidate", kind: "image" }],
    certification: {
      contractDigest: "a".repeat(64),
      idempotencyKey: "catalog-lifecycle-candidate",
      remoteIdempotency: "unknown",
    },
  });
  upsertModelCatalogMapping({
    vendorKey: run.vendorKey,
    modelKey: targetModelKey,
    taskKind: "text_to_image",
    name: "staged candidate mapping",
    enabled: false,
    create: { method: "POST", path: "/staged-candidate" },
  });
  return run;
}

function expectOnlyActiveSourceRemains(sourceBefore: CatalogState, candidateVendorKey: string): void {
  const after = readCatalog();
  expect(after.vendors.filter((vendor) => vendor.key === rootVendorKey)).toEqual(sourceBefore.vendors);
  expect(after.models.filter((model) => model.vendorKey === rootVendorKey)).toEqual(sourceBefore.models);
  expect(after.mappings.filter((mapping) => mapping.vendorKey === rootVendorKey)).toEqual(sourceBefore.mappings);
  expect(after.apiKeysByVendor[rootVendorKey]).toEqual(sourceBefore.apiKeysByVendor[rootVendorKey]);
  expect(after.vendors.some((vendor) => vendor.key === candidateVendorKey)).toBe(false);
  expect(after.models.some((model) => model.vendorKey === candidateVendorKey)).toBe(false);
  expect(after.mappings.some((mapping) => mapping.vendorKey === candidateVendorKey)).toBe(false);
  expect(after.apiKeysByVendor[candidateVendorKey]).toBeUndefined();
}

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-real-lifecycle-"));
  seedPublishedCatalog();
});

afterEach(() => {
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

describe("ProviderAdapterService real catalog candidate lifecycle", () => {
  it("re-publishes a verified text chat mode on a de-published seeded vendor", async () => {
    seedUnpublishedTextCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => "run-real-text",
        verify: async ({ mode }) => ({ ok: true, taskKind: mode.taskKind }),
      }),
    );

    const started = await service.start({
      catalogVendorKey: rootVendorKey,
      vendorName: "APIMart",
      baseUrl: "https://api.apimart.ai/v1",
      apiKey: "apimart-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey: textModelKey, labelZh: textModelKey, kind: "text" }],
      certification: {
        contractDigest: "f".repeat(64),
        idempotencyKey: "real-text-promotion",
        remoteIdempotency: "unsupported",
      },
    });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("completed");
    expect(readCatalog().models.find((model) => model.modelKey === textModelKey)).toMatchObject({
      vendorKey: rootVendorKey,
      enabled: true,
      meta: {
        adapter: {
          state: "verified",
          activeRevision: expect.stringMatching(/^adapter-revision-/),
          publicationModes: ["chat"],
        },
      },
    });
    expect(readCatalog().vendors.find((vendor) => vendor.key === rootVendorKey)).toMatchObject({ enabled: true });
    expect(listModelCatalogModels({ vendorKey: rootVendorKey })).toEqual([
      expect.objectContaining({
        modelKey: textModelKey,
        enabled: true,
        published: true,
        publishedModes: ["chat"],
        meta: expect.objectContaining({
          adapter: expect.objectContaining({ state: "verified", publicationModes: ["chat"] }),
        }),
      }),
    ]);
  });

  it("keeps a de-published seeded text vendor disabled when chat verification fails", async () => {
    seedUnpublishedTextCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => "run-real-text-failed",
        verify: async ({ mode }) => ({ ok: false, taskKind: mode.taskKind, stage: "create", error: "provider rejected" }),
      }),
    );

    const started = await service.start({
      catalogVendorKey: rootVendorKey,
      vendorName: "APIMart",
      baseUrl: "https://api.apimart.ai/v1",
      apiKey: "apimart-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey: textModelKey, labelZh: textModelKey, kind: "text" }],
      certification: {
        contractDigest: "e".repeat(64),
        idempotencyKey: "real-text-failure",
        remoteIdempotency: "unsupported",
      },
    });

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("failed");
    expect(readCatalog().vendors.find((vendor) => vendor.key === rootVendorKey)).toMatchObject({ enabled: false });
    expect(listModelCatalogModels({ vendorKey: rootVendorKey })).toEqual([
      expect.objectContaining({ modelKey: textModelKey, enabled: false, published: false, publishedModes: [] }),
    ]);
  });

  it("resolves the real manual-existing and programmatic HTTP entries to one canonical run", async () => {
    let sequence = 0;
    const provider = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({ id: () => `run-entry-${++sequence}` }),
    );
    const certification = new ConnectionCertificationService({ http: new HttpProviderConnector(provider) });
    const models = [{ modelKey: targetModelKey, labelZh: "Image V1", kind: "image" as const }];
    const manual = await certification.startExistingHttp({
      entryPoint: "manual-ui",
      idempotencyKey: "same-user-confirmation",
      vendorKey: rootVendorKey,
      models,
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) throw new Error("manual entry failed");
    const programmatic = await certification.startHttp({
      entryPoint: "programmatic-session",
      idempotencyKey: "same-user-confirmation",
      connection: {
        catalogVendorKey: rootVendorKey,
        vendorName: "Active Provider",
        baseUrl: "https://active.example.test/v1",
        apiKey: "active-key",
        authType: "bearer",
        providerKind: "openai-compatible",
        models,
      },
    });

    expect(programmatic.id).toBe(manual.run.id);
    expect(programmatic.childRunRef).toEqual(manual.run.childRunRef);
    expect(provider.listRuns()).toHaveLength(1);
    expect(programmatic).toMatchObject({ lineageRootVendorKey: rootVendorKey });
  });

  it("retries a cleaned failed revision from its lineage source and publishes the new revision", async () => {
    let sequence = 0;
    let verification = 0;
    const provider = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => `run-retry-${++sequence}`,
        verify: (async ({ mode }) => ({
          ok: ++verification > 1,
          taskKind: mode.taskKind,
          stage: "create",
          ...(verification > 1
            ? { artifactUrl: "https://result.example.test/image.png" }
            : { error: "first revision failed" }),
        })) as ProviderAdapterServiceDependencies["verify"],
      }),
    );
    const certification = new ConnectionCertificationService({ http: new HttpProviderConnector(provider) });
    const first = await certification.startExistingHttp({
      entryPoint: "manual-ui",
      idempotencyKey: "lifecycle-first",
      vendorKey: rootVendorKey,
      models: [{ modelKey: targetModelKey, labelZh: "Image V1", kind: "image" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("first start failed");
    await provider.executeRun(first.run.id);
    expect(provider.getRun(first.run.id)).toMatchObject({ stage: "failed", lineageRootVendorKey: rootVendorKey });
    expect(readCatalog().vendors.some((vendor) => vendor.key === first.run.vendorKey)).toBe(false);

    const retried = await certification.retryHttp({
      runId: first.run.id,
      idempotencyKey: "lifecycle-retry",
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("retry start failed");
    expect(retried.run.id).not.toBe(first.run.id);
    expect(retried.run.lineageRootVendorKey).toBe(rootVendorKey);
    expect(retried.run.selectedModelKeys).toEqual([targetModelKey]);
    await provider.executeRun(retried.run.id);
    expect(provider.getRun(retried.run.id)).toMatchObject({ stage: "completed", lineageRootVendorKey: rootVendorKey });
    expect(
      listModelCatalogModels({ vendorKey: retried.run.vendorKey }).find((model) => model.modelKey === targetModelKey),
    ).toMatchObject({ enabled: true, published: true });
  });

  it("cleans a fully failed candidate through the real service path without changing active source or sibling", async () => {
    const sourceBefore = readCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies(),
    );
    const started = await startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("failed");
    expectOnlyActiveSourceRemains(sourceBefore, started.vendorKey);
  });

  it("keeps a timed-out in-flight candidate disabled for reconciliation instead of deleting uncertain work", async () => {
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        batchTimeoutMs: 5,
        verifyTimeoutMs: 1_000,
        verify: () => new Promise(() => {}),
        id: () => "run-real-timeout",
      }),
    );
    const started = await startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)).toMatchObject({
      stage: "reconciling",
      recovery: { reasonCode: "submission_reconcile_unavailable" },
    });
    expect(readCatalog().vendors.find((vendor) => vendor.key === started.vendorKey)).toMatchObject({ enabled: false });
    expect(
      listModelCatalogMappings({ vendorKey: started.vendorKey }).every((mapping) => mapping.enabled === false),
    ).toBe(true);
  });

  it("cancels and cleans a staged candidate idempotently before provider execution", async () => {
    const sourceBefore = readCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({ id: () => "run-real-cancel" }),
    );
    const started = await startCandidate(service);

    expect(service.cancel(started.id)?.stage).toBe("cancelled");
    expect(service.cancel(started.id)?.stage).toBe("cancelled");

    expectOnlyActiveSourceRemains(sourceBefore, started.vendorKey);
  });

  it("blocks a competing lineage revision after provider create may have been accepted", async () => {
    let sequence = 0;
    let oldVerifySignal: AbortSignal | undefined;
    let providerCreates = 0;
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => `run-real-${++sequence}`,
        verify: ({ signal }) => {
          providerCreates += 1;
          oldVerifySignal = signal;
          return new Promise(() => {});
        },
        verifyTimeoutMs: 60_000,
      }),
    );
    const older = await startCandidate(service);
    const olderWork = service.executeRun(older.id);
    await vi.waitFor(() => expect(oldVerifySignal).toBeDefined());

    await expect(
      service.start({
        catalogVendorKey: rootVendorKey,
        vendorName: "New candidate",
        baseUrl: "https://candidate.example.test/v2",
        apiKey: "new-candidate-key",
        authType: "bearer",
        providerKind: "openai-compatible",
        models: [{ modelKey: targetModelKey, labelZh: "Image V1 candidate", kind: "image" }],
        certification: {
          contractDigest: "b".repeat(64),
          idempotencyKey: "catalog-lifecycle-competing-candidate",
          remoteIdempotency: "unknown",
        },
      }),
    ).rejects.toThrowError(/unresolved remote submission/i);

    expect(providerCreates).toBe(1);
    expect(oldVerifySignal?.aborted).toBe(false);
    expect(service.cancel(older.id)).toMatchObject({
      stage: "reconciling",
      recovery: { reasonCode: "submission_unknown" },
    });
    expect(oldVerifySignal?.aborted).toBe(true);
    await olderWork;
    expect(providerCreates).toBe(1);
    expect(service.getRun(older.id)?.stage).toBe("reconciling");
    expect(service.getRun(older.id)?.stage).not.toBe("completed");
    expect(readCatalog().vendors.some((vendor) => vendor.key === older.vendorKey)).toBe(true);
    expect(service.listRuns().filter((run) => run.activeRevision)).toEqual([]);
  });

  it("restores every predecessor mode and old-node route after deleting a partial promotion", async () => {
    upsertModelCatalogMapping({
      vendorKey: rootVendorKey,
      modelKey: targetModelKey,
      taskKind: "image_edit",
      name: "source edit",
      enabled: true,
      create: { method: "POST", path: "/source-edit" },
    });
    const partialDraft: ProviderAdapterDraft = {
      ...candidateDraft(),
      models: [
        {
          ...candidateDraft().models[0],
          modes: [
            candidateDraft().models[0].modes[0],
            {
              taskKind: "image_edit",
              create: {
                method: "POST",
                path: "/candidate-edit",
                body: { image: "{{request.params.referenceImages}}" },
              },
              sourceUrls: ["https://candidate.example.test/docs"],
            },
          ],
        },
      ],
    };
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => "run-real-partial",
        compile: async () => ({ draft: partialDraft, failures: [] }),
        verify: async ({ mode }) =>
          mode.taskKind === "text_to_image"
            ? { ok: true, taskKind: mode.taskKind }
            : { ok: false, taskKind: mode.taskKind, stage: "create", error: "edit rejected" },
      }),
    );
    const started = await startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("partial");
    expect(listModelCatalogMappings({ vendorKey: started.vendorKey })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskKind: "text_to_image", enabled: true }),
        expect.objectContaining({ taskKind: "image_edit", enabled: false }),
      ]),
    );
    expect(listModelCatalogModels({ vendorKey: started.vendorKey })[0]).toMatchObject({
      published: true,
      publishedModes: ["text_to_image"],
      meta: { adapter: { publicationModes: ["text_to_image"] } },
    });
    expect(
      listModelCatalogModels({ vendorKey: rootVendorKey }).find((model) => model.modelKey === targetModelKey),
    ).toMatchObject({
      enabled: false,
      published: false,
      publishedModes: [],
      meta: { adapter: { publicationModes: [] } },
    });

    deleteModelCatalogVendor(started.vendorKey);

    expect(listModelCatalogMappings({ vendorKey: rootVendorKey })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskKind: "text_to_image",
          enabled: true,
          create: { path: "/source-image", method: "POST" },
        }),
        expect.objectContaining({
          taskKind: "image_edit",
          enabled: true,
          create: { path: "/source-edit", method: "POST" },
        }),
      ]),
    );
    expect(
      listModelCatalogModels({ vendorKey: rootVendorKey }).find((model) => model.modelKey === targetModelKey),
    ).toMatchObject({ enabled: true, published: true, publishedModes: ["text_to_image", "image_edit"] });
    const oldNode: GenerationCanvasNode = {
      id: "old-image-node",
      kind: "image",
      title: "",
      position: { x: 0, y: 0 },
      meta: { modelVendor: rootVendorKey, vendor: rootVendorKey, modelKey: targetModelKey },
    };
    const resolved = await resolveExecutableNodeFromCatalog(oldNode, {
      listCatalogVendors: async () => listModelCatalogVendors(),
      listCatalogModels: async () => listModelCatalogModels({ kind: "image", enabled: true }),
    });
    expect(resolved.meta).toMatchObject({ modelVendor: rootVendorKey, modelKey: targetModelKey });
  });
});
