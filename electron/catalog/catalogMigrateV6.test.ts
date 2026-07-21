// v5 → v6：把存量中转里的 Grok Imagine 改图从 vendor 级 chat mapping 精确分流到 JSON /images/edits。
import { describe, expect, it } from "vitest";
import { migrateRelayImageEditProtocols } from "./catalogStore";
import { NEWAPI_IMAGE_EDIT_OP, XAI_JSON_IMAGE_EDIT_OP } from "./newapiTransport";
import { CURRENT_CATALOG_VERSION, type CatalogState, type Mapping, type Model, type Vendor } from "./types";

const NOW = "2026-07-18T00:00:00.000Z";

const vendor: Vendor = {
  key: "mixed-relay", name: "混合图片中转", enabled: true, hasApiKey: true,
  baseUrlHint: "https://mixed-relay.example.com", authType: "bearer", authHeader: null,
  authQueryParam: null, providerKind: "openai-compatible", createdAt: NOW, updatedAt: NOW,
};

const imageModel = (modelKey: string): Model => ({
  modelKey, vendorKey: vendor.key, modelAlias: modelKey, labelZh: modelKey,
  kind: "image", enabled: true,
  meta: { imageOptions: { supportsReferenceImages: true } },
  createdAt: NOW, updatedAt: NOW,
});

const mapping = (taskKind: Mapping["taskKind"], create: Mapping["create"]): Mapping => ({
  id: `mapping-${taskKind}`, vendorKey: vendor.key, taskKind, name: taskKind,
  enabled: true, create, createdAt: NOW, updatedAt: NOW,
});

const state = (): CatalogState => ({
  version: 5,
  vendors: [vendor],
  models: [imageModel("google/nano-banana-edit"), imageModel("grok-imagine-image-quality")],
  mappings: [
    mapping("text_to_image", { method: "POST", path: "/v1/images/generations", body: {} }),
    mapping("image_edit", NEWAPI_IMAGE_EDIT_OP),
  ],
  apiKeysByVendor: {},
});

describe("migrateRelayImageEditProtocols（v5→v6）", () => {
  it("保留 chat generic，并为 Grok 增加 modelKey 精确 JSON edits mapping", () => {
    const migrated = migrateRelayImageEditProtocols(state());
    expect(migrated.changed).toBe(true);
    const edits = migrated.state.mappings.filter((item) => item.taskKind === "image_edit");
    expect(edits).toHaveLength(2);
    expect(edits.find((item) => !item.modelKey)?.create).toEqual(NEWAPI_IMAGE_EDIT_OP);
    expect(edits.find((item) => item.modelKey === "grok-imagine-image-quality")?.create).toEqual(XAI_JSON_IMAGE_EDIT_OP);
    const grok = migrated.state.models.find((item) => item.modelKey === "grok-imagine-image-quality");
    expect(grok?.meta).toMatchObject({ imageOptions: { supportsReferenceImages: true, imageEditProtocol: "xai-json-edits" } });
  });

  it("幂等：再次迁移不重复添加精确 mapping", () => {
    const first = migrateRelayImageEditProtocols(state());
    const second = migrateRelayImageEditProtocols(first.state);
    expect(second.changed).toBe(false);
    expect(second.state.mappings.filter((item) => item.modelKey === "grok-imagine-image-quality")).toHaveLength(1);
  });

  it("CURRENT_CATALOG_VERSION 已推进到 7（v7=存量 gpt-image 重迁移到 multipart）", () => {
    expect(CURRENT_CATALOG_VERSION).toBe(7);
  });
});
