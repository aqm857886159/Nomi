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

  it("re-sync：旧装机里早先种的 Seedance mapping 缺 omni 字段 → 刷新到当前代码（含 reference_image_urls + generate_audio）", () => {
    // 模拟：老版本种下的 (kie, image_to_video) mapping，body 只有首帧字段（无 omni 参考数组）。
    const stale = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const idx = stale.mappings.findIndex((mp) => mp.id === "seed-kie-seedance2-image_to_video");
    stale.mappings[idx] = {
      ...stale.mappings[idx],
      name: "我重命名过的首帧",
      create: { method: "POST", path: "/api/v1/jobs/createTask", headers: {}, body: { model: "{{model.modelKey}}", input: { prompt: "{{request.prompt}}", first_frame_url: "{{request.params.first_frame_url}}", resolution: "{{request.params.resolution}}" } } },
    };
    const { state, changed } = applyBuiltinSeeds(stale, "2026-06-06T00:00:00.000Z");
    expect(changed).toBe(true);
    const m = state.mappings.find((mp) => mp.id === "seed-kie-seedance2-image_to_video");
    const inputKeys = Object.keys((m?.create.body as { input: Record<string, unknown> }).input);
    expect(inputKeys).toContain("reference_image_urls");
    expect(inputKeys).toContain("generate_audio");
    // 保留用户的 enabled/name（只刷传输塑形，不clobber 用户偏好）
    expect(m?.name).toBe("我重命名过的首帧");
    expect(m?.enabled).toBe(true);
  });

  it("re-sync 是通用的：GPT i2i mapping 漂移也自愈（不止 Seedance）", () => {
    const fresh = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const idx = fresh.mappings.findIndex((mp) => mp.id === "seed-kie-gpt-image-2-image_edit");
    expect(idx).toBeGreaterThanOrEqual(0);
    fresh.mappings[idx] = { ...fresh.mappings[idx], create: { method: "POST", path: "/old", headers: {}, body: { input: { duration: "x" } } } };
    const { state, changed } = applyBuiltinSeeds(fresh, "2026-06-06T00:00:00.000Z");
    expect(changed).toBe(true);
    const m = state.mappings.find((mp) => mp.id === "seed-kie-gpt-image-2-image_edit");
    expect((m?.create.body as { input: Record<string, unknown> }).input).toHaveProperty("input_urls"); // 正确的图生图契约
  });

  it("结构保证：fresh seed 产出的每条 curated mapping（seed- 前缀）都受对账保护（漂移即自愈）", () => {
    const fresh = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const curatedIds = fresh.mappings.filter((mp) => mp.id.startsWith("seed-")).map((mp) => mp.id);
    expect(curatedIds.length).toBeGreaterThanOrEqual(3);
    for (const id of curatedIds) {
      const i = fresh.mappings.findIndex((mp) => mp.id === id);
      const drifted = { ...fresh, mappings: fresh.mappings.map((mp, j) => (j === i ? { ...mp, create: { method: "POST", path: "/drift", headers: {}, body: {} } } : mp)) };
      const { state } = applyBuiltinSeeds(drifted, "2026-06-06T00:00:00.000Z");
      const healed = state.mappings.find((mp) => mp.id === id);
      expect(healed?.create.path, `curated mapping ${id} 未被对账保护（新增 curated 必须进 CURATED_MAPPINGS 表）`).not.toBe("/drift");
    }
  });

  it("re-sync：不碰用户自建的 mapping（非 seed id）", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const userMapping = { id: "user-custom-1", vendorKey: "kie", taskKind: "image_to_video" as const, name: "我的自定义", enabled: true, create: { method: "POST", path: "/custom", headers: {}, body: { foo: "bar" } }, createdAt: NOW, updatedAt: NOW };
    state.mappings.push(userMapping);
    const { state: next } = applyBuiltinSeeds(state, "2026-06-06T00:00:00.000Z");
    const mine = next.mappings.find((mp) => mp.id === "user-custom-1");
    expect(mine?.create.body).toEqual({ foo: "bar" }); // 原样不动
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
