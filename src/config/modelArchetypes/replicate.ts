import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Replicate 官方模型契约（2026-08-14 核对官方模型页）。这些档案只描述模型能力和输入槽位，
// 不描述 Replicate 的 HTTP 传输；传输映射位于 electron/catalog/replicateModels.ts。

const options = (values: Array<string | number | boolean>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

const FLUX_SCHNELL_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"]), defaultValue: "1:1" },
  { key: "num_outputs", label: "输出数量", type: "number", options: [], min: 1, max: 4, defaultValue: 1 },
  { key: "num_inference_steps", label: "推理步数", type: "number", options: [], min: 1, max: 4, defaultValue: 4 },
  { key: "seed", label: "随机种子", type: "number", options: [] },
  { key: "output_format", label: "格式", type: "select", options: options(["webp", "jpg", "png"]), defaultValue: "webp" },
  { key: "output_quality", label: "输出质量", type: "number", options: [], min: 0, max: 100, defaultValue: 80 },
  { key: "disable_safety_checker", label: "关闭安全检查", type: "boolean", options: [], defaultValue: false },
  { key: "go_fast", label: "快速模式", type: "boolean", options: [], defaultValue: true },
  { key: "megapixels", label: "像素量", type: "select", options: options(["1", "0.25"]), defaultValue: "1" },
];

export const REPLICATE_FLUX_SCHNELL_ARCHETYPE: ModelArchetype = {
  id: "replicate-flux-schnell",
  family: "flux-schnell",
  label: "FLUX Schnell",
  kind: "image",
  sources: [{ url: "https://replicate.com/black-forest-labs/flux-schnell", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "文生图输入与输出参数" }],
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["black-forest-labs/flux-schnell"],
  modes: [{
    id: "t2i",
    intent: "text",
    vendorTerm: "文生图",
    hint: "从文字生成一张或多张图片",
    promptRequired: true,
    transportTaskKind: "text_to_image",
    slots: [],
    params: FLUX_SCHNELL_PARAMS,
  }],
};

const fluxKontextParams = (safetyMax: number): ModelParameterControl[] => [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["match_input_image", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "9:21", "2:1", "1:2"]), defaultValue: "match_input_image" },
  { key: "output_format", label: "格式", type: "select", options: options(["jpg", "png"]), defaultValue: "png" },
  { key: "seed", label: "随机种子", type: "number", options: [] },
  { key: "safety_tolerance", label: "安全容忍度", type: "number", options: [], min: 0, max: safetyMax, defaultValue: 2 },
  { key: "prompt_upsampling", label: "提示词优化", type: "boolean", options: [], defaultValue: false },
];

export const REPLICATE_FLUX_KONTEXT_PRO_ARCHETYPE: ModelArchetype = {
  id: "replicate-flux-kontext-pro",
  family: "flux-kontext",
  label: "FLUX Kontext Pro",
  kind: "image",
  sources: [{ url: "https://replicate.com/black-forest-labs/flux-kontext-pro", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "文生图、单图编辑输入与输出参数" }],
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["black-forest-labs/flux-kontext-pro"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "没有输入图时从文字生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: fluxKontextParams(6),
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "使用一张输入图进行文字编辑",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "input_image", asArray: false }],
      // Replicate 官方契约：带 input_image 时 safety_tolerance 最大只能为 2。
      params: fluxKontextParams(2),
    },
  ],
};

const QWEN_EDIT_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["1:1", "16:9", "9:16", "4:3", "3:4", "match_input_image"]), defaultValue: "match_input_image" },
  { key: "go_fast", label: "快速模式", type: "boolean", options: [], defaultValue: true },
  { key: "seed", label: "随机种子", type: "number", options: [] },
  { key: "output_format", label: "格式", type: "select", options: options(["webp", "jpg", "png"]), defaultValue: "webp" },
  { key: "output_quality", label: "输出质量", type: "number", options: [], min: 0, max: 100, defaultValue: 95 },
  { key: "disable_safety_checker", label: "关闭安全检查", type: "boolean", options: [], defaultValue: false },
];

export const REPLICATE_QWEN_IMAGE_EDIT_ARCHETYPE: ModelArchetype = {
  id: "replicate-qwen-image-edit",
  family: "qwen-image-edit",
  label: "Qwen Image Edit",
  kind: "image",
  sources: [{ url: "https://replicate.com/qwen/qwen-image-edit", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "单图编辑输入与输出参数" }],
  defaultModeId: "edit",
  transportTaskKind: "image_edit",
  identifierPatterns: ["qwen/qwen-image-edit"],
  modes: [{
    id: "edit",
    intent: "edit",
    vendorTerm: "改图",
    hint: "必须提供一张输入图和编辑提示词",
    promptRequired: true,
    transportTaskKind: "image_edit",
    slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "image", asArray: false }],
    params: QWEN_EDIT_PARAMS,
  }],
};

const NANO_BANANA_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["match_input_image", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]), defaultValue: "match_input_image" },
  { key: "output_format", label: "格式", type: "select", options: options(["jpg", "png"]), defaultValue: "jpg" },
];

export const REPLICATE_NANO_BANANA_ARCHETYPE: ModelArchetype = {
  id: "replicate-nano-banana",
  family: "nano-banana",
  label: "Nano Banana",
  kind: "image",
  sources: [{ url: "https://replicate.com/google/nano-banana", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "多图融合与图像生成输入参数" }],
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["google/nano-banana"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: NANO_BANANA_PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "多图融合 / 改图",
      hint: "最多 3 张输入图，可用于融合、参考和编辑",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 3, inputKey: "image_input" }],
      params: NANO_BANANA_PARAMS,
    },
  ],
};

const MINIMAX_VIDEO_PARAMS: ModelParameterControl[] = [
  { key: "prompt_optimizer", label: "提示词优化", type: "boolean", options: [], defaultValue: true },
];

export const REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE: ModelArchetype = {
  id: "replicate-minimax-video-01",
  family: "minimax-video-01",
  label: "MiniMax Video-01",
  kind: "video",
  sources: [{ url: "https://replicate.com/minimax/video-01", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "文生视频、首帧和角色参考输入" }],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["minimax/video-01"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成 6 秒视频",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: MINIMAX_VIDEO_PARAMS,
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "首帧图生视频",
      hint: "使用一张首帧图生成视频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }],
      params: MINIMAX_VIDEO_PARAMS,
    },
    {
      id: "s2v",
      intent: "character",
      vendorTerm: "角色参考视频",
      hint: "使用角色参考图生成视频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "角色参考", min: 1, max: 1, inputKey: "subject_reference", asArray: false }],
      params: MINIMAX_VIDEO_PARAMS,
    },
  ],
};

const SEEDANCE_COMMON_PARAMS: ModelParameterControl[] = [
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 2, max: 12, defaultValue: 5 },
  { key: "resolution", label: "清晰度", type: "select", options: options(["480p", "720p", "1080p"]), defaultValue: "1080p" },
  { key: "camera_fixed", label: "固定机位", type: "boolean", options: [], defaultValue: false },
  { key: "seed", label: "随机种子", type: "number", options: [] },
];

const SEEDANCE_T2V_PARAMS: ModelParameterControl[] = [
  ...SEEDANCE_COMMON_PARAMS.slice(0, 2),
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"]), defaultValue: "16:9" },
  ...SEEDANCE_COMMON_PARAMS.slice(2),
];

export const REPLICATE_SEEDANCE_1_PRO_ARCHETYPE: ModelArchetype = {
  id: "replicate-seedance-1-pro",
  family: "seedance-1-pro",
  label: "Seedance 1 Pro",
  kind: "video",
  sources: [{ url: "https://replicate.com/bytedance/seedance-1-pro", checkedAt: "2026-08-14", vendorKey: "replicate", covers: "文生视频、图生视频、首尾帧输入与参数" }],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["bytedance/seedance-1-pro"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: SEEDANCE_T2V_PARAMS,
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "图生视频",
      hint: "使用首帧图片生成视频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image", asArray: false }],
      // Replicate 官方契约：传 image 时 aspect_ratio 被忽略，UI 和请求都不再暴露它。
      params: SEEDANCE_COMMON_PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "使用首帧和尾帧控制视频两端",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image", asArray: false },
        { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame_image", asArray: false },
      ],
      params: SEEDANCE_COMMON_PARAMS,
    },
  ],
};

export const REPLICATE_ARCHETYPES: readonly ModelArchetype[] = [
  REPLICATE_FLUX_SCHNELL_ARCHETYPE,
  REPLICATE_FLUX_KONTEXT_PRO_ARCHETYPE,
  REPLICATE_QWEN_IMAGE_EDIT_ARCHETYPE,
  REPLICATE_NANO_BANANA_ARCHETYPE,
  REPLICATE_MINIMAX_VIDEO_01_ARCHETYPE,
  REPLICATE_SEEDANCE_1_PRO_ARCHETYPE,
];
