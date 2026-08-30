import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState, Mapping, Model, Vendor } from "../catalog/types";
import { deleteVendorLineageAndRestore } from "../catalog/vendorLineageLifecycle";
import type { ProviderAdapterDraft, ProviderAdapterRun } from "./types";

const now = "2026-08-15T00:00:00.000Z";
const vendorKey = "shared-provider";
const modelKey = "image-v1";

function initialState(): CatalogState {
  return {
    version: 8,
    vendors: [{
      key: vendorKey,
      name: "Shared Provider",
      enabled: false,
      baseUrlHint: "http://127.0.0.1:9000/v1",
      authType: "none",
      providerKind: "openai-compatible",
      createdAt: now,
      updatedAt: now,
    }],
    models: [{
      vendorKey,
      modelKey,
      labelZh: "Image V1",
      kind: "image",
      enabled: false,
      createdAt: now,
      updatedAt: now,
    }],
    mappings: [],
    apiKeysByVendor: {},
  };
}

let state = initialState();

const upsertVendor = vi.fn((payload: unknown): Vendor => {
  const raw = payload as Vendor;
  const index = state.vendors.findIndex((vendor) => vendor.key === raw.key);
  const next = { ...(index >= 0 ? state.vendors[index] : {}), ...structuredClone(raw) } as Vendor;
  if (index >= 0) state.vendors[index] = next;
  else state.vendors.push(next);
  return structuredClone(next);
});

const upsertModel = vi.fn((payload: unknown): Model => {
  const raw = payload as Model;
  const index = state.models.findIndex((model) => model.vendorKey === raw.vendorKey && model.modelKey === raw.modelKey);
  const next = {
    ...(index >= 0 ? state.models[index] : { createdAt: now }),
    ...structuredClone(raw),
    updatedAt: raw.updatedAt || now,
  } as Model;
  if (index >= 0) state.models[index] = next;
  else state.models.push(next);
  return structuredClone(next);
});

const upsertMapping = vi.fn((payload: unknown): Mapping => {
  const raw = payload as Mapping;
  const index = state.mappings.findIndex(
    (mapping) => mapping.vendorKey === raw.vendorKey && mapping.modelKey === raw.modelKey && mapping.taskKind === raw.taskKind,
  );
  const next = {
    ...(index >= 0 ? state.mappings[index] : { id: `mapping-${raw.modelKey}-${raw.taskKind}`, createdAt: now }),
    ...structuredClone(raw),
    updatedAt: raw.updatedAt || now,
  } as Mapping;
  if (index >= 0) state.mappings[index] = next;
  else state.mappings.push(next);
  return structuredClone(next);
});

const upsertApiKey = vi.fn((key: string, payload: { apiKey?: string; enabled?: boolean }) => {
  state.apiKeysByVendor[key] = {
    vendorKey: key,
    apiKey: String(payload.apiKey || ""),
    enc: "safeStorage",
    enabled: payload.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
});

const deleteApiKey = vi.fn((key: string) => {
  delete state.apiKeysByVendor[key];
});

const deleteVendor = vi.fn((key: string) => {
  state.vendors = state.vendors.filter((vendor) => vendor.key !== key);
  state.models = state.models.filter((model) => model.vendorKey !== key);
  state.mappings = state.mappings.filter((mapping) => mapping.vendorKey !== key);
  delete state.apiKeysByVendor[key];
});

vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => structuredClone(state),
  mutateCatalog: <T>(fn: (tx: unknown) => T): T => fn({
    upsertVendor,
    upsertModel,
    upsertMapping,
    upsertApiKey,
    deleteApiKey,
    deleteVendor,
    deleteModelMappings: vi.fn(),
  }),
  extractVendorExtraHeaders: () => undefined,
  normalizeProviderKind: (value: unknown) => value ?? "openai-compatible",
}));

const { defaultCatalog } = await import("./serviceCatalog");

function stage(runId: string): void {
  defaultCatalog.stage({
    vendorKey,
    runId,
    vendorName: "Shared Provider",
    baseUrl: "http://127.0.0.1:9000/v1",
    apiKey: "",
    authType: "none",
    providerKind: "openai-compatible",
    models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
  });
}

function draft(path: string): ProviderAdapterDraft {
  return {
    provider: { baseUrl: "http://127.0.0.1:9000/v1", authType: "none", providerKind: "openai-compatible" },
    sources: [],
    models: [{
      modelKey,
      labelZh: "Image V1",
      kind: "image",
      modes: [{ taskKind: "text_to_image", create: { method: "POST", path }, testParams: {}, sourceUrls: [] }],
    }],
  };
}

function run(runId: string, stage: ProviderAdapterRun["stage"], modeState: "verified" | "failed"): ProviderAdapterRun {
  return {
    id: runId,
    vendorKey,
    vendorName: "Shared Provider",
    connectionFingerprint: `fingerprint-${runId}`,
    selectedModelKeys: [modelKey],
    stage,
    repairAttempt: 0,
    models: [{
      modelKey,
      labelZh: "Image V1",
      kind: "image",
      modes: [{
        taskKind: "text_to_image",
        state: modeState,
        attempts: 1,
        ...(modeState === "failed" ? { stage: "create" as const, error: "cancelled" } : {}),
      }],
    }],
    sourceUrls: [],
    createdAt: now,
    updatedAt: now,
  };
}

function promote(runId: string, path: string): void {
  const candidate = draft(path);
  const completed = run(runId, "completed", "verified");
  defaultCatalog.promote({
    run: completed,
    draft: candidate,
    revision: {
      id: `revision-${runId}`,
      vendorKey,
      digest: `digest-${runId}`,
      draft: candidate,
      verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
      createdAt: now,
    },
    verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
  });
}

describe("provider adapter catalog run ownership", () => {
  beforeEach(() => {
    state = initialState();
    vi.clearAllMocks();
  });

  it.each(["cancelled", "timed_out", "failed"] as const)(
    "keeps run B metadata when run A becomes %s after B completes",
    (terminalStage) => {
      stage("run-a");
      stage("run-b");
      promote("run-b", "/images/from-b");
      const afterB = structuredClone(state);
      const writesAfterB = upsertModel.mock.calls.length;

      defaultCatalog.fail(run("run-a", terminalStage, "failed"));

      expect(state).toEqual(afterB);
      expect(upsertModel).toHaveBeenCalledTimes(writesAfterB);
      expect((state.models[0].meta as { adapter: { runId: string } }).adapter.runId).toBe("run-b");
    },
  );

  it("ignores a late promote from run A after run B owns and completes the model", () => {
    stage("run-a");
    stage("run-b");
    promote("run-b", "/images/from-b");
    const afterB = structuredClone(state);

    promote("run-a", "/images/from-a");

    expect(state).toEqual(afterB);
    expect(state.mappings[0]?.create.path).toBe("/images/from-b");
  });

  it("keeps a shared published connection byte-identical when a replacement run fails", () => {
    state = {
      ...initialState(),
      vendors: [{ ...initialState().vendors[0], enabled: true, baseUrlHint: "https://active.example.test/v1", authType: "bearer" }],
      models: [
        { ...initialState().models[0], enabled: true },
        { ...initialState().models[0], modelKey: "video-sibling", labelZh: "Video sibling", kind: "video", enabled: true },
      ],
      mappings: [
        { id: "active-image", vendorKey, modelKey, taskKind: "text_to_image", name: "active image", enabled: true, create: { method: "POST", path: "/active-image" }, createdAt: now, updatedAt: now },
        { id: "active-video", vendorKey, modelKey: "video-sibling", taskKind: "text_to_video", name: "active video", enabled: true, create: { method: "POST", path: "/active-video" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: "encrypted-active", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now } },
    };
    const activeBefore = structuredClone(state);

    const staged = defaultCatalog.stage({
      catalogVendorKey: vendorKey,
      vendorKey,
      runId: "replacement-run",
      vendorName: "Replacement",
      baseUrl: "https://candidate.example.test/v2",
      apiKey: "candidate-secret",
      authType: "bearer",
      providerKind: "openai-responses",
      headers: { "X-Candidate": "yes" },
      models: [{ modelKey, labelZh: "Candidate image", kind: "video" }],
    });

    expect(staged.vendor.key).not.toBe(vendorKey);
    expect(state.vendors.find((vendor) => vendor.key === vendorKey)).toEqual(activeBefore.vendors[0]);
    expect(state.models.filter((model) => model.vendorKey === vendorKey)).toEqual(activeBefore.models);
    expect(state.mappings.filter((mapping) => mapping.vendorKey === vendorKey)).toEqual(activeBefore.mappings);
    expect(state.apiKeysByVendor[vendorKey]).toEqual(activeBefore.apiKeysByVendor[vendorKey]);

    defaultCatalog.fail({
      ...run("replacement-run", "failed", "failed"),
      vendorKey: staged.vendor.key,
    });

    expect(state.vendors.find((vendor) => vendor.key === vendorKey)).toEqual(activeBefore.vendors[0]);
    expect(state.models.filter((model) => model.vendorKey === vendorKey)).toEqual(activeBefore.models);
    expect(state.mappings.filter((mapping) => mapping.vendorKey === vendorKey)).toEqual(activeBefore.mappings);
    expect(state.apiKeysByVendor[vendorKey]).toEqual(activeBefore.apiKeysByVendor[vendorKey]);
    expect(state.vendors.some((vendor) => vendor.key === staged.vendor.key)).toBe(false);
    expect(state.models.some((model) => model.vendorKey === staged.vendor.key)).toBe(false);
    expect(state.mappings.some((mapping) => mapping.vendorKey === staged.vendor.key)).toBe(false);
    expect(state.apiKeysByVendor[staged.vendor.key]).toBeUndefined();
  });

  it("switches only the verified target to the candidate connection and leaves its published sibling active", () => {
    state = {
      ...initialState(),
      vendors: [{ ...initialState().vendors[0], enabled: true, baseUrlHint: "https://active.example.test/v1", authType: "bearer" }],
      models: [
        { ...initialState().models[0], enabled: true },
        { ...initialState().models[0], modelKey: "video-sibling", labelZh: "Video sibling", kind: "video", enabled: true },
      ],
      mappings: [
        { id: "active-image", vendorKey, modelKey, taskKind: "text_to_image", name: "active image", enabled: true, create: { method: "POST", path: "/active-image" }, createdAt: now, updatedAt: now },
        { id: "active-video", vendorKey, modelKey: "video-sibling", taskKind: "text_to_video", name: "active video", enabled: true, create: { method: "POST", path: "/active-video" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: "encrypted-active", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now } },
    };
    const staged = defaultCatalog.stage({
      catalogVendorKey: vendorKey,
      vendorKey,
      runId: "replacement-run",
      vendorName: "Replacement",
      baseUrl: "https://candidate.example.test/v2",
      apiKey: "candidate-secret",
      authType: "bearer",
      providerKind: "openai-responses",
      models: [{ modelKey, labelZh: "Candidate image", kind: "image" }],
    });
    const candidateDraft: ProviderAdapterDraft = {
      provider: { baseUrl: "https://candidate.example.test/v2", authType: "bearer", providerKind: "openai-responses" },
      sources: [],
      models: [{
        modelKey,
        labelZh: "Candidate image",
        kind: "image",
        modes: [{ taskKind: "text_to_image", create: { method: "POST", path: "/candidate-image" }, testParams: {}, sourceUrls: [] }],
      }],
    };
    const completed = { ...run("replacement-run", "completed", "verified"), vendorKey: staged.vendor.key };

    defaultCatalog.promote({
      run: completed,
      draft: candidateDraft,
      revision: {
        id: "replacement-revision",
        vendorKey: staged.vendor.key,
        digest: "replacement-digest",
        draft: candidateDraft,
        verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
        createdAt: now,
      },
      verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
    });

    expect(state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)?.enabled).toBe(false);
    expect(state.mappings.find((mapping) => mapping.id === "active-image")?.enabled).toBe(false);
    expect(state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === "video-sibling")?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "active-video")).toMatchObject({ enabled: true, create: { path: "/active-video" } });
    expect(state.vendors.find((vendor) => vendor.key === vendorKey)?.enabled).toBe(true);
    expect(state.models.find((model) => model.vendorKey === staged.vendor.key && model.modelKey === modelKey)?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.vendorKey === staged.vendor.key && mapping.modelKey === modelKey)).toMatchObject({
      enabled: true,
      create: { path: "/candidate-image" },
    });
  });

  it("allocates a fresh revision for the same promoted connection when only the API key changes", () => {
    state = {
      ...initialState(),
      vendors: [{ ...initialState().vendors[0], enabled: true, authType: "bearer" }],
      models: [{ ...initialState().models[0], enabled: true }],
      mappings: [{
        id: "active-image",
        vendorKey,
        modelKey,
        taskKind: "text_to_image",
        name: "active image",
        enabled: true,
        create: { method: "POST", path: "/active-image" },
        createdAt: now,
        updatedAt: now,
      }],
      apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: "encrypted-root", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now } },
    };
    const first = defaultCatalog.stage({
      catalogVendorKey: vendorKey,
      vendorKey,
      runId: "run-first",
      vendorName: "Shared Provider",
      baseUrl: "http://127.0.0.1:9000/v1",
      apiKey: "first-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
    });
    const firstDraft = draft("/first-candidate");
    const firstRun = { ...run("run-first", "completed", "verified"), vendorKey: first.vendor.key };
    defaultCatalog.promote({
      run: firstRun,
      draft: firstDraft,
      revision: {
        id: "revision-first",
        vendorKey: first.vendor.key,
        digest: "digest-first",
        draft: firstDraft,
        verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
        createdAt: now,
      },
      verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
    });
    const promotedBefore = structuredClone(state);

    const second = defaultCatalog.stage({
      catalogVendorKey: vendorKey,
      vendorKey,
      runId: "run-second",
      vendorName: "Shared Provider",
      baseUrl: "http://127.0.0.1:9000/v1",
      apiKey: "second-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
    });

    expect(second.vendor.key).not.toBe(first.vendor.key);
    expect(second.vendor.key.match(/--candidate-/g)).toHaveLength(1);
    expect(second.vendor.meta).toMatchObject({
      adapterCandidateSourceVendorKey: first.vendor.key,
      adapterCandidateRootVendorKey: vendorKey,
      adapterCandidateRevisionId: "run-second",
    });
    expect(state.apiKeysByVendor[first.vendor.key]).toEqual(promotedBefore.apiKeysByVendor[first.vendor.key]);
    expect(state.vendors.find((vendor) => vendor.key === first.vendor.key)).toEqual(
      promotedBefore.vendors.find((vendor) => vendor.key === first.vendor.key),
    );

    defaultCatalog.fail({ ...run("run-second", "failed", "failed"), vendorKey: second.vendor.key });

    expect(state.apiKeysByVendor[first.vendor.key]).toEqual(promotedBefore.apiKeysByVendor[first.vendor.key]);
    expect(state.models.find((model) => model.vendorKey === first.vendor.key && model.modelKey === modelKey)?.enabled).toBe(true);
    expect(state.vendors.some((vendor) => vendor.key === second.vendor.key)).toBe(false);
  });

  it.each(["failed", "cancelled", "timed_out", "stale"] as const)(
    "removes the whole unpublished candidate lineage when a run becomes %s",
    (terminalStage) => {
      state = {
        ...initialState(),
        vendors: [{ ...initialState().vendors[0], enabled: true }],
        models: [{ ...initialState().models[0], enabled: true }],
        mappings: [{ id: "active-image", vendorKey, modelKey, taskKind: "text_to_image", name: "active", enabled: true, create: { method: "POST", path: "/active" }, createdAt: now, updatedAt: now }],
      };
      const staged = defaultCatalog.stage({
        vendorKey,
        runId: `run-${terminalStage}`,
        vendorName: "Candidate",
        baseUrl: "https://candidate.example.test/v1",
        apiKey: "candidate-key",
        authType: "bearer",
        providerKind: "openai-compatible",
        models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
      });
      state.mappings.push({ id: `staged-${terminalStage}`, vendorKey: staged.vendor.key, modelKey, taskKind: "text_to_image", name: "staged", enabled: false, create: { method: "POST", path: "/staged" }, createdAt: now, updatedAt: now });

      defaultCatalog.fail({ ...run(`run-${terminalStage}`, terminalStage, "failed"), vendorKey: staged.vendor.key });

      expect(state.vendors.some((vendor) => vendor.key === staged.vendor.key)).toBe(false);
      expect(state.models.some((model) => model.vendorKey === staged.vendor.key)).toBe(false);
      expect(state.mappings.some((mapping) => mapping.vendorKey === staged.vendor.key)).toBe(false);
      expect(state.apiKeysByVendor[staged.vendor.key]).toBeUndefined();
    },
  );

  it("deletes an older unpublished candidate when a newer run supersedes the same lineage", () => {
    state = {
      ...initialState(),
      vendors: [{ ...initialState().vendors[0], enabled: true }],
      models: [{ ...initialState().models[0], enabled: true }],
      mappings: [{ id: "active-image", vendorKey, modelKey, taskKind: "text_to_image", name: "active", enabled: true, create: { method: "POST", path: "/active" }, createdAt: now, updatedAt: now }],
    };
    const first = defaultCatalog.stage({
      vendorKey,
      runId: "run-old",
      vendorName: "Candidate",
      baseUrl: "https://candidate.example.test/v1",
      apiKey: "old-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
    });
    const second = defaultCatalog.stage({
      vendorKey,
      runId: "run-new",
      vendorName: "Candidate",
      baseUrl: "https://candidate.example.test/v1",
      apiKey: "new-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey, labelZh: "Image V1", kind: "image" }],
    });

    expect(second.vendor.key).not.toBe(first.vendor.key);
    expect(state.vendors.some((vendor) => vendor.key === first.vendor.key)).toBe(false);
    expect(state.models.some((model) => model.vendorKey === first.vendor.key)).toBe(false);
    expect(state.apiKeysByVendor[first.vendor.key]).toBeUndefined();
  });

  it("idempotently reuses the unpublished candidate for the same run id", () => {
    state = {
      ...initialState(),
      vendors: [{ ...initialState().vendors[0], enabled: true }],
      models: [{ ...initialState().models[0], enabled: true }],
      mappings: [{ id: "active-image", vendorKey, modelKey, taskKind: "text_to_image", name: "active", enabled: true, create: { method: "POST", path: "/active" }, createdAt: now, updatedAt: now }],
    };
    const input = {
      vendorKey,
      runId: "same-run",
      vendorName: "Candidate",
      baseUrl: "https://candidate.example.test/v1",
      apiKey: "same-key",
      authType: "bearer" as const,
      providerKind: "openai-compatible" as const,
      models: [{ modelKey, labelZh: "Image V1", kind: "image" as const }],
    };

    const first = defaultCatalog.stage(input);
    const second = defaultCatalog.stage(input);

    expect(second.vendor.key).toBe(first.vendor.key);
    expect(state.vendors.filter((vendor) => vendor.key.includes("--candidate-"))).toHaveLength(1);
  });

  it("tracks a predecessor per model when active models span root and a promoted candidate", () => {
    const promotedVendorKey = `${vendorKey}--candidate-promoted`;
    state = {
      ...initialState(),
      vendors: [
        { ...initialState().vendors[0], enabled: true, authType: "bearer" },
        {
          ...initialState().vendors[0],
          key: promotedVendorKey,
          enabled: true,
          authType: "bearer",
          meta: {
            adapterCandidateSourceVendorKey: vendorKey,
            adapterCandidateRootVendorKey: vendorKey,
            adapterCandidateRevisionId: "promoted-a",
          },
        },
      ],
      models: [
        { ...initialState().models[0], enabled: false },
        { ...initialState().models[0], vendorKey: promotedVendorKey, enabled: true },
        { ...initialState().models[0], modelKey: "video-b", labelZh: "Video B", kind: "video", enabled: true },
      ],
      mappings: [
        { id: "root-a", vendorKey, modelKey, taskKind: "text_to_image", name: "root a", enabled: false, create: { method: "POST", path: "/root-a" }, createdAt: now, updatedAt: now },
        { id: "promoted-a", vendorKey: promotedVendorKey, modelKey, taskKind: "text_to_image", name: "promoted a", enabled: true, create: { method: "POST", path: "/promoted-a" }, createdAt: now, updatedAt: now },
        { id: "root-b", vendorKey, modelKey: "video-b", taskKind: "text_to_video", name: "root b", enabled: true, create: { method: "POST", path: "/root-b" }, createdAt: now, updatedAt: now },
      ],
      apiKeysByVendor: {
        [vendorKey]: { vendorKey, apiKey: "encrypted-root", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now },
        [promotedVendorKey]: { vendorKey: promotedVendorKey, apiKey: "encrypted-promoted", enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now },
      },
    };

    const staged = defaultCatalog.stage({
      catalogVendorKey: vendorKey,
      vendorKey,
      runId: "run-multi",
      vendorName: "Multi candidate",
      baseUrl: "https://multi.example.test/v1",
      apiKey: "multi-key",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [
        { modelKey, labelZh: "Image A", kind: "image" },
        { modelKey: "video-b", labelZh: "Video B", kind: "video" },
      ],
    });

    expect(staged.vendor.meta).toMatchObject({
      adapterCandidateModelPredecessors: {
        [modelKey]: { vendorKey: promotedVendorKey, publishedModes: ["text_to_image"] },
        "video-b": { vendorKey, publishedModes: ["text_to_video"] },
      },
    });

    const multiDraft: ProviderAdapterDraft = {
      provider: { baseUrl: "https://multi.example.test/v1", authType: "bearer", providerKind: "openai-compatible" },
      sources: [],
      models: [
        { modelKey, labelZh: "Image A next", kind: "image", modes: [{ taskKind: "text_to_image", create: { method: "POST", path: "/next-a" }, sourceUrls: [] }] },
        { modelKey: "video-b", labelZh: "Video B next", kind: "video", modes: [{ taskKind: "text_to_video", create: { method: "POST", path: "/next-b" }, sourceUrls: [] }] },
      ],
    };
    const multiRun: ProviderAdapterRun = {
      ...run("run-multi", "partial", "verified"),
      vendorKey: staged.vendor.key,
      selectedModelKeys: [modelKey, "video-b"],
      models: [
        run("run-multi", "partial", "verified").models[0],
        { modelKey: "video-b", labelZh: "Video B", kind: "video", modes: [{ taskKind: "text_to_video", state: "failed", attempts: 1, stage: "create", error: "failed" }] },
      ],
    };
    const result = defaultCatalog.promote({
      run: multiRun,
      draft: multiDraft,
      revision: {
        id: "revision-multi",
        vendorKey: staged.vendor.key,
        digest: "digest-multi",
        draft: multiDraft,
        verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
        createdAt: now,
      },
      verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
    });

    expect(result).toEqual({
      status: "committed",
      committedModes: [{ modelKey, taskKind: "text_to_image" }],
    });
    expect(state.models.find((model) => model.vendorKey === promotedVendorKey && model.modelKey === modelKey)?.enabled).toBe(false);
    expect(state.mappings.find((mapping) => mapping.id === "promoted-a")?.enabled).toBe(false);
    expect(state.vendors.find((vendor) => vendor.key === promotedVendorKey)?.enabled).toBe(false);
    expect(state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === "video-b")?.enabled).toBe(true);
    expect(state.models.find((model) => model.vendorKey === staged.vendor.key && model.modelKey === "video-b")?.enabled).toBe(false);
    expect(state.models.filter((model) => model.modelKey === modelKey && model.enabled)).toHaveLength(1);

    deleteVendorLineageAndRestore(state, staged.vendor.key);

    expect(state.vendors.some((vendor) => vendor.key === staged.vendor.key)).toBe(false);
    expect(state.apiKeysByVendor[staged.vendor.key]).toBeUndefined();
    expect(state.models.find((model) => model.vendorKey === promotedVendorKey && model.modelKey === modelKey)?.enabled).toBe(true);
    expect(state.mappings.find((mapping) => mapping.id === "promoted-a")?.enabled).toBe(true);
    expect(state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === "video-b")?.enabled).toBe(true);
    expect(state.models.filter((model) => model.modelKey === modelKey && model.enabled)).toHaveLength(1);
  });

  it("returns no-lease instead of an ambiguous successful void when a candidate no longer owns the model", () => {
    const candidate = draft("/late");
    const result = defaultCatalog.promote({
      run: run("run-without-lease", "completed", "verified"),
      draft: candidate,
      revision: {
        id: "revision-without-lease",
        vendorKey,
        digest: "digest-without-lease",
        draft: candidate,
        verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
        createdAt: now,
      },
      verifiedModes: [{ modelKey, taskKind: "text_to_image" }],
    });

    expect(result).toEqual({ status: "no-lease" });
  });
});
