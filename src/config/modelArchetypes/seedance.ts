import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Seedance 2.0 档案。C1 放「首帧」打通；C2b 加「首尾帧」（验模式分段切换 + M2 互斥 hide）；
// 「全能参考」(omni 多参考数组槽) 在 C3 增量加。
// resolution/aspect_ratio/duration 取自 kie.ai 文档（docs.kie.ai/market/bytedance/seedance-2）。
// 标量参数用现有的 ModelParameterControl 形状（规则 1，不另造）。
// 首帧 / 首尾帧两模式标量参数相同（仅参考槽不同），故共用 FIRST_MODE_PARAMS。

const toOptions = (values: string[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: value }));

const FIRST_MODE_PARAMS: ModelParameterControl[] = [
  // 标准档清晰度含 4k（2026-06 火山引擎 FORCE 给 Seedance 2.0 追加原生 4K；kie 文档 resolution 枚举含 4k）。
  // Fast / Mini 档收窄到 480/720（见下 LOW_RES_OVERRIDES）。
  { key: "resolution", label: "清晰度", type: "select", options: toOptions(["480p", "720p", "1080p", "4k"]), defaultValue: "720p" },
  {
    key: "aspect_ratio",
    label: "比例",
    type: "select",
    options: toOptions(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"]),
    defaultValue: "16:9",
  },
  { key: "duration", label: "时长", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
  // key 对齐 kie input 键 generate_audio，让控件值直接流到请求体（avoid 键名漂移）。
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
];

const SEEDANCE_2_MODES: ModelArchetype["modes"] = [
  {
    id: "first",
    intent: "single",
    vendorTerm: "首帧",
    hint: "单张首帧图驱动生成",
    promptRequired: true,
    slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
    params: FIRST_MODE_PARAMS,
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧，过渡更可控",
    promptRequired: true,
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1 },
      { kind: "last_frame", label: "尾帧", min: 1, max: 1 },
    ],
    params: FIRST_MODE_PARAMS,
  },
  {
    // 全能参考（omni）：多模态参考数组。kie 文档：reference_image_urls[≤9]（按序 = character1..9）、
    // reference_video_urls[≤3]、reference_audio_urls[≤3]。三者与 first/last 帧互斥（§2 坑2）。
    // 角色图数组用**有序的画布边**表达（edge.order 保住 character1..N）+ 可手动上传（audit 2026-06-16 §1d
    // 收口；此前 meta-only 不画线的旧设计因 edge 无 order 字段而权宜，现已补 order）。
    id: "omni",
    intent: "character",
    vendorTerm: "全能参考",
    hint: "多模态参考；最多 9 角色 / 3 视频 / 3 音频",
    promptRequired: true,
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3 },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3 },
    ],
    params: FIRST_MODE_PARAMS,
  },
];

// Fast / Mini 变体清晰度仅 480/720（无 1080/4k，kie 文档）。运行时按 variantId 叠加（specializeArchetypeForVariant），
// 不再档案级复制——变体是正交轴，跨所有 mode 收窄 resolution。Fast 与 Mini 收窄目标相同，复用同一份 override（不另造）。
const LOW_RES: ModelParameterControl = {
  key: "resolution", label: "清晰度", type: "select", options: toOptions(["480p", "720p"]), defaultValue: "720p",
};
const narrowResolutionToLow = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution" ? LOW_RES : p));
const LOW_RES_OVERRIDES = Object.fromEntries(
  SEEDANCE_2_MODES.map((m) => [m.id, narrowResolutionToLow] as const),
);

export const SEEDANCE_2_ARCHETYPE: ModelArchetype = {
  id: "seedance-2",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "first",
  transportTaskKind: "image_to_video",
  // 收纳标准 + Fast + Mini 变体 modelKey → 旧 fast/mini 节点仍解析到本档案（迁移层据 variant.identifierPatterns 归一）。
  identifierPatterns: ["bytedance/seedance-2", "seedance-2", "seedance2", "bytedance/seedance-2-fast", "seedance-2-fast", "seedance2fast", "bytedance/seedance-2-mini", "seedance-2-mini", "seedance2mini"],
  modes: SEEDANCE_2_MODES,
  // 变体轴：标准 / 快速 / Mini（kie 的 model enum bytedance/seedance-2 / -fast / -mini）。快速与 Mini 仅 480/720
  // （LOW_RES_OVERRIDES 按 modeId 收窄 resolution）。catalog body 取 {{request.params.model}} 读当前变体 modelKey
  // （同 apimart Seedance，零传输改动）。Mini = 轻量档（比 Fast 更快更省，能力同档），2026-06 ByteDance 放出。
  variants: [
    { id: "standard", label: "标准", modelKey: "bytedance/seedance-2", identifierPatterns: ["seedance-2", "seedance2"] },
    { id: "fast", label: "快速", modelKey: "bytedance/seedance-2-fast", identifierPatterns: ["seedance-2-fast", "seedance2fast"], paramOverrides: LOW_RES_OVERRIDES },
    { id: "mini", label: "Mini", modelKey: "bytedance/seedance-2-mini", identifierPatterns: ["seedance-2-mini", "seedance2mini"], paramOverrides: LOW_RES_OVERRIDES },
  ],
  defaultVariantId: "standard",
};
