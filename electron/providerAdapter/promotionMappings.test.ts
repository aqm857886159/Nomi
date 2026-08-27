import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mapping, Model, ProfileKind, Vendor } from "../catalog/types";
import type { AdapterModelDraft, ProviderAdapterDraft } from "./types";

const now = "2026-08-15T00:00:00.000Z";
const vendor: Vendor = {
  key: "custom-relay",
  name: "Custom Relay",
  enabled: false,
  baseUrlHint: "http://192.168.1.8:8000/v1",
  authType: "none",
  providerKind: "openai-compatible",
  createdAt: now,
  updatedAt: now,
};
const models: Model[] = [
  { vendorKey: vendor.key, modelKey: "image-v1", labelZh: "Image V1", kind: "image", enabled: false, meta: { adapter: { state: "testing", runId: "run-mapping", modes: [], updatedAt: now } }, createdAt: now, updatedAt: now },
  { vendorKey: vendor.key, modelKey: "video-v1", labelZh: "Video V1", kind: "video", enabled: false, meta: { adapter: { state: "testing", runId: "run-mapping", modes: [], updatedAt: now } }, createdAt: now, updatedAt: now },
  { vendorKey: vendor.key, modelKey: "text-v1", labelZh: "Text V1", kind: "text", enabled: false, meta: { adapter: { state: "testing", runId: "run-mapping", modes: [], updatedAt: now } }, createdAt: now, updatedAt: now },
];

let catalogMappings: Mapping[] = [];
const upsertMapping = vi.fn();
const upsertModel = vi.fn();
const upsertVendor = vi.fn();

vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => ({ vendors: [vendor], models, mappings: catalogMappings, apiKeysByVendor: {} }),
  mutateCatalog: (fn: (tx: unknown) => void) =>
    fn({ upsertModel, upsertVendor, upsertMapping, deleteModelMappings: vi.fn() }),
  extractVendorExtraHeaders: () => ({}),
  normalizeProviderKind: (value: unknown) => value ?? "openai-compatible",
}));

const { defaultCatalog } = await import("./service");

const modeFor = (taskKind: ProfileKind, path: string) => ({
  taskKind,
  create: { method: "POST" as const, path },
  testParams: {},
  sourceUrls: [],
});

function promote(draftModels: AdapterModelDraft[], verifiedModes: Array<{ modelKey: string; taskKind: ProfileKind }> = []) {
  const draft: ProviderAdapterDraft = {
    provider: { baseUrl: String(vendor.baseUrlHint), authType: "none", providerKind: "openai-compatible" },
    sources: [],
    models: draftModels,
  };
  return defaultCatalog.promote({
    run: {
      id: "run-mapping",
      vendorKey: vendor.key,
      vendorName: vendor.name,
      connectionFingerprint: "fp",
      selectedModelKeys: draftModels.map((model) => model.modelKey),
      stage: verifiedModes.length ? "partial" : "failed",
      repairAttempt: 0,
      models: draftModels.map((model) => ({
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: model.kind,
        modes: model.modes.map((mode) => ({
          taskKind: mode.taskKind,
          state: verifiedModes.some((item) => item.modelKey === model.modelKey && item.taskKind === mode.taskKind)
            ? "verified" as const
            : "failed" as const,
          attempts: 1,
          ...(verifiedModes.some((item) => item.modelKey === model.modelKey && item.taskKind === mode.taskKind)
            ? {}
            : { stage: "create" as const, error: "probe failed" }),
        })),
      })),
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    },
    draft,
    revision: { id: "revision-mapping", vendorKey: vendor.key, digest: "digest", draft, verifiedModes, createdAt: now },
    verifiedModes,
  });
}

describe("adapter media mapping promotion", () => {
  beforeEach(() => {
    catalogMappings = [];
    upsertMapping.mockClear();
    upsertModel.mockClear();
    upsertVendor.mockClear();
  });

  it("rejects zero-verified promotion without materializing failed mappings", () => {
    const result = promote([
      { modelKey: "image-v1", labelZh: "Image V1", kind: "image", modes: [modeFor("text_to_image", "/images/new")] },
      { modelKey: "video-v1", labelZh: "Video V1", kind: "video", modes: [modeFor("text_to_video", "/videos/new")] },
    ]);

    expect(result).toEqual({ status: "no-lease" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("does not mutate an existing exact mapping when no mode verified", () => {
    catalogMappings = [{
      id: "mapping-good",
      vendorKey: vendor.key,
      modelKey: "image-v1",
      taskKind: "text_to_image",
      name: "Last known good",
      enabled: true,
      create: { method: "POST", path: "/images/good" },
      createdAt: now,
      updatedAt: now,
    }];

    const result = promote([{ modelKey: "image-v1", labelZh: "Image V1", kind: "image", modes: [modeFor("text_to_image", "/images/failed-draft")] }]);

    expect(result).toEqual({ status: "no-lease" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("preserves an existing exact mapping when a failed repair has an active revision", () => {
    catalogMappings = [{
      id: "mapping-good",
      vendorKey: vendor.key,
      modelKey: "image-v1",
      taskKind: "text_to_image",
      name: "Last known good",
      enabled: true,
      create: { method: "POST", path: "/images/good" },
      createdAt: now,
      updatedAt: now,
    }];
    const originalMeta = models[0].meta;
    const originalEnabled = models[0].enabled;
    models[0].enabled = true;
    models[0].meta = {
      adapter: {
        state: "testing",
        runId: "run-mapping",
        activeRevision: "revision-good",
        modes: [],
        updatedAt: now,
      },
    };

    try {
      promote([{ modelKey: "image-v1", labelZh: "Image V1", kind: "image", modes: [modeFor("text_to_image", "/images/failed-draft")] }]);
    } finally {
      models[0].meta = originalMeta;
      models[0].enabled = originalEnabled;
    }

    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("replaces an existing exact mapping when the new candidate verifies", () => {
    catalogMappings = [{
      id: "mapping-old",
      vendorKey: vendor.key,
      modelKey: "image-v1",
      taskKind: "text_to_image",
      name: "Old",
      enabled: true,
      create: { method: "POST", path: "/images/old" },
      createdAt: now,
      updatedAt: now,
    }];

    promote(
      [{ modelKey: "image-v1", labelZh: "Image V1", kind: "image", modes: [modeFor("text_to_image", "/images/verified")] }],
      [{ modelKey: "image-v1", taskKind: "text_to_image" }],
    );

    expect(upsertMapping).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: "image-v1",
      taskKind: "text_to_image",
      create: expect.objectContaining({ path: "/images/verified" }),
    }));
  });

  it("enables only the verified mode during partial promotion", () => {
    promote(
      [{
        modelKey: "image-v1",
        labelZh: "Image V1",
        kind: "image",
        modes: [modeFor("text_to_image", "/images/verified"), modeFor("image_edit", "/images/failed")],
      }],
      [{ modelKey: "image-v1", taskKind: "text_to_image" }],
    );

    expect(upsertMapping).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: "image-v1",
      taskKind: "text_to_image",
      enabled: true,
    }));
    expect(upsertMapping).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: "image-v1",
      taskKind: "image_edit",
      enabled: false,
    }));
    expect(upsertModel).toHaveBeenCalledWith(expect.objectContaining({ modelKey: "image-v1", enabled: true }));
    expect(upsertVendor).toHaveBeenCalledWith(expect.objectContaining({ key: vendor.key, enabled: true }));
  });

  it("switches a staged replacement contract only when its candidate mode verifies", () => {
    const original = structuredClone(models[0]);
    models[0] = {
      ...models[0],
      labelZh: "Published image",
      kind: "image",
      enabled: true,
      meta: { adapter: { state: "testing", runId: "run-mapping", activeRevision: "revision-old", modes: [], updatedAt: now } },
      onboarding: { addedVia: "agent", addedAt: "old", fields: [] },
    };
    try {
      promote(
        [{ modelKey: "image-v1", labelZh: "Verified replacement video", kind: "video", modes: [modeFor("text_to_video", "/videos/new")] }],
        [{ modelKey: "image-v1", taskKind: "text_to_video" }],
      );
    } finally {
      models[0] = original;
    }

    expect(upsertModel).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: "image-v1",
      labelZh: "Verified replacement video",
      kind: "video",
      enabled: true,
    }));
  });

  it("keeps failed text models on the AI SDK path without creating a mapping", () => {
    promote([{ modelKey: "text-v1", labelZh: "Text V1", kind: "text", modes: [modeFor("chat", "/chat/completions")] }]);

    expect(upsertMapping).not.toHaveBeenCalled();
  });
});
