// 测试专用的变体夹具（只在测试里装，装完必须还原）：今天内置档案里没有哪个变体会改方式的键或缺省值，
// 「主进程 / Run provider 按变体出键」就没有可观测差异、改坏了也红不起来（独立验收 V-mode-params-pr1 条件 1）。
// 这里给 Seedance 2.0（APIMart）的 standard 变体临时加一份文生方式的改写：清晰度缺省 1080p、不声明 generate_audio。
// 默认变体 fast 没有这份改写 —— 所以「按变体出键」与「落到默认变体出键」在这个夹具下字节不同。
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../shared/videoCapabilities/seedanceApimart";

export const VARIANT_FIXTURE = {
  archetypeId: "seedance-2-apimart",
  modelKey: "doubao-seedance-2.0",
  modeId: "t2v",
  /** 带改写的变体。 */
  variantId: "standard",
  /** 落到默认变体（fast）时 t2v 的缺省清晰度。 */
  defaultVariantResolution: "720p",
  /** 夹具变体 t2v 的缺省清晰度。 */
  fixtureResolution: "1080p",
  /** 夹具变体 t2v 不再声明的键（别的方式仍声明，所以仍在管辖范围内）。 */
  droppedKey: "generate_audio",
} as const;

export function installVariantFixture(): () => void {
  const variant = SEEDANCE_2_APIMART_ARCHETYPE.variants?.find((candidate) => candidate.id === VARIANT_FIXTURE.variantId);
  if (!variant) throw new Error("variant fixture: standard variant missing");
  if (variant.paramOverrides) throw new Error("variant fixture: standard variant already has overrides; the fixture premise no longer holds");
  variant.paramOverrides = {
    [VARIANT_FIXTURE.modeId]: (params) => params
      .filter((control) => control.key !== VARIANT_FIXTURE.droppedKey)
      .map((control) => (control.key === "resolution" ? { ...control, defaultValue: VARIANT_FIXTURE.fixtureResolution } : control)),
  };
  return () => { delete variant.paramOverrides; };
}
