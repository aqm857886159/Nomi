import { describe, expect, it } from "vitest";
import { getArchetypeById, specializeArchetypeForVariant, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { bodyReferencedParamKeys } from "./paramTranslate";

// 2026-11-15 核文档第二批「今天就是错的」五处里，落在档案声明上的那几处：面板上显示的 = 线上发得出去的。
// 每条都按 APIMart 这一家特化后的档案查（面板、Agent 说明、发送读的是同一份），变体有几个查几个。
// 出处见各档案 sources（checkedAt 2026-11-15）与设计卡 docs/plan/2026-11-15-archetype-wrong-today.md。

function apimartModes(archetypeId: string) {
  const base = getArchetypeById(archetypeId);
  if (!base) throw new Error(`archetype ${archetypeId} missing`);
  const variants: Array<string | undefined> = base.variants?.length ? base.variants.map((variant) => variant.id) : [undefined];
  return variants.flatMap((variantId) => {
    const archetype = specializeArchetypeForVendor(variantId ? specializeArchetypeForVariant(base, variantId) : base, "apimart");
    return archetype.modes.map((mode) => ({ where: `${archetypeId}${variantId ? `@${variantId}` : ""}/${mode.id}`, mode }));
  });
}

const keysOf = (mode: { params: ReadonlyArray<{ key: string }> }) => mode.params.map((control) => control.key);

describe("MiniMax H3（APIMart）：webhook 是管道，不露出也不进请求体", () => {
  it("每个方式都不声明 webhook 控件", () => {
    for (const { where, mode } of apimartModes("minimax-h3-apimart")) expect(keysOf(mode), where).not.toContain("webhook");
  });
  it("目录两条映射的 body 都不引用 webhook", () => {
    const model = APIMART_VIDEO_MODELS.find((item) => item.archetypeId === "minimax-h3-apimart")!;
    for (const mapping of model.mappings) expect(bodyReferencedParamKeys(mapping.create.body), mapping.id).not.toContain("webhook");
  });
});

describe("可灵 3.0 / Veo 3.1（APIMart）：图生方式比例跟输入图走，不给选", () => {
  it("可灵 3.0：图生不声明 aspect_ratio，文生仍声明", () => {
    const modes = apimartModes("kling-3.0");
    expect(keysOf(modes.find((row) => row.mode.id === "i2v")!.mode)).not.toContain("aspect_ratio");
    expect(keysOf(modes.find((row) => row.mode.id === "t2v")!.mode)).toContain("aspect_ratio");
  });
  it("Veo 3.1 每个变体：参考图 / 首尾帧不声明 aspect_ratio，文生仍声明", () => {
    for (const { where, mode } of apimartModes("veo-3.1")) {
      if (mode.id === "t2v") expect(keysOf(mode), where).toContain("aspect_ratio");
      else expect(keysOf(mode), where).not.toContain("aspect_ratio");
    }
  });
});

describe("Seedream 4.5（APIMart）：比例「auto」只在改图有（auto 要参考图才有得匹配）", () => {
  const sizeOptions = (modeId: string) => {
    const mode = apimartModes("seedream").find((row) => row.mode.id === modeId)!.mode;
    return (mode.params.find((control) => control.key === "size")?.options ?? []).map((option) => option.value);
  };
  it("文生图：比例选项里没有 auto", () => {
    expect(sizeOptions("t2i")).not.toContain("auto");
    expect(sizeOptions("t2i")).toContain("1:1");
  });
  it("改图：比例选项保留 auto", () => {
    expect(sizeOptions("edit")).toContain("auto");
  });
});

describe("Seedance 2.0 / Wan 3.0（APIMart）：只有文生要求提示词", () => {
  for (const archetypeId of ["seedance-2-apimart", "wan-3.0-apimart", "wan-3.0-prime-apimart"]) {
    it(archetypeId, () => {
      for (const { where, mode } of apimartModes(archetypeId)) {
        expect(mode.promptRequired, where).toBe(mode.intent === "text");
      }
    });
  }
});
