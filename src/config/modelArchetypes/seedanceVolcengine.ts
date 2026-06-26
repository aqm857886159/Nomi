import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));

const PARAMS: ModelParameterControl[] = [
  { key: "ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p", "4k"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
];

const MODES: ModelArchetype["modes"] = [
  { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
  {
    id: "first",
    intent: "single",
    vendorTerm: "首帧",
    hint: "单张首帧图驱动生成",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "volcengine_first_image_content" }],
    params: PARAMS,
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧，过渡更可控",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "volcengine_first_role_image_content" },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "volcengine_last_role_image_content" },
    ],
    params: PARAMS,
  },
  {
    id: "omni",
    intent: "character",
    vendorTerm: "全能参考",
    hint: "多模态参考；最多 9 图 / 3 视频 / 3 音频",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true, inputKey: "volcengine_image_contents" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "volcengine_video_contents" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "volcengine_audio_contents" },
    ],
    params: PARAMS,
  },
];

const lowResParam: ModelParameterControl = {
  key: "resolution",
  label: "清晰度",
  type: "select",
  options: opt(["480p", "720p"]),
  defaultValue: "720p",
};
const narrowResolutionToLow = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution" ? lowResParam : p));
const LOW_RES_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, narrowResolutionToLow] as const));

export const SEEDANCE_VOLCENGINE_ARCHETYPE: ModelArchetype = {
  id: "volcengine-seedance-2",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: [
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
  ],
  modes: MODES,
  variants: [
    { id: "standard", label: "标准", modelKey: "doubao-seedance-2-0-260128" },
    { id: "fast", label: "快速", modelKey: "doubao-seedance-2-0-fast-260128", paramOverrides: LOW_RES_OVERRIDES },
    { id: "mini", label: "Mini", modelKey: "doubao-seedance-2-0-mini-260615", paramOverrides: LOW_RES_OVERRIDES },
  ],
  defaultVariantId: "standard",
};
