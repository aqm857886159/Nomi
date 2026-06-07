// apimart（apimart.ai）供应商种子 —— 第二家策展中转站（与 kie 并列）。
// 设计与接入契约见 docs/plan/2026-06-07-apimart-curated-onboarding.md（含 12 模型精确契约附录 A）。
//
// 与 kie 同构（都是 async create→poll 家族），但端点/形状不同（已用真 key 端到端核验，
// tests/transport-spike/apimart.mjs）：
//   创建  POST /v1/images/generations | /v1/videos/generations
//         → { code:200, data:[{ status:"submitted", task_id }] }   (task_id 在 data[0].task_id)
//   轮询  GET  /v1/tasks/{task_id}     (task_id 走**路径参数**，非 query)
//         → { code, data:{ status, result:{ images:[{url:[..]}] | videos:[..] }, error:{message} } }
//   status: pending|processing|completed|failed|cancelled
//
// baseUrl/path 约定（避开 joinUrl 双前缀坑，见 kieSeedance.ts 注释）：
//   vendor.baseUrl = "https://api.apimart.ai"（**裸**，不带 /v1）
//   operation.path = 完整 "/v1/images/generations" / "/v1/tasks/{{providerMeta.task_id}}"（带 /v1）

import type { HttpOperation } from "./types";

/** apimart 供应商种子（裸 baseUrl + bearer）。 */
export const APIMART_VENDOR_SEED = {
  key: "apimart",
  name: "APIMart",
  baseUrl: "https://api.apimart.ai",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** apimart 的 status 动词 → 我们的归一态（与 kie 不同：apimart 用 pending/processing/completed/...）。 */
export const APIMART_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["submitted", "pending", "queued"],
  running: ["processing", "running"],
  succeeded: ["completed", "succeeded", "success"],
  failed: ["failed", "cancelled", "error"],
};

/**
 * 图片轮询 op（所有 apimart 图片模型共用）。task_id 走路径参数（path 会被模板渲染，见
 * requestPipeline.ts:239）；结果在 data.result.images[0].url[0]（url 本身是数组，已核验）。
 */
export const APIMART_IMAGE_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    image_url: "data.result.images.0.url.0",
    error_message: "data.error.message",
  },
};

/**
 * 视频轮询 op（所有 apimart 视频模型共用）。视频结果 item 字段文档未给全，
 * 先按图片同构猜 data.result.videos.0.url.0，待 `apimart.mjs video` 真测定型后回填。
 */
export const APIMART_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    video_url: "data.result.videos.0.url.0",
    error_message: "data.error.message",
  },
};

/** create op 的公共片段：从 data[0].task_id 抽任务 id（数组下标，extractTaskId 的 explicitPath 支持）。 */
export const APIMART_CREATE_TASK_ID_PATH = "data.0.task_id" as const;
