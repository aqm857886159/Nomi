import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Sora 2（apimart 独占）视频档案。契约见 docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A
// （已真 mp4 验证）。文生视频 / 图生视频（image_urls ≤1）。param 键 = apimart 字段名。
//
// 变体（2026-06-16，官方 model 枚举 sora-2 / sora-2-pro）：标准只支持 720p；Pro 解锁 1024p/1080p。
// duration 官方离散枚举 4/8/12/16/20（非连续）→ select，避免发 5/6/7 触发 400。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
// 数值离散枚举（duration 等）：option value 为 number → parseControlInput 发整数（避 vendor 400），select UI 不可输非法值。
const numOpt = (values: number[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: `${value}` }));

const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16"]), defaultValue: "16:9" },
  // 标准 sora-2 仅 720p（官方）；Pro 经变体 paramOverrides 放宽到 720p/1024p/1080p。
  { key: "resolution", label: "清晰度", type: "select", options: opt(["720p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "select", options: numOpt([4, 8, 12, 16, 20]), defaultValue: 4 },
];

// Pro 变体：resolution 放宽到 720p/1024p/1080p，跨所有 mode 叠加（specializeArchetypeForVariant）。
const PRO_RES: ModelParameterControl = {
  key: "resolution", label: "清晰度", type: "select", options: opt(["720p", "1024p", "1080p"]), defaultValue: "720p",
};
const widenResolutionToPro = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution" ? PRO_RES : p));

const MODES = [
  { id: "t2v", intent: "text" as const, vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video" as const, slots: [], params: PARAMS },
  {
    id: "i2v", intent: "single" as const, vendorTerm: "图生视频", hint: "单张参考图驱动（比例随图自动决定）", promptRequired: true,
    transportTaskKind: "image_to_video" as const,
    slots: [{ kind: "image_ref" as const, label: "参考图", min: 1, max: 1, inputKey: "image_urls" }],
    params: PARAMS,
  },
];

const PRO_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, widenResolutionToPro] as const));

export const SORA_2_ARCHETYPE: ModelArchetype = {
  id: "sora-2",
  family: "sora",
  label: "Sora 2",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["sora-2", "sora-2-pro", "sora2"],
  modes: MODES,
  // 变体：标准（sora-2，720p）/ Pro（sora-2-pro，720p/1024p/1080p）。
  variants: [
    { id: "standard", label: "标准", modelKey: "sora-2", identifierPatterns: ["sora2"] },
    { id: "pro", label: "Pro", modelKey: "sora-2-pro", identifierPatterns: ["sora-2-pro"], paramOverrides: PRO_OVERRIDES },
  ],
  defaultVariantId: "standard",
};
