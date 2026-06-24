// 即梦官方 dreamina CLI 的 Seedance 2.0 档案（声明视频生成的控件/模式/变体，通用系统据此渲染 UI）。
// dreamina 底层就是 Seedance 2.0，但走本地 CLI、参数 enum 以官方 `-h` 为准（duration 4-15、6 种比例、
// 720p；1080p 仅 vip 档）。v1 只声明文生视频模式（图生/首尾帧/全能参考留下一切片，见 dreaminaVideos.ts）。
import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));

// 官方 -h：ratio ∈ {1:1,3:4,16:9,4:3,9:16,21:9}；video_resolution 720p（_vip 档可 1080p）；duration 4-15。
const PARAMS: ModelParameterControl[] = [
  { key: "ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]), defaultValue: "16:9" },
  { key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
];

const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v",
    intent: "text",
    vendorTerm: "文生视频",
    hint: "用即梦会员积分，纯文字生成 Seedance 2.0 视频",
    promptRequired: true,
    transportTaskKind: "text_to_video",
    slots: [],
    params: PARAMS,
  },
];

// 非 vip 档不支持 1080p（官方 -h）→ 把清晰度收成只有 720p，UI 不给用户选个跑不了的选项（effect-first）。
const lowResParam: ModelParameterControl = { key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p"]), defaultValue: "720p" };
const narrowResolutionToLow = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "video_resolution" ? lowResParam : p));
const LOW_RES_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, narrowResolutionToLow] as const));

export const DREAMINA_SEEDANCE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-seedance-2",
  family: "seedance",
  label: "即梦 Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["dreamina-seedance-2.0", "dreamina-seedance"],
  modes: MODES,
  // 5 变体 = dreamina 的 model_version（默认 fast，官方 -h 默认值）。非 vip 档锁 720p。
  variants: [
    { id: "fast", label: "快速", modelKey: "seedance2.0fast", paramOverrides: LOW_RES_OVERRIDES },
    { id: "standard", label: "标准", modelKey: "seedance2.0", paramOverrides: LOW_RES_OVERRIDES },
    { id: "vip", label: "VIP·可1080p", modelKey: "seedance2.0_vip" },
    { id: "fast_vip", label: "VIP快速·可1080p", modelKey: "seedance2.0fast_vip" },
    { id: "mini", label: "Mini", modelKey: "seedance2.0mini", paramOverrides: LOW_RES_OVERRIDES },
  ],
  defaultVariantId: "fast",
};
