import { describe, it, expect } from "vitest";
import type { CatalogState } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";

function emptyCatalog(): CatalogState {
  return { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}

const NOW = "2026-06-05T00:00:00.000Z";

describe("applyBuiltinSeeds", () => {
  it("空目录：补齐 kie vendor + Seedance 模型 + 首帧 mapping", () => {
    const { state, changed } = applyBuiltinSeeds(emptyCatalog(), NOW);
    expect(changed).toBe(true);

    const vendor = state.vendors.find((v) => v.key === "kie");
    expect(vendor).toMatchObject({ key: "kie", enabled: true, baseUrlHint: "https://api.kie.ai", authType: "bearer" });

    const model = state.models.find((m) => m.modelKey === "bytedance/seedance-2");
    expect(model).toMatchObject({ vendorKey: "kie", kind: "video", enabled: true });
    expect(model?.meta).toMatchObject({ archetypeId: "seedance-2" });

    const mapping = state.mappings.find((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video");
    expect(mapping).toBeTruthy();
    expect(mapping?.enabled).toBe(true);
    expect(mapping?.create.path).toBe("/api/v1/jobs/createTask");
    expect(mapping?.query?.path).toBe("/api/v1/jobs/recordInfo");
  });

  it("空目录：补齐 HappyHorse 模型 + (kie, text_to_video) mapping（C4）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const model = state.models.find((m) => m.modelKey === "happyhorse");
    expect(model).toMatchObject({ vendorKey: "kie", kind: "video", enabled: true });
    expect(model?.meta).toMatchObject({ archetypeId: "happyhorse" });

    // Seedance Fast：同族扩展只多 1 行 model，复用 Seedance 的 image_to_video mapping（不新增 mapping）。
    const fast = state.models.find((m) => m.modelKey === "bytedance/seedance-2-fast");
    expect(fast?.meta).toMatchObject({ archetypeId: "seedance-2-fast" });
    expect(state.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video")).toHaveLength(1);
    const mapping = state.mappings.find((mp) => mp.vendorKey === "kie" && mp.taskKind === "text_to_video");
    expect(mapping?.enabled).toBe(true);
    expect(mapping?.create.path).toBe("/api/v1/jobs/createTask");
  });

  it("幂等：再次应用不重复添加、changed=false", () => {
    const first = applyBuiltinSeeds(emptyCatalog(), NOW);
    const second = applyBuiltinSeeds(first.state, NOW);
    expect(second.changed).toBe(false);
    expect(second.state.vendors.filter((v) => v.key === "kie")).toHaveLength(1);
    expect(second.state.models.filter((m) => m.modelKey === "bytedance/seedance-2")).toHaveLength(1);
    expect(second.state.models.filter((m) => m.modelKey === "happyhorse")).toHaveLength(1);
    expect(second.state.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video")).toHaveLength(1);
    expect(second.state.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "text_to_video")).toHaveLength(1);
  });

  it("存在即跳过：不覆盖用户已有的同 key 记录", () => {
    const state = emptyCatalog();
    state.vendors.push({
      key: "kie",
      name: "我自己接的 kie",
      enabled: true,
      baseUrlHint: "https://my-relay.example.com",
      authType: "bearer",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { state: next } = applyBuiltinSeeds(state, NOW);
    const vendor = next.vendors.find((v) => v.key === "kie");
    // 用户的 baseUrl 不被种子覆盖
    expect(vendor?.baseUrlHint).toBe("https://my-relay.example.com");
    expect(vendor?.name).toBe("我自己接的 kie");
  });
});
