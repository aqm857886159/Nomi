// 不变量钉子（2026-08-12 用户拍板）：**验证结果不得决定「给不给用」。**
//
// 旧行为 `enabled: existing.enabled || verifiedForModel.length > 0` 把探测结果变成了准入闸：
// 没验过 → 模型停用 → 画布里根本看不见；再叠上 isAdapterModelLocked 锁住勾选框，
// 用户连手动启用都做不到，只能删掉整个供应商重来。而失败若源于我们自己探测的 bug
// （2026-08-11 接 DeepSeek 那次正是：探测只给 24 token，思考型模型正文被截空），
// 重来多少遍都一样 → 「接不进来」。
//
// 用户明确要求加的模型就该加进来，没验过的标出来让他自己试。
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
  modelKey: "deepseek-v3.1-250821",
  labelZh: "deepseek-v3.1-250821",
  kind: "text",
  enabled: false,
  createdAt: now,
  updatedAt: now,
};

const upsertModel = vi.fn();
const upsertVendor = vi.fn();
vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => ({ vendors: [vendor], models: [model], mappings: [], apiKeysByVendor: {} }),
  mutateCatalog: (fn: (tx: unknown) => void) =>
    fn({ upsertModel, upsertVendor, upsertMapping: vi.fn(), deleteMapping: vi.fn() }),
  extractVendorExtraHeaders: () => ({}),
  normalizeProviderKind: (v: unknown) => v ?? "openai-compatible",
}));

const { defaultCatalog } = await import("./service");

function promoteWithEverythingFailed(): void {
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
  defaultCatalog.promote({
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
  it("still enables the model when every mode failed verification", () => {
    upsertModel.mockClear();
    upsertVendor.mockClear();

    promoteWithEverythingFailed();

    expect(upsertModel).toHaveBeenCalledWith(expect.objectContaining({ modelKey: model.modelKey, enabled: true }));
    expect(upsertVendor).toHaveBeenCalledWith(expect.objectContaining({ key: vendor.key, enabled: true }));
  });

  it("records the failure on the model so the UI can mark it unverified", () => {
    upsertModel.mockClear();

    promoteWithEverythingFailed();

    const [written] = upsertModel.mock.calls[0] as [{ meta?: { adapter?: { state?: string } } }];
    expect(written.meta?.adapter?.state).toBe("failed");
  });
});
