import { deriveSampleArchetype } from "./sampleMode";
import { SEEDANCE_2_5_APIMART_ARCHETYPE } from "./seedance25Apimart";

/**
 * Seedance 2.5（样片模式）：目录里独立的一行（照 grok-imagine-1.5-video-apimart 的独立行先例）。
 * 档案由代码从 Seedance 2.5 推出——方式、参考、参数跟父档案走，只把清晰度收窄成 480p，
 * 再加出高清方式（只带样片号和目标清晰度）。约价按父行 `doubao-seedance-2.5`（见 sampleBillingRequest）。
 */
export const SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE = deriveSampleArchetype(SEEDANCE_2_5_APIMART_ARCHETYPE, {
  id: "seedance-2.5-apimart-sample",
  label: "Seedance 2.5（样片模式）",
  identifierPatterns: ["doubao-seedance-2.5-sample"],
  billedAs: { modelKey: "doubao-seedance-2.5" },
});
