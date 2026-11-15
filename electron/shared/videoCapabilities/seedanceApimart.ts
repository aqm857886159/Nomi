import type { ArchetypeSource, ModelArchetype, ModelParameterControl } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p", "4k"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
  { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
];

const APIMART_SOURCE: ArchetypeSource = {
  url: "https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md",
  checkedAt: "2026-11-15",
  vendorKey: "apimart",
  covers: "image/video/audio reference channels, role arrays, and mutual exclusions; prompt: Required for text-to-video; optional for image-to-video or video-reference-to-video",
};

const VOLCENGINE_SOURCE: ArchetypeSource = {
  url: "https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01",
  checkedAt: "2026-08-24",
  vendorKey: "volcengine",
  covers: "Seedance duration/ratio/audio fields and prompt examples describing camera motion",
};

const PROMPT_CAMERA_CHANNEL = {
  signal: "camera_motion",
  via: "prompt" as const,
  status: "documented" as const,
  evidence: VOLCENGINE_SOURCE,
};

const MOTION_REFERENCE_CHANNEL = {
  signal: "motion_reference",
  via: "reference_slot" as const,
  status: "documented" as const,
  slotKind: "video_ref" as const,
  evidence: APIMART_SOURCE,
};

// 提示词只在文生必填：APIMart 原话「Required for text-to-video; optional for image-to-video or video-reference-to-video」
// ——放了素材的三种方式不拦空提示词（2026-11-15，用户 11-13 口径：拿不准的只提醒、不拦）。
const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v",
    intent: "text",
    vendorTerm: "文生视频",
    hint: "纯文字生成视频",
    promptRequired: true,
    transportTaskKind: "text_to_video",
    slots: [],
    expressionChannels: [PROMPT_CAMERA_CHANNEL],
    params: PARAMS,
  },
  {
    id: "i2v",
    intent: "single",
    vendorTerm: "图生视频",
    hint: "首帧/参考图驱动（最多 9 张）",
    promptRequired: false,
    transportTaskKind: "image_to_video",
    slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 9, inputKey: "image_urls" }],
    expressionChannels: [PROMPT_CAMERA_CHANNEL],
    params: PARAMS,
  },
  {
    id: "omni",
    intent: "character",
    vendorTerm: "全能参考",
    hint: "多模态参考；最多 9 图 / 3 视频 / 3 音频",
    promptRequired: false,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true, inputKey: "image_urls" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "video_urls" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "audio_urls", requiresAnyOf: ["image_ref", "video_ref"] },
    ],
    expressionChannels: [PROMPT_CAMERA_CHANNEL, MOTION_REFERENCE_CHANNEL],
    params: PARAMS,
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧，自动补间过渡",
    promptRequired: false,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1 },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
    ],
    combineSlotsInto: { key: "image_with_roles" },
    expressionChannels: [PROMPT_CAMERA_CHANNEL],
    params: PARAMS,
  },
];

const makeResNarrower = (values: string[]) => {
  const res: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(values), defaultValue: "720p" };
  return (params: ModelParameterControl[]): ModelParameterControl[] => params.map((p) => (p.key === "resolution" ? res : p));
};
const narrowResolutionToFast = makeResNarrower(["480p", "720p"]);
const FAST_OVERRIDES = Object.fromEntries(MODES.map((mode) => [mode.id, narrowResolutionToFast] as const));

export const SEEDANCE_2_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2-apimart",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  sources: [APIMART_SOURCE, VOLCENGINE_SOURCE],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: [
    "doubao-seedance-2.0", "doubao-seedance-2-0",
    "doubao-seedance-2.0-fast", "doubao-seedance-2-0-fast",
    "doubao-seedance-2.0-face", "doubao-seedance-2-0-face",
    "doubao-seedance-2.0-fast-face", "doubao-seedance-2-0-fast-face",
    "doubao-seedance-2.0-mini", "doubao-seedance-2-0-mini",
  ],
  modes: MODES,
  variants: [
    {
      id: "standard",
      label: "Seedance 2.0",
      modelKey: "doubao-seedance-2.0",
      identifierPatterns: ["doubao-seedance-2-0", "doubao-seedance-2.0-face", "doubao-seedance-2-0-face"],
    },
    {
      id: "fast",
      label: "Fast",
      modelKey: "doubao-seedance-2.0-fast",
      identifierPatterns: ["doubao-seedance-2-0-fast", "doubao-seedance-2.0-fast-face", "doubao-seedance-2-0-fast-face"],
      paramOverrides: FAST_OVERRIDES,
    },
    { id: "mini", label: "Mini", modelKey: "doubao-seedance-2.0-mini", identifierPatterns: ["doubao-seedance-2-0-mini"], paramOverrides: FAST_OVERRIDES },
  ],
  defaultVariantId: "fast",
  catalogModelKey: "doubao-seedance-2.0",
  variantIdAliases: { face: "standard", "fast-face": "fast" },
};
