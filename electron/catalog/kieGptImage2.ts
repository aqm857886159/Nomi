// GPT Image 2 经 kie.ai 的 curated 传输契约（仿 kieSeedance.ts，单一真相源）。
// 契约由 2026-06-06 直连实测确认（tests/ux/kie-direct-image2.mjs，docs/workflow/2026-06-06-real-generation-e2e-loop.md）：
//   POST /api/v1/jobs/createTask  body = { model, input: { prompt, input_urls?, aspect_ratio } }
//   - 文生图 model = "gpt-image-2-text-to-image"，input 无 input_urls
//   - 图生图 model = "gpt-image-2-image-to-image"，input.input_urls = [图 URL...]（**字段名是 input_urls，不是 image_urls**）
//   GET  /api/v1/jobs/recordInfo?taskId=…  结果在 data.resultJson.resultUrls[0]（与 Seedance 同位置）。
//
// 为什么两条 mapping：catalogTaskActions.resolveTaskKind 对图像节点按「有无参考图」分桶——
//   有参考 → image_edit；无参考 → text_to_image。所以必须各配一条，vendor 按 model enum 自分流。
// 旧 bug（用户手配 / onboarding 抽错）：只有一条 (kie, text_to_image) 且是从视频模型克隆来的——
//   带 duration 视频参数、缺 input_urls、结果读 video_url 而 image_url 空。seedBuiltins 的 repair 会替换它。
//
// baseUrl/path 约定见 kieSeedance.ts（裸 baseUrl + 完整 /api/v1 path，避开 joinUrl 双前缀坑）。

import type { HttpOperation, ProfileKind } from "./types";

/** 文生图模型种子（modelKey 即 kie 的 model enum）。 */
export const GPT_IMAGE_2_T2I_MODEL_SEED = {
  modelKey: "gpt-image-2-text-to-image",
  labelZh: "GPT Image 2 · 文生图",
  kind: "image" as const,
} as const;

/** 图生图模型种子。 */
export const GPT_IMAGE_2_I2I_MODEL_SEED = {
  modelKey: "gpt-image-2-image-to-image",
  labelZh: "GPT Image 2 · 图生图",
  kind: "image" as const,
} as const;

/** 轮询：与 Seedance 同端点同结果路径，只是读 image_url。 */
export const GPT_IMAGE_2_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/jobs/recordInfo",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.state",
    image_url: "data.resultJson.resultUrls.0",
    error_message: "data.failMsg",
  },
};

const KIE_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["waiting", "queuing", "queued", "pending"],
  running: ["generating", "processing", "running"],
  succeeded: ["success", "succeeded", "completed"],
  failed: ["fail", "failed", "error", "expired"],
};

/** 文生图 createTask：input 只有 prompt + aspect_ratio（缺省 auto，模板引擎丢弃 undefined 键）。 */
export const GPT_IMAGE_2_T2I_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    // per-mode enum（档案当前模式 modelEnum，经 request.params.model）——伞档案 gpt-image-2 靠它分流到真端点。
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      // 铁律：resolution 是 gpt-image-2 本身的能力（kie 契约 1K/2K/4K），进基础层全站一致（非 apimart 专属）。
      resolution: "{{request.params.resolution}}",
    },
  },
};

/** 图生图 createTask：input_urls 取档案图生图模式的输入图数组（slot inputKey=input_urls → archetypeInput.input_urls）。 */
export const GPT_IMAGE_2_I2I_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      input_urls: "{{request.params.input_urls}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      resolution: "{{request.params.resolution}}",
    },
  },
};

/** (kie, text_to_image) mapping 种子。 */
export const GPT_IMAGE_2_T2I_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_image" as ProfileKind,
  name: "GPT Image 2 · 文生图",
  create: GPT_IMAGE_2_T2I_CREATE_OP,
  query: GPT_IMAGE_2_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};

/** (kie, image_edit) mapping 种子。 */
export const GPT_IMAGE_2_I2I_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_edit" as ProfileKind,
  name: "GPT Image 2 · 图生图",
  create: GPT_IMAGE_2_I2I_CREATE_OP,
  query: GPT_IMAGE_2_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};

/** 判断一条 mapping 是否「视频形状的坏 GPT Image 2」（用于 seedBuiltins 的 repair）。 */
export function isBrokenKieImageMapping(mapping: {
  vendorKey?: string;
  taskKind?: string;
  create?: { body?: unknown };
  query?: { response_mapping?: Record<string, unknown> };
}): boolean {
  if (mapping.vendorKey !== "kie" || mapping.taskKind !== "text_to_image") return false;
  const input = (mapping.create?.body as { input?: Record<string, unknown> } | undefined)?.input;
  // 视频形状的唯一可靠标志是 duration —— resolution 现在是 gpt-image-2 的合法图像参数（铁律：能力进基础层），
  // 不再当作「坏视频 mapping」标志（否则会把刚补好 resolution 的正确 mapping 误判 repair）。
  const hasVideoParam = Boolean(input && "duration" in input);
  const rm = mapping.query?.response_mapping || {};
  const readsVideo = !rm.image_url && Boolean(rm.video_url);
  return hasVideoParam || readsVideo;
}
