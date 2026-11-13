// APIMart 文档对齐第一批：档案的档位 / 方式 / 输入槽逐条对着供应商文档原文（2026-11-12 取）。
// 每条测试名里引的是文档原句；把对应档位从档案里拿掉就红。
import { describe, expect, it } from "vitest";
import { getArchetypeById, specializeArchetypeForVendor } from "./index";

function apimart(id: string) {
  const base = getArchetypeById(id);
  expect(base, id).toBeTruthy();
  return specializeArchetypeForVendor(base!, "apimart");
}
const param = (archetypeId: string, modeId: string, key: string) =>
  apimart(archetypeId).modes.find((mode) => mode.id === modeId)?.params.find((control) => control.key === key);
const values = (control: { options?: ReadonlyArray<{ value: unknown }> } | undefined) => (control?.options ?? []).map((option) => option.value);

describe("Seedream 5.0 Pro（APIMart）", () => {
  it("「use 1K / 1.5K / 2K … 3K / 4K are unsupported」：清晰度只有这三档", () => {
    for (const mode of ["t2i", "edit"]) expect(values(param("seedream-5-pro", mode, "resolution"))).toEqual(["1K", "1.5K", "2K"]);
  });
  it("「Transparent output requires PNG」：选透明背景时输出格式只剩 png", () => {
    const format = param("seedream-5-pro", "edit", "output_format");
    expect(values(format)).toEqual(expect.arrayContaining(["jpeg", "png"]));
    expect(format?.optionConstraints?.some((rule) => rule.when.key === "background" && rule.when.value === "transparent" && rule.values.join() === "png")).toBe(true);
    expect(values(param("seedream-5-pro", "edit", "background"))).toEqual(["opaque", "transparent"]);
  });
  it("文生图没有 background（官方：透明只在改图）", () => {
    expect(param("seedream-5-pro", "t2i", "background")).toBeUndefined();
  });
});

describe("Seedream 5.5", () => {
  it("「1K / 1.5K / 2K，3K / 4K are unsupported」「without resolution also uses 2K」", () => {
    for (const mode of ["t2i", "edit"]) {
      const resolution = param("seedream-5-5", mode, "resolution");
      expect(values(resolution)).toEqual(["1K", "1.5K", "2K"]);
      expect(resolution?.defaultValue).toBe("2K");
    }
  });
  it("「Supported ratios: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 2:1, 1:2」", () => {
    expect(values(param("seedream-5-5", "t2i", "size"))).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "2:1", "1:2"]);
  });
  it("「auto (default), transparent, or opaque」+「Transparent output requires PNG」", () => {
    const background = param("seedream-5-5", "t2i", "background");
    expect(values(background)).toEqual(["auto", "transparent", "opaque"]);
    expect(background?.defaultValue).toBe("auto");
    expect(param("seedream-5-5", "t2i", "output_format")?.optionConstraints?.[0]?.values).toEqual(["png"]);
  });
  it("「Up to 10 references」：改图收 1–10 张，走 image_urls", () => {
    const slot = apimart("seedream-5-5").modes.find((mode) => mode.id === "edit")!.slots[0]!;
    expect([slot.kind, slot.min, slot.max, slot.inputKey]).toEqual(["image_ref", 1, 10, "image_urls"]);
  });
});

describe("可灵 4.0 Flash", () => {
  const flash = () => apimart("kling-v4-flash");
  it("五种方式：文生 / 图生 / 全能参考 / 视频编辑 / 视频续写", () => {
    expect(flash().modes.map((mode) => mode.id)).toEqual(["t2v", "i2v", "ref", "edit", "extend"]);
  });
  it("「Only 720p」：没有清晰度控件", () => {
    for (const mode of flash().modes) expect(mode.params.some((control) => control.key === "resolution"), mode.id).toBe(false);
  });
  it("「Image-to-video does not accept aspect_ratio」：图生没有比例", () => {
    expect(param("kling-v4-flash", "i2v", "aspect_ratio")).toBeUndefined();
  });
  it("「omni_reference_task_type」按方式钉死：reference / edit / extend", () => {
    for (const [mode, type] of [["ref", "reference"], ["edit", "edit"], ["extend", "extend"]] as const) {
      expect(flash().modes.find((item) => item.id === mode)?.fixedParams).toEqual({ omni_reference_task_type: type });
    }
  });
  it("「Extension does not accept … aspect_ratio, or audio_setting」", () => {
    const extend = flash().modes.find((mode) => mode.id === "extend")!;
    expect(extend.params.map((control) => control.key)).toEqual(["duration"]);
  });
  it("参考生成：最多 10 张图 + 5 段视频，合计 15", () => {
    const ref = flash().modes.find((mode) => mode.id === "ref")!;
    expect(ref.slots.map((slot) => [slot.kind, slot.max])).toEqual([["image_ref", 10], ["video_ref", 5]]);
    expect(ref.maxTotalReferences).toBe(15);
  });
});

describe("MiniMax H3-Max（APIMart）", () => {
  const h3 = () => apimart("minimax-h3-max");
  it("「480P / 768P / 1080P」，不含 2K", () => {
    expect(values(param("minimax-h3-max", "t2v", "resolution"))).toEqual(expect.arrayContaining(["480P", "768P", "1080P"]));
    expect(values(param("minimax-h3-max", "t2v", "resolution"))).not.toContain("2K");
  });
  it("多模态参考：图 ≤9 / 视频 ≤3 / 音频 ≤3，各走 image_urls / video_urls / audio_urls", () => {
    const ref = h3().modes.find((mode) => mode.id === "ref")!;
    expect(ref.slots.map((slot) => [slot.kind, slot.max, slot.inputKey])).toEqual([["image_ref", 9, "image_urls"], ["video_ref", 3, "video_urls"], ["audio_ref", 3, "audio_urls"]]);
  });
  it("首尾帧用标准键 first_frame_image / last_frame_image", () => {
    const i2v = h3().modes.find((mode) => mode.id === "i2v")!;
    expect(i2v.slots.map((slot) => slot.inputKey)).toEqual(["first_frame_image", "last_frame_image"]);
  });
  it("「I2V: determined by the input image; this field is ignored」：图生没有比例", () => {
    expect(param("minimax-h3-max", "i2v", "aspect_ratio")).toBeUndefined();
  });
});

describe("Seedance 2.5（APIMart）水印 / 容器 / 内容审核", () => {
  it("watermark 开关、output_format mp4 / mov、nsfw_check 开关默认关", () => {
    expect(param("seedance-2.5-apimart", "t2v", "watermark")?.type).toBe("boolean");
    expect(values(param("seedance-2.5-apimart", "t2v", "output_format"))).toEqual(["mp4", "mov"]);
    expect(param("seedance-2.5-apimart", "t2v", "nsfw_check")?.defaultValue).toBe(false);
  });
});
