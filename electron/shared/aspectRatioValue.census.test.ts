// 全目录普查：Agent 说的比例在每一个「档案 × 变体 × 供应商分层 × 模式」组合上会落到哪里。
//
// 数法（与验收线 V-1023 对齐，设计卡 docs/plan/2026-10-05-agent-aspect-ratio-semantic.md §1 ⑥）：
//   · 档案有变体 → 只数各个变体（不再额外数一份未特化的基础档案——那份等于默认变体，会重复）；没有变体 → 数档案本身；
//   · 供应商分层 = 通用层 + 这个档案任一模式声明过 vendorParams 的每个供应商（整份档案按该供应商特化，没声明的模式沿用通用参数）；
//   · 每个分层下的每个模式各算一个组合。
// 这些数是目录的事实，目录长了就会变：变的时候改这里的数，并在 PR 里说一句是哪个档案带来的。
import { describe, expect, it } from "vitest";

import { MODEL_ARCHETYPES, specializeArchetypeForVariant, specializeArchetypeForVendor } from "./modelArchetypes";
import { optionsAreAspectRatios, resolveAspectRatioChoice } from "./aspectRatioValue";

type Combo = { id: string; controls: Array<{ key: string; options: Array<{ value: unknown; text?: string }>; defaultValue?: unknown }> };

function census(): Combo[] {
  const combos: Combo[] = [];
  for (const base of MODEL_ARCHETYPES) {
    const variants: Array<string | undefined> = base.variants?.length ? base.variants.map((variant) => variant.id) : [undefined];
    for (const variantId of variants) {
      const archetype = variantId ? specializeArchetypeForVariant(base, variantId) : base;
      const vendors = [null, ...new Set(archetype.modes.flatMap((mode) => Object.keys(mode.vendorParams ?? {})))];
      for (const vendor of vendors) {
        for (const mode of specializeArchetypeForVendor(archetype, vendor).modes) {
          combos.push({
            id: `${base.id}${variantId ? `@${variantId}` : ""}/${vendor ?? "*"}/${mode.id}`,
            controls: (mode.params ?? []).map((control) => ({
              key: control.key,
              options: (control.options ?? []).map((option) => ({ value: option.value, text: option.label })),
              defaultValue: control.defaultValue,
            })),
          });
        }
      }
    }
  }
  return combos;
}

const isPixelControl = (combo: Combo): boolean => combo.controls.some((control) =>
  control.options.some(({ value }) => typeof value === "string" && /^\d{3,}:\d{3,}$/.test(value)));

describe("全目录普查（档案 × 变体 × 供应商分层 × 模式）", () => {
  const combos = census();

  // 2026-10-06 +2：Topaz 图片放大、Recraft 清晰放大各一个 upscale 组合（放大没有比例控件，归进下面「没有比例选择」）。
  it("总数与「有比例控件」的数和验收线对得上：338 个组合，按共享判据 231 个有比例控件", () => {
    expect(combos).toHaveLength(338);
    expect(combos.filter((combo) => combo.controls.some((control) => optionsAreAspectRatios(control.options)))).toHaveLength(231);
  });

  it("宿主翻译多认 13 个（Runway 上带「自动 + 分辨率档」的 Wan 3.0 / Seedream 5 Pro / Grok Imagine 图像），94 个没有比例选择，没有一个组合有两个比例控件", () => {
    const outcomes = combos.map((combo) => resolveAspectRatioChoice("16:9", combo.controls));
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.reason === "no_ratio_control")).toHaveLength(94);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.reason === "ambiguous")).toHaveLength(0);
  });

  it("像素档的 56 个组合，说 16:9 / 9:16 全部直接对上（不再拒、不再列一串像素值）", () => {
    const pixel = combos.filter(isPixelControl);
    expect(pixel).toHaveLength(56);
    for (const requested of ["16:9", "9:16"]) {
      const misses = pixel.filter((combo) => !resolveAspectRatioChoice(requested, combo.controls).ok).map((combo) => combo.id);
      expect(misses, `${requested} 在这些像素档组合上没对上`).toEqual([]);
    }
  });

  it("每个有比例控件的组合：说的比例要么落进它自己的选项，要么拒——落下的值一定是那个控件的选项之一", () => {
    for (const combo of combos) {
      for (const requested of ["16:9", "9:16", "1:1", "4:3", "21:9", "auto"]) {
        const outcome = resolveAspectRatioChoice(requested, combo.controls);
        if (!outcome.ok) continue;
        const control = combo.controls.find((candidate) => candidate.key === outcome.key)!;
        expect(control.options.map(({ value }) => value), `${combo.id} ${requested}`).toContain(outcome.value);
      }
    }
  });
});
