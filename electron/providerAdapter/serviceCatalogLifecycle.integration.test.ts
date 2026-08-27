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

const now = "2026-08-28T00:00:00.000Z";
const rootVendorKey = "active-provider";
const targetModelKey = "image-v1";
const siblingModelKey = "video-sibling";

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
    vendors: [{
      key: rootVendorKey,
      name: "Active Provider",
      enabled: true,
      baseUrlHint: "https://active.example.test/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      createdAt: now,
      updatedAt: now,
    }],
    models: [
      { vendorKey: rootVendorKey, modelKey: targetModelKey, labelZh: "Image V1", kind: "image", enabled: true, createdAt: now, updatedAt: now },
      { vendorKey: rootVendorKey, modelKey: siblingModelKey, labelZh: "Video sibling", kind: "video", enabled: true, createdAt: now, updatedAt: now },
    ],
    mappings: [
      { id: "source-image", vendorKey: rootVendorKey, modelKey: targetModelKey, taskKind: "text_to_image", name: "source image", enabled: true, create: { method: "POST", path: "/source-image" }, createdAt: now, updatedAt: now },
      { id: "source-video", vendorKey: rootVendorKey, modelKey: siblingModelKey, taskKind: "text_to_video", name: "source video", enabled: true, create: { method: "POST", path: "/source-video" }, createdAt: now, updatedAt: now },
    ],
    apiKeysByVendor: { [rootVendorKey]: encryptedCredential(rootVendorKey, "active-key") },
  };
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

function candidateDraft(): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "https://candidate.example.test/v2", authType: "bearer", providerKind: "openai-compatible" },
    sources: [{ url: "https://candidate.example.test/docs", evidence: "API reference" }],
    models: [{
      modelKey: targetModelKey,
      labelZh: "Image V1 candidate",
      kind: "image",
      modes: [{
        taskKind: "text_to_image",
        create: { method: "POST", path: "/candidate-image", body: { prompt: "{{request.prompt}}" } },
        sourceUrls: ["https://candidate.example.test/docs"],
      }],
    }],
  };
}

function serviceDependencies(overrides: Partial<ProviderAdapterServiceDependencies> = {}): Partial<ProviderAdapterServiceDependencies> {
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
    verify: async ({ mode }) => ({ ok: false, taskKind: mode.taskKind, stage: "create", error: "provider rejected candidate" }),
    maxRepairs: 0,
    now: () => now,
    id: () => "run-real-failure",
    ...overrides,
  };
}

function startCandidate(service: ProviderAdapterService) {
  const run = service.start({
    catalogVendorKey: rootVendorKey,
    vendorName: "Candidate Provider",
    baseUrl: "https://candidate.example.test/v2",
    apiKey: "candidate-key",
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey: targetModelKey, labelZh: "Image V1 candidate", kind: "image" }],
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
  it("cleans a fully failed candidate through the real service path without changing active source or sibling", async () => {
    const sourceBefore = readCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies(),
    );
    const started = startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("failed");
    expectOnlyActiveSourceRemains(sourceBefore, started.vendorKey);
  });

  it("cleans a zero-mode verification timeout through the same real service terminal path", async () => {
    const sourceBefore = readCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        batchTimeoutMs: 5,
        verifyTimeoutMs: 1_000,
        verify: () => new Promise(() => {}),
        id: () => "run-real-timeout",
      }),
    );
    const started = startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("timed_out");
    expectOnlyActiveSourceRemains(sourceBefore, started.vendorKey);
  });

  it("cancels and cleans a staged candidate idempotently before provider execution", () => {
    const sourceBefore = readCatalog();
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({ id: () => "run-real-cancel" }),
    );
    const started = startCandidate(service);

    expect(service.cancel(started.id)?.stage).toBe("cancelled");
    expect(service.cancel(started.id)?.stage).toBe("cancelled");

    expectOnlyActiveSourceRemains(sourceBefore, started.vendorKey);
  });

  it("supersedes and aborts an older run across candidate vendor revisions before another provider create", async () => {
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
    const older = startCandidate(service);
    const olderWork = service.executeRun(older.id);
    await vi.waitFor(() => expect(oldVerifySignal).toBeDefined());

    const newer = service.start({
      catalogVendorKey: rootVendorKey,
      vendorName: "New candidate",
      baseUrl: "https://candidate.example.test/v2",
      apiKey: "new-candidate-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey: targetModelKey, labelZh: "Image V1 candidate", kind: "image" }],
    });

    expect(newer.vendorKey).not.toBe(older.vendorKey);
    expect(oldVerifySignal?.aborted).toBe(true);
    await olderWork;
    expect(providerCreates).toBe(1);
    expect(service.getRun(older.id)?.stage).toBe("stale");
    expect(service.getRun(older.id)?.stage).not.toBe("completed");
    expect(service.getRun(newer.id)?.stage).toBe("queued");
    expect(readCatalog().vendors.some((vendor) => vendor.key === older.vendorKey)).toBe(false);
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
      models: [{
        ...candidateDraft().models[0],
        modes: [
          candidateDraft().models[0].modes[0],
          {
            taskKind: "image_edit",
            create: { method: "POST", path: "/candidate-edit", body: { image: "{{request.params.referenceImages}}" } },
            sourceUrls: ["https://candidate.example.test/docs"],
          },
        ],
      }],
    };
    const service = new ProviderAdapterService(
      new ProviderAdapterStore(path.join(userDataRoot, "provider-adapters.json")),
      serviceDependencies({
        id: () => "run-real-partial",
        compile: async () => ({ draft: partialDraft, failures: [] }),
        verify: async ({ mode }) => mode.taskKind === "text_to_image"
          ? { ok: true, taskKind: mode.taskKind }
          : { ok: false, taskKind: mode.taskKind, stage: "create", error: "edit rejected" },
      }),
    );
    const started = startCandidate(service);

    await service.executeRun(started.id);

    expect(service.getRun(started.id)?.stage).toBe("partial");
    expect(listModelCatalogMappings({ vendorKey: started.vendorKey })).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskKind: "text_to_image", enabled: true }),
      expect.objectContaining({ taskKind: "image_edit", enabled: false }),
    ]));

    deleteModelCatalogVendor(started.vendorKey);

    expect(listModelCatalogMappings({ vendorKey: rootVendorKey })).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskKind: "text_to_image", enabled: true, create: { path: "/source-image", method: "POST" } }),
      expect.objectContaining({ taskKind: "image_edit", enabled: true, create: { path: "/source-edit", method: "POST" } }),
    ]));
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
