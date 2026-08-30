import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState, Model, Vendor } from "../catalog/types";

const now = "2026-08-15T00:00:00.000Z";
let state: CatalogState;

const upsertVendor = vi.fn((raw: Partial<Vendor> & Pick<Vendor, "key" | "name" | "enabled">): Vendor => ({
  baseUrlHint: null,
  createdAt: now,
  updatedAt: now,
  ...raw,
}));
const upsertModel = vi.fn((raw: Omit<Model, "createdAt" | "updatedAt">): Model => ({
  createdAt: now,
  updatedAt: now,
  ...raw,
}));
const upsertApiKey = vi.fn();
const deleteApiKey = vi.fn();

vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => structuredClone(state),
  mutateCatalog: <T>(fn: (tx: unknown) => T): T => fn({
    upsertVendor,
    upsertModel,
    upsertApiKey,
    deleteApiKey,
  }),
  extractVendorExtraHeaders: () => undefined,
  normalizeProviderKind: (value: unknown) => value || "openai-compatible",
}));

const { defaultCatalog } = await import("./serviceCatalog");

function emptyState(): CatalogState {
  return {
    version: 8,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {},
  };
}

describe("provider adapter registration catalog", () => {
  beforeEach(() => {
    state = emptyState();
    vi.clearAllMocks();
  });

  it("stores the vendor and encrypted credential without inventing a model", () => {
    defaultCatalog.register({
      vendorKey: "saved-gateway",
      vendorName: "Saved Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "sk-encrypt-me",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [],
      savedAt: now,
    });

    expect(upsertVendor).toHaveBeenCalledWith(expect.objectContaining({
      key: "saved-gateway",
      enabled: false,
    }));
    expect(upsertApiKey).toHaveBeenCalledWith("saved-gateway", {
      apiKey: "sk-encrypt-me",
      enabled: true,
    });
    expect(upsertModel).not.toHaveBeenCalled();
  });

  it("keeps every newly registered model disabled and marks it unverified", () => {
    const kinds = ["text", "image", "video", "audio", "model3d"] as const;
    const models = Array.from({ length: 20 }, (_, index) => ({
      modelKey: `model-${index + 1}`,
      labelZh: `Model ${index + 1}`,
      kind: kinds[index % kinds.length],
    }));

    defaultCatalog.register({
      vendorKey: "generic-gateway",
      vendorName: "Generic Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "sk-encrypt-me",
      authType: "bearer",
      providerKind: "openai-compatible",
      models,
      savedAt: now,
    });

    expect(upsertVendor).toHaveBeenCalledWith(expect.objectContaining({
      key: "generic-gateway",
      enabled: false,
    }));
    expect(upsertApiKey).toHaveBeenCalledWith("generic-gateway", {
      apiKey: "sk-encrypt-me",
      enabled: true,
    });
    expect(upsertModel).toHaveBeenCalledTimes(20);
    for (const [written] of upsertModel.mock.calls) {
      expect(written).toMatchObject({
        enabled: false,
        onboarding: { addedVia: "manual", addedAt: now, fields: [] },
        meta: {
          adapter: {
            state: "unverified",
            modes: [],
            updatedAt: now,
          },
        },
      });
      expect((written.meta as { adapter: Record<string, unknown> }).adapter).not.toHaveProperty("runId");
    }
  });

  it("keeps an existing encrypted credential when main requests credential preservation", () => {
    state = {
      ...emptyState(),
      vendors: [{
        key: "saved-gateway",
        name: "Saved Gateway",
        enabled: true,
        baseUrlHint: "https://gateway.example.test/v1",
        authType: "bearer",
        createdAt: now,
        updatedAt: now,
      }],
      apiKeysByVendor: {
        "saved-gateway": {
          vendorKey: "saved-gateway",
          apiKey: "encrypted-record",
          enabled: true,
          enc: "safeStorage",
          createdAt: now,
          updatedAt: now,
        },
      },
    };

    defaultCatalog.register({
      catalogVendorKey: "saved-gateway",
      vendorKey: "saved-gateway",
      vendorName: "Saved Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "",
      authType: "bearer",
      providerKind: "openai-compatible",
      preserveExistingCredential: true,
      models: [{ modelKey: "new-image", kind: "image" }],
      savedAt: now,
    });

    expect(upsertApiKey).not.toHaveBeenCalled();
    expect(deleteApiKey).not.toHaveBeenCalled();
    expect(upsertModel).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: "new-image",
      enabled: false,
      onboarding: { addedVia: "manual", addedAt: now, fields: [] },
      meta: expect.objectContaining({
        adapter: expect.objectContaining({ state: "unverified" }),
      }),
    }));
  });

  it("rejects preserving a legacy plaintext credential and never echoes it", () => {
    const sentinel = "sk-legacy-sentinel";
    state = {
      ...emptyState(),
      vendors: [{
        key: "saved-gateway",
        name: "Saved Gateway",
        enabled: true,
        baseUrlHint: "https://gateway.example.test/v1",
        authType: "bearer",
        createdAt: now,
        updatedAt: now,
      }],
      apiKeysByVendor: {
        "saved-gateway": {
          vendorKey: "saved-gateway",
          apiKey: sentinel,
          enc: "plain",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    };

    let error: unknown;
    try {
      defaultCatalog.register({
        vendorKey: "saved-gateway",
        vendorName: "Saved Gateway",
        baseUrl: "https://gateway.example.test/v1",
        apiKey: "",
        authType: "bearer",
        providerKind: "openai-compatible",
        preserveExistingCredential: true,
        models: [{ modelKey: "new-image", kind: "image" }],
        savedAt: now,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("save");
    expect(String(error)).not.toContain(sentinel);
    expect(upsertVendor).not.toHaveBeenCalled();
    expect(upsertApiKey).not.toHaveBeenCalled();
  });

  it("preserves executable existing models and their adapter, mapping, and custom-call capability", () => {
    const oldAdapter = {
      state: "verified",
      runId: "run-old",
      activeRevision: "revision-old",
      modes: [{ taskKind: "text_to_image", state: "verified", attempts: 1 }],
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    state = {
      ...emptyState(),
      vendors: [{
        key: "saved-gateway",
        name: "Saved Gateway",
        enabled: true,
        baseUrlHint: "https://gateway.example.test/v1",
        authType: "bearer",
        createdAt: now,
        updatedAt: now,
      }],
      models: [
        {
          vendorKey: "saved-gateway",
          modelKey: "revision-image",
          labelZh: "Revision image",
          kind: "image",
          enabled: true,
          meta: { adapter: oldAdapter, parameters: [{ key: "size" }] },
          onboarding: { addedVia: "agent", addedAt: "2026-08-01T00:00:00.000Z", fields: [] },
          createdAt: now,
          updatedAt: now,
        },
        {
          vendorKey: "saved-gateway",
          modelKey: "script-video",
          labelZh: "Script video",
          kind: "video",
          enabled: true,
          customCall: { script: "return { assets: ['https://example.test/a.mp4'] }", updatedAt: now },
          meta: { adapter: { state: "failed", modes: [], updatedAt: now } },
          createdAt: now,
          updatedAt: now,
        },
        {
          vendorKey: "saved-gateway",
          modelKey: "mapped-audio",
          labelZh: "Mapped audio",
          kind: "audio",
          enabled: true,
          meta: { adapter: { state: "partial", modes: [], updatedAt: now } },
          createdAt: now,
          updatedAt: now,
        },
        {
          vendorKey: "saved-gateway",
          modelKey: "no-contract-image",
          labelZh: "No contract image",
          kind: "image",
          enabled: true,
          meta: { adapter: { state: "failed", modes: [], updatedAt: now } },
          createdAt: now,
          updatedAt: now,
        },
      ],
      mappings: [
        {
          id: "generic-audio",
          vendorKey: "saved-gateway",
          taskKind: "text_to_audio",
          name: "Generic audio",
          enabled: true,
          create: { method: "POST", path: "/audio" },
          createdAt: now,
          updatedAt: now,
        },
      ],
      apiKeysByVendor: {
        "saved-gateway": {
          vendorKey: "saved-gateway",
          apiKey: "encrypted-record",
          enabled: true,
          enc: "safeStorage",
          createdAt: now,
          updatedAt: now,
        },
      },
    };

    const registered = defaultCatalog.register({
      vendorKey: "saved-gateway",
      vendorName: "Saved Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "",
      authType: "bearer",
      providerKind: "openai-compatible",
      preserveExistingCredential: true,
      models: state.models.map(({ modelKey, labelZh, kind }) => modelKey === "revision-image"
        ? { modelKey, labelZh: "Unverified replacement", kind: "video" as const }
        : { modelKey, labelZh, kind }),
      savedAt: now,
    });

    const returned = new Map(registered.models.map((model) => [model.modelKey, model]));
    const writes = new Map(upsertModel.mock.calls.map(([model]) => [model.modelKey, model]));
    expect(registered.vendor.key).not.toBe("saved-gateway");
    expect(returned.get("revision-image")).toMatchObject({
      labelZh: "Unverified replacement",
      kind: "video",
      enabled: false,
      meta: { adapter: { state: "unverified" } },
      onboarding: { addedVia: "manual" },
    });
    expect(returned.get("script-video")).toMatchObject({
      enabled: false,
      meta: { adapter: { state: "unverified" } },
    });
    expect(returned.get("mapped-audio")).toMatchObject({
      enabled: false,
      meta: { adapter: { state: "unverified" } },
    });
    expect(writes.get("no-contract-image")).toMatchObject({
      enabled: false,
      meta: { adapter: { state: "unverified", modes: [], updatedAt: now } },
      onboarding: { addedVia: "manual", addedAt: now, fields: [] },
    });
    expect(state.models.find((model) => model.modelKey === "revision-image")).toMatchObject({
      labelZh: "Revision image",
      kind: "image",
      enabled: true,
      meta: { adapter: oldAdapter, parameters: [{ key: "size" }] },
      onboarding: { addedVia: "agent" },
    });
    expect(state.models.find((model) => model.modelKey === "script-video")).toMatchObject({
      enabled: true,
      customCall: { script: expect.stringContaining("assets") },
    });
    expect(state.mappings).toHaveLength(1);
  });

  it("stages a replacement connection under an isolated vendor identity without touching the published vendor or credential", () => {
    const activeVendor: Vendor = {
      key: "shared-gateway",
      name: "Shared Gateway",
      enabled: true,
      baseUrlHint: "https://gateway.example.test/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      meta: { extraHeaders: { "X-Active": "yes" } },
      createdAt: now,
      updatedAt: now,
    };
    const activeCredential = {
      vendorKey: activeVendor.key,
      apiKey: "encrypted-active-key",
      enc: "safeStorage" as const,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    state = {
      ...emptyState(),
      vendors: [activeVendor],
      models: [
        { vendorKey: activeVendor.key, modelKey: "target", labelZh: "Target", kind: "image", enabled: true, createdAt: now, updatedAt: now },
        { vendorKey: activeVendor.key, modelKey: "sibling", labelZh: "Sibling", kind: "video", enabled: true, createdAt: now, updatedAt: now },
      ],
      mappings: [
        { id: "target-map", vendorKey: activeVendor.key, modelKey: "target", taskKind: "text_to_image", name: "target", enabled: true, create: { method: "POST", path: "/active-target" }, createdAt: now, updatedAt: now },
        { id: "sibling-map", vendorKey: activeVendor.key, modelKey: "sibling", taskKind: "text_to_video", name: "sibling", enabled: true, create: { method: "POST", path: "/active-sibling" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: { [activeVendor.key]: activeCredential },
    };
    const before = structuredClone(state);

    const registered = defaultCatalog.register({
      catalogVendorKey: activeVendor.key,
      vendorKey: activeVendor.key,
      vendorName: "Candidate Gateway",
      baseUrl: "https://gateway.example.test/v2",
      apiKey: "candidate-secret",
      authType: "bearer",
      providerKind: "openai-responses",
      headers: { "X-Candidate": "yes" },
      models: [{ modelKey: "target", labelZh: "Candidate Target", kind: "video" }],
      savedAt: now,
    });

    expect(registered.vendor.key).not.toBe(activeVendor.key);
    expect(upsertVendor).not.toHaveBeenCalledWith(expect.objectContaining({ key: activeVendor.key }));
    expect(upsertVendor).toHaveBeenCalledWith(expect.objectContaining({
      key: registered.vendor.key,
      baseUrlHint: "https://gateway.example.test/v2",
      providerKind: "openai-responses",
      enabled: false,
      meta: expect.objectContaining({ adapterCandidateSourceVendorKey: activeVendor.key }),
    }));
    expect(upsertApiKey).toHaveBeenCalledWith(registered.vendor.key, { apiKey: "candidate-secret", enabled: true });
    expect(upsertApiKey).not.toHaveBeenCalledWith(activeVendor.key, expect.anything());
    expect(upsertModel).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: registered.vendor.key,
      modelKey: "target",
      kind: "video",
      enabled: false,
    }));
    expect(state).toEqual(before);
  });
});
