// 即梦官方 dreamina CLI 的 curated 图片配方（单源）。process transport（spawn dreamina），契约见 dreaminaImage/Upscale 档案。
//   - 文生图(text2image)：8 模型变体（model 取 {{request.params.model}}）
//   - 改图(image2image)：1-10 张本地图输入（fileParams csv → --images=a,b）
//   - 超清(image_upscale)：单图输入，无 model
// 结果媒体走 ProcessResponse.video_url 容器（命名沿用视频；图片 mapping 经 response_mapping image_url 读它）。

import type { HttpOperation } from "./types";

const PROCESS_METHOD = "PROCESS";
const STATUS: Record<string, string[]> = {
  succeeded: ["success", "completed"],
  failed: ["fail", "failed", "error"],
  running: ["querying", "processing", "generating"],
  queued: ["queued", "pending", "in_queue"],
};
const IMAGE_RESPONSE = { task_id: "submit_id", status: "gen_status", image_url: "video_url" };
const PROVIDER_META = { task_id: "submit_id" };

export const DREAMINA_IMAGE_MODEL_KEY = "dreamina-image";
export const DREAMINA_UPSCALE_MODEL_KEY = "dreamina-upscale";

const QUERY_RESULT: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:query_result",
  process: { bin: "dreamina", parser: "dreamina-cli", appendDownloadDir: true, args: ["query_result", "--submit_id={{providerMeta.task_id}}"] },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

const TEXT2IMAGE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:text2image",
  process: {
    bin: "dreamina", parser: "dreamina-cli", appendDownloadDir: true,
    args: [
      "text2image",
      "--prompt={{request.prompt}}",
      "--ratio={{request.params.ratio}}",
      "--resolution_type={{request.params.resolution_type}}",
      "--model_version={{request.params.model}}",
      "--poll=30",
    ],
  },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

const IMAGE2IMAGE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:image2image",
  process: {
    bin: "dreamina", parser: "dreamina-cli", appendDownloadDir: true,
    fileParams: [{ param: "input_images", expose: "image_paths", mode: "csv" }],
    args: [
      "image2image",
      "--images={{request.params.image_paths}}",
      "--prompt={{request.prompt}}",
      "--ratio={{request.params.ratio}}",
      "--resolution_type={{request.params.resolution_type}}",
      "--model_version={{request.params.model}}",
      "--poll=30",
    ],
  },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

const IMAGE_UPSCALE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:image_upscale",
  process: {
    bin: "dreamina", parser: "dreamina-cli", appendDownloadDir: true,
    fileParams: [{ param: "input_image", expose: "image_path", mode: "single" }],
    args: ["image_upscale", "--image={{request.params.image_path}}", "--resolution_type={{request.params.resolution_type}}", "--poll=30"],
  },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

export const DREAMINA_IMAGE_CURATED_MODELS = [
  { modelKey: DREAMINA_IMAGE_MODEL_KEY, labelZh: "即梦图片（会员）", kind: "image" as const, archetypeId: "dreamina-image" },
  { modelKey: DREAMINA_UPSCALE_MODEL_KEY, labelZh: "即梦图片超清（会员）", kind: "image" as const, archetypeId: "dreamina-upscale" },
];

export const DREAMINA_IMAGE_CURATED_MAPPINGS = [
  { id: "seed-dreamina-image-text_to_image", taskKind: "text_to_image" as const, modelKey: DREAMINA_IMAGE_MODEL_KEY, name: "即梦图片 · 文生图", create: TEXT2IMAGE, query: QUERY_RESULT, statusMapping: STATUS },
  { id: "seed-dreamina-image-image_edit", taskKind: "image_edit" as const, modelKey: DREAMINA_IMAGE_MODEL_KEY, name: "即梦图片 · 改图", create: IMAGE2IMAGE, query: QUERY_RESULT, statusMapping: STATUS },
  { id: "seed-dreamina-upscale-image_edit", taskKind: "image_edit" as const, modelKey: DREAMINA_UPSCALE_MODEL_KEY, name: "即梦图片 · 超清放大", create: IMAGE_UPSCALE, query: QUERY_RESULT, statusMapping: STATUS },
];
