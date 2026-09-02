import { describe, it, expect } from "vitest";
import { RUNWAY_OFFICIAL_MODELS } from "./runwayOfficial";
import { modeSlotReach } from "./referenceReachability";
import { MODEL_ARCHETYPES, specializeArchetypeForVendor } from "../../src/config/modelArchetypes";
import {
  RUNWAY_IMAGE_RATIO_ENUMS,
  RUNWAY_IMAGE_REFERENCE_MAX,
  type RunwayImageModelKey,
} from "../shared/imageCapabilities/runwayImageWireFacts";

/**
 * 类级回归锁（2026-09-02 拆 `runway-image` 平台档案）。
 *
 * 被删掉的缺陷形状：一个**平台档案**罩 9 个不同图像产品，声明一套共享比例喂给全部模型；
 * 照官方 OpenAPI 逐模型对账，10 个变体里 10 个都至少收到一个非法值，传输层只好偷偷改写
 * ——能力面与 wire 两个作者、必然漂移。下面三条不变量让这个形状回不来。
 */
describe("Runway 图像：一个模型一个档案主人，能力面与 wire 同源", () => {
  const imageRows = RUNWAY_OFFICIAL_MODELS.filter((m) => m.kind === "image");

  it("每一行都挂在**模型专属**档案上（没有跨产品共享的平台档案）", () => {
    expect(imageRows.length).toBe(10);
    const owners = new Map<string, string[]>();
    for (const row of imageRows) {
      owners.set(row.archetypeId!, [...(owners.get(row.archetypeId!) ?? []), row.modelKey]);
    }
    const shared = [...owners.entries()].filter(([, models]) => models.length > 1);
    expect(shared, `平台档案复活：${shared.map(([id, m]) => `${id}←${m.join("/")}`).join("; ")}`).toEqual([]);
    // 已删的两个平台档案不得以任何形式回来。
    expect(MODEL_ARCHETYPES.map((a) => a.id)).not.toContain("runway-image");
    expect(MODEL_ARCHETYPES.map((a) => a.id)).not.toContain("runway-image-reference");
  });

  it("UI 在 Runway 上给得出的比例 ⊆ 该模型官方 enum（传输层无需改写任何 UI 值）", () => {
    for (const row of imageRows) {
      const wire = RUNWAY_IMAGE_RATIO_ENUMS[row.modelKey as RunwayImageModelKey];
      expect(wire, `${row.modelKey} 缺 wire enum`).toBeTruthy();
      const archetype = specializeArchetypeForVendor(
        MODEL_ARCHETYPES.find((a) => a.id === row.archetypeId)!,
        "runway",
      );
      for (const mode of archetype.modes) {
        const ratio = mode.params.find((p) => p.key === "aspect_ratio" || p.key === "size");
        if (!ratio) continue;
        const illegal = ratio.options.map((o) => String(o.value)).filter((v) => !wire.includes(v));
        expect(illegal, `${row.modelKey}/${mode.id} 提供了 wire 拒收的值：${illegal.join(", ")}`).toEqual([]);
        expect(wire).toContain(String(ratio.defaultValue));
      }
    }
  });

  it("参考槽在这条 mapping 上真正可达，且上限等于官方 referenceImages.maxItems", () => {
    for (const row of imageRows) {
      const archetype = MODEL_ARCHETYPES.find((a) => a.id === row.archetypeId)!;
      for (const mode of archetype.modes) {
        if (!mode.slots.length) continue;
        const mapping = row.mappings.find((m) => m.modeId === mode.id);
        if (!mapping) continue; // 该模式在 Runway 上没有线缆 = 这里不发布它
        // 键对不上 = 参考图静默发不出去（UI 显示连上了、请求里一张都没有）。
        const reach = modeSlotReach(mode.slots, (mapping.create as { body?: unknown }).body);
        expect(reach, `${row.modelKey}/${mode.id} 参考槽不可达`).not.toContain("none");
        // 每个模型都必须在 wire 表里登记自己的 referenceImages 上限——归一器按它逐模型拦
        // （旧实现一刀切 3 张，会把 gpt_image_2 官方收得下的第 4~16 张直接拒掉）。
        const officialMax = RUNWAY_IMAGE_REFERENCE_MAX[row.modelKey as RunwayImageModelKey];
        expect(officialMax, `${row.modelKey} 未登记官方参考上限`).toBeGreaterThan(0);
      }
    }
  });
});
