import { describe, it, expect } from "vitest";
import { ARCHETYPE_WIRE_DEFAULTS, ARCHETYPE_SIZE_RATIO_SEMANTIC } from "./archetypeWireDefaults.generated";

// 锁住档案默认桥接的关键不变量（生成数据由 check:archetype-defaults 门保证与档案同步）。
describe("ARCHETYPE_WIRE_DEFAULTS（headless 缺参兜底桥接）", () => {
  it("视频档案 duration 保 number（避 vendor「string≠int」）；model 不归默认表", () => {
    // 原先拿 Sora 2 当样本；Sora 2 于 2026-09-28 退役、档案已删，换同形状的 APIMart Hailuo 2.3（变体 + 数值时长）。
    const hailuo = ARCHETYPE_WIRE_DEFAULTS["hailuo-2.3"].text_to_video["*"];
    // 发哪个 model 串只问 wireModelIdentity（2026-10-16）：默认表里任何一格都不许带 model。
    expect(hailuo).not.toHaveProperty("model");
    expect(typeof hailuo.duration).toBe("number");
    expect(ARCHETYPE_WIRE_DEFAULTS["sora-2"]).toBeUndefined();
    const withModel = Object.entries(ARCHETYPE_WIRE_DEFAULTS).flatMap(([archetypeId, byKind]) => Object.entries(byKind)
      .flatMap(([taskKind, byVendor]) => Object.entries(byVendor).filter(([, defaults]) => "model" in defaults).map(([vendor]) => `${archetypeId}/${taskKind}/${vendor}`)));
    expect(withModel).toEqual([]);
    expect(ARCHETYPE_WIRE_DEFAULTS["grok-imagine-1.5-video"].text_to_video["*"]).toMatchObject({
      size: "16:9",
      quality: "480p",
      duration: 6,
    });
    expect(ARCHETYPE_WIRE_DEFAULTS["grok-imagine-1.5-video"].text_to_video["*"].model).toBeUndefined();
  });

  it("vendorParams 分桶：apimart Kling duration=number，通用桶(kie)=string——不串台", () => {
    const kling = ARCHETYPE_WIRE_DEFAULTS["kling-3.0"].text_to_video;
    expect(typeof kling.apimart.duration).toBe("number");
    expect(typeof kling["*"].duration).toBe("string");
  });

  it("图/音档案默认覆盖（替代已删的手写 defaultParams，单一真相源=档案）", () => {
    expect(ARCHETYPE_WIRE_DEFAULTS["volcengine-seedream"].text_to_image["*"].size).toBe("2048x2048");
    expect(ARCHETYPE_WIRE_DEFAULTS["volcengine-doubao-tts"].text_to_audio["*"].voice).toBeTruthy();
  });
});

// size 键比例语义标记（从档案 size 控件选项集 derive，供 headless size 别名闸判「调用方比例能否落到 size」）。
describe("ARCHETYPE_SIZE_RATIO_SEMANTIC（size 键比例语义桥接）", () => {
  it("比例族默认（adaptive）但选项集含真比例档 → 记为比例语义（seedance-2.5-apimart 修复点）", () => {
    // size 默认 "adaptive"（不匹配 /^\d+:\d+$/），旧「按默认值字面猜」会误判像素语义、吞掉调用方比例。
    expect(ARCHETYPE_SIZE_RATIO_SEMANTIC["seedance-2.5-apimart"].text_to_video).toBe(true);
    expect(ARCHETYPE_SIZE_RATIO_SEMANTIC["seedance-2.5-apimart"].image_to_video).toBe(true);
  });

  it("默认值本就是比例形的档案照样登记（apimart seedream）", () => {
    expect(ARCHETYPE_SIZE_RATIO_SEMANTIC["seedream"].text_to_image).toBe(true);
  });

  it("像素语义档案不登记（volcengine-seedream / modelscope-image 的 size 选项全是像素）→ 闸会剥掉调用方比例", () => {
    expect(ARCHETYPE_SIZE_RATIO_SEMANTIC["volcengine-seedream"]).toBeUndefined();
    expect(ARCHETYPE_SIZE_RATIO_SEMANTIC["modelscope-image"]).toBeUndefined();
  });
});
