import { describe, it, expect } from "vitest";
import { ARCHETYPE_WIRE_DEFAULTS } from "./archetypeWireDefaults.generated";

// 锁住档案默认桥接的关键不变量（生成数据由 check:archetype-defaults 门保证与档案同步）。
describe("ARCHETYPE_WIRE_DEFAULTS（headless 缺参兜底桥接）", () => {
  it("视频档案补 model 变体 + duration 保 number（避 vendor「string≠int」）", () => {
    const sora = ARCHETYPE_WIRE_DEFAULTS["sora-2"].text_to_video["*"];
    expect(sora.model).toBe("sora-2");
    expect(typeof sora.duration).toBe("number");
    expect(ARCHETYPE_WIRE_DEFAULTS["volcengine-seedance-2"].text_to_video["*"].model).toBe("doubao-seedance-2-0-260128");
    expect(ARCHETYPE_WIRE_DEFAULTS["seedance-2-apimart"].text_to_video["*"].model).toBe("doubao-seedance-2.0-fast");
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
    expect(ARCHETYPE_WIRE_DEFAULTS["nomi-audio"].text_to_audio["*"].model).toBeTruthy();
    expect(ARCHETYPE_WIRE_DEFAULTS["volcengine-doubao-tts"].text_to_audio["*"].voice).toBeTruthy();
  });
});
