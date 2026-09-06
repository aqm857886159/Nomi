import { describe, it, expect } from "vitest";
import type { CatalogState } from "./types";
import { selectTaskMapping } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";

function emptyCatalog(): CatalogState {
  return { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}

const NOW = "2026-06-05T00:00:00.000Z";

describe("applyBuiltinSeeds", () => {
  it("adds an opt-in local CLI text connection without granting Agent tools or replacing user state", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const vendor = state.vendors.find((v) => v.key === "antigravity-cli");
    expect(vendor).toMatchObject({ authType: "none", enabled: false });
    expect(state.models.filter((m) => m.vendorKey === "antigravity-cli")).toEqual([]);
    vendor!.enabled = true;
    expect(applyBuiltinSeeds(state, NOW).state.vendors.find((v) => v.key === "antigravity-cli")?.enabled).toBe(true);
  });
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

    // Seedance 标准/Fast 合并成 1 行 + 2 变体（2026-06-16）：catalog 只剩基础行，无独立 fast 行。
    expect(state.models.find((m) => m.modelKey === "bytedance/seedance-2-fast")).toBeUndefined();
    const seedance = state.models.find((m) => m.modelKey === "bytedance/seedance-2");
    expect(seedance?.meta).toMatchObject({ archetypeId: "seedance-2" });
    // 仍只一条 generic（Seedance）image_to_video mapping；Kling 等带 modelKey 的不算在内。
    expect(state.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video" && !mp.modelKey)).toHaveLength(1);
    const mapping = state.mappings.find((mp) => mp.id === "seed-kie-happyhorse-text_to_video");
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
    // 幂等的真义 = 再次应用不增长（不是固定条数——桶里多模型共存是常态）。
    const count = (s: typeof second.state, tk: string) => s.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === tk).length;
    expect(count(second.state, "image_to_video")).toBe(count(first.state, "image_to_video"));
    expect(count(second.state, "text_to_video")).toBe(count(first.state, "text_to_video"));
  });

  it("播种 MiniMax、ElevenLabs 与 Meshy 的官方旗舰模型和精确 mapping", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    expect(state.vendors.find((vendor) => vendor.key === "minimax")).toMatchObject({ authType: "bearer" });
    expect(state.vendors.find((vendor) => vendor.key === "elevenlabs")).toMatchObject({ authHeader: "xi-api-key" });
    expect(state.vendors.find((vendor) => vendor.key === "meshy")).toMatchObject({ authType: "bearer" });

    expect(state.models.find((model) => model.vendorKey === "minimax" && model.modelKey === "MiniMax-H3"))
      .toMatchObject({ kind: "video", meta: { archetypeId: "minimax-h3", catalogLifecycle: "flagship" } });
    expect(state.models.find((model) => model.vendorKey === "minimax" && model.modelKey === "speech-2.8-turbo"))
      .toMatchObject({ kind: "audio", meta: { catalogLifecycle: "value" } });
    expect(state.models.find((model) => model.vendorKey === "elevenlabs" && model.modelKey === "music_v2"))
      .toMatchObject({ kind: "audio", meta: { archetypeId: "eleven-music-v2", catalogLifecycle: "flagship" } });
    expect(state.models.find((model) => model.vendorKey === "minimax" && model.modelKey === "MiniMax-M3"))
      .toMatchObject({ kind: "text", meta: { supportsImageInput: true, catalogLifecycle: "flagship" } });
    expect(state.mappings.some((mapping) => mapping.vendorKey === "minimax" && mapping.modelKey === "MiniMax-M3"))
      .toBe(false);
    expect(state.models.find((model) => model.vendorKey === "meshy" && model.modelKey === "meshy-7"))
      .toMatchObject({ kind: "model3d", meta: { archetypeId: "meshy-7", catalogLifecycle: "flagship" } });

    expect(selectTaskMapping(state.mappings, "elevenlabs", "text_to_audio", "music_v2")?.create)
      .toMatchObject({ path: "/v1/music", paramMap: { rules: [{ wire: "music_length_ms" }] } });
    expect(selectTaskMapping(state.mappings, "meshy", "image_to_3d", "meshy-7")?.query?.response_mapping)
      .toMatchObject({ model_url: "model_urls.glb" });
  });

  it("只迁移 MiniMax 的旧官方 host，不覆盖用户自定义中转地址", () => {
    const stale = emptyCatalog();
    stale.vendors.push({
      key: "minimax", name: "MiniMax", enabled: true,
      baseUrlHint: "https://api.minimax.io", authType: "bearer", authHeader: "Authorization",
      createdAt: "old", updatedAt: "old",
    });
    const migrated = applyBuiltinSeeds(stale, "2026-08-31T00:00:00.000Z");
    expect(migrated.changed).toBe(true);
    expect(migrated.state.vendors.find((vendor) => vendor.key === "minimax")).toMatchObject({
      baseUrlHint: "https://api.minimaxi.com", updatedAt: "2026-08-31T00:00:00.000Z",
    });

    const custom = emptyCatalog();
    custom.vendors.push({
      key: "minimax", name: "我的中转", enabled: false,
      baseUrlHint: "https://minimax.example.invalid/v1", authType: "bearer", authHeader: "Authorization",
      createdAt: "old", updatedAt: "old",
    });
    const preserved = applyBuiltinSeeds(custom, "2026-08-31T00:00:00.000Z");
    expect(preserved.state.vendors.find((vendor) => vendor.key === "minimax")).toMatchObject({
      name: "我的中转", enabled: false, baseUrlHint: "https://minimax.example.invalid/v1", updatedAt: "old",
    });
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

  it("re-sync（model）：curated 模型的 archetypeId 漂移 → 对账修回，保留 enabled/labelZh（同根因，model 也堵）", () => {
    const fresh = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const idx = fresh.models.findIndex((m) => m.modelKey === "bytedance/seedance-2");
    fresh.models[idx] = { ...fresh.models[idx], labelZh: "我改名的 Seedance", enabled: false, meta: { archetypeId: "old-stale-id" } };
    const { state, changed } = applyBuiltinSeeds(fresh, "2026-06-06T00:00:00.000Z");
    expect(changed).toBe(true);
    const m = state.models.find((mm) => mm.modelKey === "bytedance/seedance-2");
    expect((m?.meta as { archetypeId?: string })?.archetypeId).toBe("seedance-2"); // 能力指针修回
    expect(m?.labelZh).toBe("我改名的 Seedance"); // 用户改名保留
    expect(m?.enabled).toBe(false); // 用户开关保留
  });

  it("给每条内置模型写入显式生命周期，并在老装机上对账自愈", () => {
    const fresh = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    expect(fresh.models.length).toBeGreaterThan(0);
    expect(fresh.models.every((model) =>
      ["flagship", "value", "companion", "legacy"].includes(
        String((model.meta as { catalogLifecycle?: string } | undefined)?.catalogLifecycle),
      ),
    )).toBe(true);

    expect((fresh.models.find((model) => model.modelKey === "seedream/5-pro-text-to-image")?.meta as Record<string, unknown>))
      .toMatchObject({ catalogLifecycle: "flagship" });
    expect((fresh.models.find((model) => model.modelKey === "nano-banana-2-lite")?.meta as Record<string, unknown>))
      .toMatchObject({ catalogLifecycle: "value" });
    expect((fresh.models.find((model) => model.modelKey === "seedream")?.meta as Record<string, unknown>))
      .toMatchObject({ catalogLifecycle: "legacy" });

    const staleIndex = fresh.models.findIndex((model) => model.modelKey === "seedream");
    fresh.models[staleIndex] = { ...fresh.models[staleIndex], meta: { archetypeId: "seedream" } };
    const reconciled = applyBuiltinSeeds(fresh, "2026-08-30T00:00:00.000Z");
    expect(reconciled.changed).toBe(true);
    expect((reconciled.state.models[staleIndex].meta as Record<string, unknown>))
      .toMatchObject({ archetypeId: "seedream", catalogLifecycle: "legacy" });
  });

  it("re-sync（model）：meta 里用户自加的其它键不被对账抹掉（只覆盖 archetypeId）", () => {
    const fresh = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const idx = fresh.models.findIndex((m) => m.modelKey === "bytedance/seedance-2");
    fresh.models[idx] = { ...fresh.models[idx], meta: { archetypeId: "stale", note: "用户备注" } };
    const { state } = applyBuiltinSeeds(fresh, "2026-06-06T00:00:00.000Z");
    const m = state.models.find((mm) => mm.modelKey === "bytedance/seedance-2");
    expect((m?.meta as { archetypeId?: string; note?: string })).toMatchObject({ archetypeId: "seedance-2", note: "用户备注" });
  });

  it("re-sync：不碰用户自建的 mapping（非 seed id）", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const userMapping = { id: "user-custom-1", vendorKey: "kie", taskKind: "image_to_video" as const, name: "我的自定义", enabled: true, create: { method: "POST", path: "/custom", headers: {}, body: { foo: "bar" } }, createdAt: NOW, updatedAt: NOW };
    state.mappings.push(userMapping);
    const { state: next } = applyBuiltinSeeds(state, "2026-06-06T00:00:00.000Z");
    const mine = next.mappings.find((mp) => mp.id === "user-custom-1");
    expect(mine?.create.body).toEqual({ foo: "bar" }); // 原样不动
  });

  it("路由根因：text_to_video 槽被 Kling(generic) 占着时，HappyHorse 仍被种入（靠 modelKey 共存，不再被抢）", () => {
    const state = emptyCatalog();
    // 模拟用户机器上残留的 Kling 试装 mapping，占着 (kie, text_to_video) 的 generic 槽。
    state.mappings.push({
      id: "kling-leftover", vendorKey: "kie", taskKind: "text_to_video", name: "Kling 3.0", enabled: true,
      create: { method: "POST", path: "/api/v1/jobs/createTask", headers: {}, body: { input: { mode: "kling" } } },
      createdAt: "old", updatedAt: "old",
    });
    const { state: next } = applyBuiltinSeeds(state, NOW);
    const t2v = next.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "text_to_video");
    // 共存：Kling-leftover(generic) + HappyHorse(modelKey=happyhorse) + 可灵3.0(modelKey=kling-3.0)
    expect(t2v.length).toBeGreaterThanOrEqual(2);
    const happy = next.mappings.find((mp) => mp.id === "seed-kie-happyhorse-text_to_video");
    expect(happy).toBeTruthy();
    expect(happy?.modelKey).toBe("happyhorse");
    expect(selectTaskMapping(next.mappings, "kie", "text_to_video", "happyhorse")?.id).toBe("seed-kie-happyhorse-text_to_video");
    expect(selectTaskMapping(next.mappings, "kie", "text_to_video", "some-other-model")?.id).toBe("kling-leftover");
  });

  it("路由：Seedream 与 GPT 同 image_edit 桶，靠 modelKey 各路由到自己的 mapping（不撞）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const editBucket = state.mappings.filter((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_edit");
    // GPT(generic) + Seedream(modelKey=seedream) 共存
    expect(editBucket.length).toBeGreaterThanOrEqual(2);
    expect(selectTaskMapping(state.mappings, "kie", "image_edit", "seedream")?.modelKey).toBe("seedream");
    // GPT 节点（非 seedream modelKey）落 generic GPT mapping，不被 Seedream 抢
    expect(selectTaskMapping(state.mappings, "kie", "image_edit", "gpt-image-2-image-to-image")?.id).toBe("seed-kie-gpt-image-2-image_edit");
    // Seedream 伞模型带档案
    const sd = state.models.find((m) => m.modelKey === "seedream");
    expect((sd?.meta as { archetypeId?: string })?.archetypeId).toBe("seedream");
    // 三个图像模型（GPT/Seedream/Nano Banana）同 image_edit 桶，各路由到自己
    expect(selectTaskMapping(state.mappings, "kie", "image_edit", "nano-banana")?.modelKey).toBe("nano-banana");
    expect(editBucket.length).toBeGreaterThanOrEqual(3);
  });

  it("变体合并迁移：fresh seed 只种 1 个 Seedance apimart 模型（基础 modelKey）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const seedance = state.models.filter((m) => m.vendorKey === "apimart" && m.modelKey.startsWith("doubao-seedance-2.0"));
    expect(seedance.map((m) => m.modelKey)).toEqual(["doubao-seedance-2.0"]);
    // body 的 model 取 {{request.params.model}}（变体通道），非 {{model.modelKey}}。
    const t2v = state.mappings.find((m) => m.id === "seed-apimart-seedance-2-apimart-text_to_video");
    expect((t2v?.create.body as { model: string }).model).toBe("{{request.params.model}}");
  });

  it("APIMart Grok Imagine 1.5：播一个 catalog 模型 + 文生/图生两条视频 mapping", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const model = state.models.find((m) => m.vendorKey === "apimart" && m.modelKey === "grok-imagine-1.5-video-apimart");
    expect(model).toMatchObject({ labelZh: "Grok Imagine 1.5", kind: "video", enabled: true });
    expect(model?.meta).toMatchObject({ archetypeId: "grok-imagine-1.5-video" });

    const t2v = state.mappings.find((m) => m.id === "seed-apimart-grok-imagine-1.5-video-text_to_video");
    const i2v = state.mappings.find((m) => m.id === "seed-apimart-grok-imagine-1.5-video-image_to_video");
    expect(t2v).toMatchObject({ modelKey: "grok-imagine-1.5-video-apimart", taskKind: "text_to_video" });
    expect(i2v).toMatchObject({ modelKey: "grok-imagine-1.5-video-apimart", taskKind: "image_to_video" });
    expect(t2v?.create.path).toBe("/v1/videos/generations");
    expect(t2v?.create.body).toMatchObject({
      model: "{{model.modelKey}}",
      size: "{{request.params.size}}",
      quality: "{{request.params.quality}}",
      duration: "{{request.params.duration}}",
    });
    expect(i2v?.create.body).toMatchObject({
      model: "{{model.modelKey}}",
      quality: "{{request.params.quality}}",
      duration: "{{request.params.duration}}",
      image_urls: "{{request.params.image_urls}}",
    });
    expect((i2v?.create.body as Record<string, unknown>).size).toBeUndefined();
  });

  it("变体合并迁移：老装机里残留的 3 个旧 Seedance 变体模型 + 6 mapping 被精确删除（picker 收成 1 项）", () => {
    // 模拟老装机：先 fresh seed 1 个基础模型，再手塞 3 个旧变体模型 + 它们的 6 条 mapping（旧 seed id）。
    const stale = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const retiredKeys = ["doubao-seedance-2.0-fast", "doubao-seedance-2.0-face", "doubao-seedance-2.0-fast-face"];
    for (const modelKey of retiredKeys) {
      stale.models.push({ modelKey, vendorKey: "apimart", labelZh: modelKey, kind: "video", enabled: true, meta: { archetypeId: "seedance-2-apimart" }, createdAt: "old", updatedAt: "old" });
    }
    const retiredMappingIds = [
      "seed-apimart-seedance-2-apimart-fast-text_to_video", "seed-apimart-seedance-2-apimart-fast-image_to_video",
      "seed-apimart-seedance-2-apimart-face-text_to_video", "seed-apimart-seedance-2-apimart-face-image_to_video",
      "seed-apimart-seedance-2-apimart-fast-face-text_to_video", "seed-apimart-seedance-2-apimart-fast-face-image_to_video",
    ];
    for (const id of retiredMappingIds) {
      stale.mappings.push({ id, vendorKey: "apimart", taskKind: "text_to_video", name: id, enabled: true, create: { method: "POST", path: "/v1/videos/generations", headers: {}, body: {} }, createdAt: "old", updatedAt: "old" });
    }
    const { state, changed } = applyBuiltinSeeds(stale, "2026-06-16T00:00:00.000Z");
    expect(changed).toBe(true);
    // 3 旧变体模型全删，只剩基础。
    const seedanceModels = state.models.filter((m) => m.vendorKey === "apimart" && m.modelKey.startsWith("doubao-seedance-2.0"));
    expect(seedanceModels.map((m) => m.modelKey)).toEqual(["doubao-seedance-2.0"]);
    // 6 旧 mapping 全删。
    for (const id of retiredMappingIds) {
      expect(state.mappings.find((m) => m.id === id)).toBeUndefined();
    }
    // 不误删基础模型的 mapping。
    expect(state.mappings.find((m) => m.id === "seed-apimart-seedance-2-apimart-image_to_video")).toBeTruthy();
  });

  it("变体合并迁移：prune 不碰用户自建/改名的非 seed 记录", () => {
    const stale = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    // 用户自建一个 modelKey 含 fast 但不是我们种的退役 key（不同 modelKey）→ 不删。
    stale.models.push({ modelKey: "my-custom-seedance-fast", vendorKey: "apimart", labelZh: "我的", kind: "video", enabled: true, createdAt: "old", updatedAt: "old" });
    const { state } = applyBuiltinSeeds(stale, "2026-06-16T00:00:00.000Z");
    expect(state.models.find((m) => m.modelKey === "my-custom-seedance-fast")).toBeTruthy();
  });

  it("文本大脑：fresh seed 给 apimart 播一组 enabled 的 kind=text 模型（创作助手主控，Issue #9）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const brainKeys = [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v3.2",
      "deepseek-v3.1-terminus",
    ];
    for (const modelKey of brainKeys) {
      const brain = state.models.find((m) => m.vendorKey === "apimart" && m.modelKey === modelKey);
      expect(brain).toMatchObject({ kind: "text", enabled: true });
      // 文本模型不挂 archetype（走 buildLanguageModelForVendor 直连 chat，不需 mapping）。
      expect((brain?.meta as { archetypeId?: string } | undefined)?.archetypeId).toBeUndefined();
      // 也不该为文本大脑造任何 mapping（避免 unused dead data）。
      expect(state.mappings.find((mp) => mp.vendorKey === "apimart" && mp.modelKey === modelKey)).toBeUndefined();
    }
  });

  it("文本大脑：老装机（apimart 已接但无文本模型）→ reconcile 漂移自愈补上大脑", () => {
    // 模拟 Issue #9 上报者：apimart 已接、有生成模型，但没有任何 text 模型。
    const stale = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    stale.models = stale.models.filter((m) => !(m.vendorKey === "apimart" && m.kind === "text"));
    expect(stale.models.find((m) => m.vendorKey === "apimart" && m.kind === "text")).toBeUndefined();
    const { state, changed } = applyBuiltinSeeds(stale, "2026-06-19T00:00:00.000Z");
    expect(changed).toBe(true);
    expect(state.models.find((m) => m.vendorKey === "apimart" && m.modelKey === "deepseek-v4-pro")).toMatchObject({ kind: "text", enabled: true });
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

  it("魔搭免费 LLM：fresh seed 播 Qwen3 系 text 模型(enabled,无 archetype/mapping)——免费文本大脑(真实验证)", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const texts = state.models.filter((m) => m.vendorKey === "modelscope" && m.kind === "text");
    expect(texts.map((m) => m.modelKey)).toEqual(expect.arrayContaining([
      "Qwen/Qwen3-Next-80B-A3B-Instruct", "Qwen/Qwen3-30B-A3B", "Qwen/Qwen3-8B",
    ]));
    for (const m of texts) {
      expect(m.enabled).toBe(true);
      expect((m.meta as { archetypeId?: string } | undefined)?.archetypeId).toBeUndefined();
    }
    // 文本大脑不建 mapping（直连 chat）。
    expect(state.mappings.some((mp) => mp.vendorKey === "modelscope" && mp.taskKind === "chat")).toBe(false);
  });

  it("火山方舟：fresh seed 同时播 Seedream 图片与 Seedance 视频，Seedance 带异步 query", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const seedance = state.models.find((m) => m.vendorKey === "volcengine" && m.modelKey === "doubao-seedance-2-0-260128");
    expect(seedance).toMatchObject({ kind: "video", enabled: true });
    expect(seedance?.meta).toMatchObject({ archetypeId: "volcengine-seedance-2" });

    const mappings = state.mappings.filter((m) => m.vendorKey === "volcengine" && m.modelKey === "doubao-seedance-2-0-260128");
    expect(mappings.map((m) => m.id)).toEqual(["seed-volcengine-seedance-2-text_to_video", "seed-volcengine-seedance-2-image_to_video"]);
    expect(mappings.every((m) => m.query?.path === "/api/v3/contents/generations/tasks/{{providerMeta.task_id}}")).toBe(true);
    expect(mappings.every((m) => m.statusMapping?.succeeded?.includes("succeeded"))).toBe(true);
  });
});

describe("canonicalModelId（跨供应商去重键，2026-07-17）", () => {
  const canonicalOf = (s: CatalogState, vendorKey: string, modelKey: string): unknown =>
    (s.models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey)?.meta as Record<string, unknown> | undefined)
      ?.canonicalModelId;

  it("跨家同一逻辑模型 seed 后带同一个版本级 canonicalModelId", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    // Seedream 4.5：kie / apimart / 火山 / RunningHub 四家同键。
    expect(canonicalOf(state, "kie", "seedream")).toBe("seedream 4.5");
    expect(canonicalOf(state, "apimart", "doubao-seedream-4.5")).toBe("seedream 4.5");
    expect(canonicalOf(state, "volcengine", "doubao-seedream-4-5-251128")).toBe("seedream 4.5");
    expect(canonicalOf(state, "runninghub", "seedream-v4.5")).toBe("seedream 4.5");
    // Seedance 2.0 四家同键。
    expect(canonicalOf(state, "kie", "bytedance/seedance-2")).toBe("seedance 2.0");
    expect(canonicalOf(state, "apimart", "doubao-seedance-2.0")).toBe("seedance 2.0");
    expect(canonicalOf(state, "volcengine", "doubao-seedance-2-0-260128")).toBe("seedance 2.0");
    expect(canonicalOf(state, "runninghub", "bytedance/seedance-2.0-global")).toBe("seedance 2.0");
    // kie 把 GPT Image 2 拆两行 → 同一 canonical（在 picker 合并成一条）。
    expect(canonicalOf(state, "kie", "gpt-image-2-text-to-image")).toBe("gpt image 2");
    expect(canonicalOf(state, "kie", "gpt-image-2-image-to-image")).toBe("gpt image 2");
    expect(canonicalOf(state, "apimart", "gpt-image-2")).toBe("gpt image 2");
  });

  it("值 = normalizeModelLabel(labelZh) 产物：不进表的同名模型走 label 回退得到同键（不拆现有合并组）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    const seedream = state.models.find((m) => m.vendorKey === "kie" && m.modelKey === "seedream");
    const norm = String(seedream?.labelZh || "").trim().toLowerCase().replace(/\s+/g, " ");
    expect((seedream?.meta as Record<string, unknown>)?.canonicalModelId).toBe(norm);
  });

  it("版本级不合并：Seedream 5.0/4.0（火山单家版本）不带 4.5 的 canonical", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    expect(canonicalOf(state, "volcengine", "doubao-seedream-5-0-260128")).toBeUndefined();
    expect(canonicalOf(state, "volcengine", "doubao-seedream-4-0-250828")).toBeUndefined();
  });

  it("老装机自愈：已有条目缺 canonicalModelId → 再次 seed 补上（drift 对账），不动用户所有字段", () => {
    const first = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const idx = first.models.findIndex((m) => m.vendorKey === "kie" && m.modelKey === "seedream");
    const meta = { ...(first.models[idx].meta as Record<string, unknown>) };
    delete meta.canonicalModelId;
    first.models[idx] = { ...first.models[idx], meta, labelZh: "我改过的名字", enabled: false };
    const { state, changed } = applyBuiltinSeeds(first, "2026-07-17T00:00:00.000Z");
    expect(changed).toBe(true);
    expect(canonicalOf(state, "kie", "seedream")).toBe("seedream 4.5");
    const healed = state.models.find((m) => m.vendorKey === "kie" && m.modelKey === "seedream");
    // 用户所有字段保留（labelZh/enabled 不被 clobber）。
    expect(healed?.labelZh).toBe("我改过的名字");
    expect(healed?.enabled).toBe(false);
  });
});

describe("Imagen 4 退役（2026-07-30：上游 Google 确定性 404，用户拍板下掉）", () => {
  it("空目录：不再种出 Imagen 4（新装机不会开箱就撞必死模型）", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    expect(state.models.find((m) => m.modelKey === "imagen-4.0-apimart")).toBeUndefined();
    expect(state.mappings.find((mp) => mp.id === "seed-apimart-imagen-4-text_to_image")).toBeUndefined();
    // 同家其它图片模型不受连带（只摘这一个）。
    expect(state.models.find((m) => m.modelKey === "z-image-turbo")).toBeTruthy();
  });

  it("老装机：已落在用户 catalog 里的那条被摘掉（改种子没用——enabled 属用户数据，只有 prune 摘得掉）", () => {
    const seeded = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    // 模拟老版本装机：手动把退役前的记录塞回去。
    seeded.models.push({
      vendorKey: "apimart", modelKey: "imagen-4.0-apimart", kind: "image", enabled: true,
      meta: { archetypeId: "imagen-4" }, createdAt: NOW, updatedAt: NOW,
    } as CatalogState["models"][number]);
    seeded.mappings.push({
      id: "seed-apimart-imagen-4-text_to_image", vendorKey: "apimart", taskKind: "text_to_image",
      modelKey: "imagen-4.0-apimart", name: "Imagen 4 · 文生图", enabled: true,
      create: { method: "POST", path: "/v1/images/generations" }, createdAt: NOW, updatedAt: NOW,
    } as CatalogState["mappings"][number]);

    const { state, changed } = applyBuiltinSeeds(seeded, NOW);
    expect(changed).toBe(true);
    expect(state.models.find((m) => m.modelKey === "imagen-4.0-apimart")).toBeUndefined();
    expect(state.mappings.find((mp) => mp.id === "seed-apimart-imagen-4-text_to_image")).toBeUndefined();
  });

  it("退役是稳定的：再跑一遍不会被 curated 插回来（curated 与退役清单互斥，否则来回抖）", () => {
    let state = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    for (let i = 0; i < 3; i += 1) state = applyBuiltinSeeds(state, NOW).state;
    expect(state.models.filter((m) => m.modelKey === "imagen-4.0-apimart")).toHaveLength(0);
  });
});


describe("Agnes complete catalog upgrade", () => {
  it("adds ten public models, keeps user state, and preserves image attachments through explicit metadata", async () => {
    const { modelSupportsImageInput, buildAgentUserContent } = await import("../ai/agentUserContent");
    const stale = applyBuiltinSeeds(emptyCatalog(), NOW).state;
    const old = stale.models.find((m) => m.vendorKey === "agnes" && m.modelKey === "agnes-2.0-flash")!;
    old.enabled = false; old.labelZh = "My Agnes"; old.meta = { note: "keep" };
    const mapping = stale.mappings.find((m) => m.id === "seed-agnes-video-v2-image_to_video")!;
    mapping.enabled = false; mapping.name = "My video";
    stale.apiKeysByVendor.agnes = { vendorKey: "agnes", apiKey: "synthetic-encrypted-fixture", enc: "safeStorage", enabled: false, createdAt: NOW, updatedAt: NOW };
    const savedKeys = structuredClone(stale.apiKeysByVendor);
    const { state } = applyBuiltinSeeds(stale, "2026-08-26T00:00:00.000Z");
    expect(state.models.filter((m) => m.vendorKey === "agnes")).toHaveLength(10);
    expect(state.models.find((m) => m === old) ?? state.models.find((m) => m.modelKey === old.modelKey)).toMatchObject({ enabled: false, labelZh: "My Agnes", meta: { note: "keep", supportsImageInput: true } });
    expect(state.mappings.find((m) => m.id === mapping.id)).toMatchObject({ enabled: false, name: "My video" });
    expect(state.apiKeysByVendor).toEqual(savedKeys);
    for (const model of state.models.filter((m) => m.vendorKey === "agnes" && m.kind === "text")) {
      const supportsImageInput = modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta);
      const content = await buildAgentUserContent({ prompt: "Describe it", supportsImageInput, supportsPdfInput: false, attachments: [{ url: "nomi-local://test.png", fileName: "test.png", contentType: "image/png", kind: "image" }], resolveBytes: () => new Uint8Array([1]), extractText: async () => null });
      expect(content).toContainEqual({ type: "image", image: new Uint8Array([1]), mimeType: "image/png" });
    }
    expect(applyBuiltinSeeds(state, "2026-08-27T00:00:00.000Z").changed).toBe(false);
    for (const modelKey of ["agnes-video-2.5", "agnes-video-2.5-flash"]) {
      const query = state.mappings.find((m) => m.vendorKey === "agnes" && m.modelKey === modelKey)?.query;
      expect(query?.query).toEqual({ video_id: "{{providerMeta.video_id}}", model_name: "{{model.modelKey}}" });
    }
  });
});
