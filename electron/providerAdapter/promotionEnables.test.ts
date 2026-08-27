// 发布不变量：配置成功只进入 settings staging；只有真实 verified executable mode 才进入生产目录。
import { describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";

const now = "2026-08-12T00:00:00.000Z";
const vendor: Vendor = {
  key: "api-deepseek-com",
  name: "DeepSeek",
  enabled: false,
  baseUrlHint: "https://api.deepseek.com/v1",
  authType: "bearer",
  providerKind: "openai-compatible",
  createdAt: now,
  updatedAt: now,
};
const model: Model = {
  vendorKey: vendor.key,
  modelKey: "deepseek-v4-pro",
  labelZh: "deepseek-v4-pro",
  kind: "text",
  enabled: false,
  meta: { adapter: { state: "testing", runId: "run-1", modes: [], updatedAt: now } },
  createdAt: now,
  updatedAt: now,
};

const upsertModel = vi.fn();
const upsertVendor = vi.fn();
const upsertApiKey = vi.fn();
const deleteApiKey = vi.fn();
vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => ({ vendors: [vendor], models: [model], mappings: [], apiKeysByVendor: {} }),
  mutateCatalog: (fn: (tx: unknown) => void) =>
    fn({ upsertModel, upsertVendor, upsertApiKey, deleteApiKey, upsertMapping: vi.fn(), deleteMapping: vi.fn() }),
  extractVendorExtraHeaders: () => ({}),
  normalizeProviderKind: (v: unknown) => v ?? "openai-compatible",
}));

const { defaultCatalog } = await import("./service");

function promoteWithEverythingFailed() {
  const draft = {
    models: [
      {
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: "text" as const,
        modes: [{ taskKind: "chat" as const, create: { method: "POST", path: "/chat/completions" }, testParams: {}, sourceUrls: [] }],
      },
    ],
  };
  return defaultCatalog.promote({
    run: {
      id: "run-1",
      vendorKey: vendor.key,
      vendorName: vendor.name,
      connectionFingerprint: "fp",
      selectedModelKeys: [model.modelKey],
      stage: "failed",
      repairAttempt: 0,
      models: [
        {
          modelKey: model.modelKey,
          labelZh: model.labelZh,
          kind: "text",
          modes: [{ taskKind: "chat", state: "failed", attempts: 1, stage: "create", error: "empty reply" }],
        },
      ],
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    },
    draft,
    revision: { id: "rev-1", vendorKey: vendor.key, digest: "d", draft, verifiedModes: [], createdAt: now },
    verifiedModes: [],
  } as unknown as Parameters<typeof defaultCatalog.promote>[0]);
}

describe("adapter promotion", () => {
  it("stages a keyless gateway by deleting stale credentials instead of writing an empty key", () => {
    upsertApiKey.mockClear();
    deleteApiKey.mockClear();
    upsertVendor.mockImplementationOnce((payload) => payload);
    upsertModel.mockImplementationOnce((payload) => payload);

    defaultCatalog.stage({
      vendorKey: "local-gateway",
      runId: "run-keyless",
      vendorName: "Local Gateway",
      baseUrl: "http://192.168.1.8:8000/v1",
      apiKey: "",
      authType: "none",
      providerKind: "openai-compatible",
      models: [{ modelKey: "local-image", labelZh: "Local Image", kind: "image" }],
    });

    expect(deleteApiKey).toHaveBeenCalledWith("local-gateway");
    expect(upsertApiKey).not.toHaveBeenCalled();
  });

  it("rejects zero-verified promotion without writing model or vendor state", () => {
    upsertModel.mockClear();
    upsertVendor.mockClear();

    const result = promoteWithEverythingFailed();

    expect(result).toEqual({ status: "no-lease" });
    expect(upsertModel).not.toHaveBeenCalled();
    expect(upsertVendor).not.toHaveBeenCalled();
  });

  it("leaves failure recording to the fail lifecycle rather than promotion", () => {
    upsertModel.mockClear();

    const result = promoteWithEverythingFailed();

    expect(result).toEqual({ status: "no-lease" });
    expect(upsertModel).not.toHaveBeenCalled();
  });
});
