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
  { key: "resolution", label: "清晰度", type: "select", options: toOptions(["480p", "720p", "1080p"]), defaultValue: "720p" },
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

export const SEEDANCE_2_ARCHETYPE: ModelArchetype = {
  id: "seedance-2",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "first",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["bytedance/seedance-2", "seedance-2", "seedance2"],
  modes: [
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
      // 数组槽 meta-only，不走画布边（评审 M6：edge 只有 3 个值，表达不了 9 个有序槽）。
      id: "omni",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "多模态参考；最多 9 角色 / 3 视频 / 3 音频",
      promptRequired: true,
      slots: [
        { kind: "image_ref", label: "角色参考", min: 0, max: 9 },
        { kind: "video_ref", label: "参考视频", min: 0, max: 3 },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 3 },
      ],
      params: FIRST_MODE_PARAMS,
    },
  ],
};

// Seedance 2.0 Fast：与 2.0 **同形**——同模式、同参考槽、同传输 mapping（kie 的 image_to_video，body
// 用 {{model.modelKey}} 自动取到 fast 的 enum，无需 per-mode 覆盖）。唯一差异：清晰度仅 480/720（无 1080，
// kie 文档）。这正是「同族扩展 = 改几行数据」的样板：复用 2.0 的 modes，只换 resolution 选项。
const FAST_RES: ModelParameterControl = {
  key: "resolution", label: "清晰度", type: "select", options: toOptions(["480p", "720p"]), defaultValue: "720p",
};
const withFastResolution = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution" ? FAST_RES : p));

export const SEEDANCE_2_FAST_ARCHETYPE: ModelArchetype = {
  ...SEEDANCE_2_ARCHETYPE,
  id: "seedance-2-fast",
  label: "Seedance 2.0 Fast",
  identifierPatterns: ["bytedance/seedance-2-fast", "seedance-2-fast", "seedance2fast"],
  modes: SEEDANCE_2_ARCHETYPE.modes.map((mode) => ({ ...mode, params: withFastResolution(mode.params) })),
};
