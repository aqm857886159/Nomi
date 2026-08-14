import type { HttpOperation, ProfileKind } from "./types";

/** Replicate 官方 prediction 状态；字段名与 HTTP API 文档一致。 */
export const REPLICATE_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["starting"],
  running: ["processing"],
  succeeded: ["succeeded"],
  failed: ["failed", "canceled", "cancelled"],
};

const replicateInput = (fields: Record<string, unknown>): Record<string, unknown> => ({
  input: fields,
});

const PREDICTION_HEADERS = {
  Authorization: "Bearer {{user_api_key}}",
  "Content-Type": "application/json",
  // 官方文档允许 wait=1..60；超过 60 秒仍返回 prediction id，随后由 query 继续轮询。
  Prefer: "wait=60",
};

const predictionResponseMapping = {
  task_id: "id",
  status: "status",
  assets: "output",
  error_message: "error",
};

const predictionMetaMapping = { task_id: "id" };

function predictionCreate(modelKey: string, fields: Record<string, unknown>): HttpOperation {
  return {
    method: "POST",
    path: `/models/${modelKey}/predictions`,
    headers: PREDICTION_HEADERS,
    body: replicateInput(fields),
    response_mapping: predictionResponseMapping,
    provider_meta_mapping: predictionMetaMapping,
  };
}

const PREDICTION_QUERY: HttpOperation = {
  method: "GET",
  path: "/predictions/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: predictionResponseMapping,
};

const param = (key: string) => `{{request.params.${key}}}`;

const FLUX_SCHNELL_CREATE = predictionCreate("black-forest-labs/flux-schnell", {
  prompt: "{{request.prompt}}",
  aspect_ratio: param("aspect_ratio"),
  num_outputs: param("num_outputs"),
  num_inference_steps: param("num_inference_steps"),
  seed: param("seed"),
  output_format: param("output_format"),
  output_quality: param("output_quality"),
  disable_safety_checker: param("disable_safety_checker"),
  go_fast: param("go_fast"),
  megapixels: param("megapixels"),
});

const FLUX_KONTEXT_CREATE = predictionCreate("black-forest-labs/flux-kontext-pro", {
  prompt: "{{request.prompt}}",
  input_image: param("input_image"),
  aspect_ratio: param("aspect_ratio"),
  output_format: param("output_format"),
  seed: param("seed"),
  safety_tolerance: param("safety_tolerance"),
  prompt_upsampling: param("prompt_upsampling"),
});

const QWEN_IMAGE_EDIT_CREATE = predictionCreate("qwen/qwen-image-edit", {
  prompt: "{{request.prompt}}",
  image: param("image"),
  aspect_ratio: param("aspect_ratio"),
  go_fast: param("go_fast"),
  seed: param("seed"),
  output_format: param("output_format"),
  output_quality: param("output_quality"),
  disable_safety_checker: param("disable_safety_checker"),
});

const NANO_BANANA_CREATE = predictionCreate("google/nano-banana", {
  prompt: "{{request.prompt}}",
  image_input: param("image_input"),
  aspect_ratio: param("aspect_ratio"),
  output_format: param("output_format"),
});

const MINIMAX_VIDEO_CREATE = predictionCreate("minimax/video-01", {
  prompt: "{{request.prompt}}",
  prompt_optimizer: param("prompt_optimizer"),
  first_frame_image: param("first_frame_image"),
  subject_reference: param("subject_reference"),
});

const SEEDANCE_1_PRO_INPUT = {
  prompt: "{{request.prompt}}",
  image: param("image"),
  last_frame_image: param("last_frame_image"),
  duration: param("duration"),
  resolution: param("resolution"),
  // 官方 schema 的 fps 枚举只有整数 24，不给用户制造一个无效的可调参数。
  fps: 24,
  camera_fixed: param("camera_fixed"),
  seed: param("seed"),
};

const SEEDANCE_1_PRO_T2V_CREATE = predictionCreate("bytedance/seedance-1-pro", {
  ...SEEDANCE_1_PRO_INPUT,
  aspect_ratio: param("aspect_ratio"),
});

// 传 image 时 Replicate 明确忽略 aspect_ratio；单独的 create 形状也防止模式切换残值漏发。
const SEEDANCE_1_PRO_I2V_CREATE = predictionCreate("bytedance/seedance-1-pro", SEEDANCE_1_PRO_INPUT);

export type ReplicateCuratedModel = {
  modelKey: string;
  labelZh: string;
  kind: "image" | "video";
  archetypeId: string;
};

/** Electron 只持有可序列化 seed；archetype 内容由 src 注册表持有，跨边界一致性由测试逐项校验。 */
export const REPLICATE_CURATED_MODELS: ReplicateCuratedModel[] = [
  { modelKey: "black-forest-labs/flux-schnell", labelZh: "FLUX Schnell", kind: "image", archetypeId: "replicate-flux-schnell" },
  { modelKey: "black-forest-labs/flux-kontext-pro", labelZh: "FLUX Kontext Pro", kind: "image", archetypeId: "replicate-flux-kontext-pro" },
  { modelKey: "qwen/qwen-image-edit", labelZh: "Qwen Image Edit", kind: "image", archetypeId: "replicate-qwen-image-edit" },
  { modelKey: "google/nano-banana", labelZh: "Nano Banana", kind: "image", archetypeId: "replicate-nano-banana" },
  { modelKey: "minimax/video-01", labelZh: "MiniMax Video-01", kind: "video", archetypeId: "replicate-minimax-video-01" },
  { modelKey: "bytedance/seedance-1-pro", labelZh: "Seedance 1 Pro", kind: "video", archetypeId: "replicate-seedance-1-pro" },
];

export type ReplicateCuratedMapping = {
  id: string;
  taskKind: ProfileKind;
  modelKey: string;
  name: string;
  create: HttpOperation;
  query: HttpOperation;
  statusMapping: Record<string, string[]>;
};

const mapping = (id: string, taskKind: ProfileKind, modelKey: string, name: string, create: HttpOperation): ReplicateCuratedMapping => ({
  id,
  taskKind,
  modelKey,
  name,
  create,
  query: PREDICTION_QUERY,
  statusMapping: REPLICATE_STATUS_MAPPING,
});

/** 一条 mapping 对应一个真实的 (model, taskKind) 请求形状。模式之间共用请求形状时才共享 mapping。 */
export const REPLICATE_CURATED_MAPPINGS: ReplicateCuratedMapping[] = [
  mapping("seed-replicate-flux-schnell-text_to_image", "text_to_image", "black-forest-labs/flux-schnell", "FLUX Schnell · 文生图", FLUX_SCHNELL_CREATE),
  mapping("seed-replicate-flux-kontext-pro-text_to_image", "text_to_image", "black-forest-labs/flux-kontext-pro", "FLUX Kontext Pro · 文生图", FLUX_KONTEXT_CREATE),
  mapping("seed-replicate-flux-kontext-pro-image_edit", "image_edit", "black-forest-labs/flux-kontext-pro", "FLUX Kontext Pro · 改图", FLUX_KONTEXT_CREATE),
  mapping("seed-replicate-qwen-image-edit-image_edit", "image_edit", "qwen/qwen-image-edit", "Qwen Image Edit · 改图", QWEN_IMAGE_EDIT_CREATE),
  mapping("seed-replicate-nano-banana-text_to_image", "text_to_image", "google/nano-banana", "Nano Banana · 文生图", NANO_BANANA_CREATE),
  mapping("seed-replicate-nano-banana-image_edit", "image_edit", "google/nano-banana", "Nano Banana · 多图融合 / 改图", NANO_BANANA_CREATE),
  mapping("seed-replicate-minimax-video-01-text_to_video", "text_to_video", "minimax/video-01", "MiniMax Video-01 · 文生视频", MINIMAX_VIDEO_CREATE),
  mapping("seed-replicate-minimax-video-01-image_to_video", "image_to_video", "minimax/video-01", "MiniMax Video-01 · 图生视频 / 角色参考", MINIMAX_VIDEO_CREATE),
  mapping("seed-replicate-seedance-1-pro-text_to_video", "text_to_video", "bytedance/seedance-1-pro", "Seedance 1 Pro · 文生视频", SEEDANCE_1_PRO_T2V_CREATE),
  mapping("seed-replicate-seedance-1-pro-image_to_video", "image_to_video", "bytedance/seedance-1-pro", "Seedance 1 Pro · 图生视频 / 首尾帧", SEEDANCE_1_PRO_I2V_CREATE),
];
