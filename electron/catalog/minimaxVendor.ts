// minimax（MiniMax 官方）供应商种子 —— 官方原生（非中转），两个接口：文本 MiniMax-M1 + 视频 MiniMax-H3。
// 端点契约（2026-08-29 用真 key 端到端核验，见 docs/plan/2026-08-29-minimax-vendor.md）：
//   文本  POST /v1/chat/completions  { model:"MiniMax-M1", messages:[...] }  —— OpenAI 兼容，走 buildLanguageModelForVendor 直连
//   视频  POST /v2/video_generation  { model:"MiniMax-H3", content:[{type:"text",text}], ... }  → { task_id }
//          GET  /v2/query/video_generation/{task_id}（路径参数）→ { task:{ id,status,content:{url} } }
//
// baseUrl/path 约定（避开 joinUrl 双前缀坑）：
//   vendor.baseUrl = "https://api.minimaxi.com"（**裸**，不带 /v1）
//   operation.path = 完整 "/v2/..."（带 /v2）；文本 baseURL = baseUrl + "/v1"（buildLanguageModelForVendor 对
//   openai-compatible 自动补，见 electron/ai/vendorLanguageModel.ts）。

import type { HttpOperation } from "./types";

/** MiniMax 供应商种子（裸 baseUrl + bearer）。 */
export const MINIMAX_VENDOR_SEED = {
  key: "minimax",
  name: "MiniMax",
  baseUrl: "https://api.minimaxi.com",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** MiniMax V2 的 status 动词 → 我们的归一态。 */
export const MINIMAX_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["pending", "queued", "submitted", "waiting"],
  running: ["running", "processing"],
  succeeded: ["succeeded", "success", "completed", "done"],
  failed: ["failed", "fail", "cancelled", "error"],
};

/** H3 视频轮询 op（V2：task_id 走**路径参数**；结果在 task.content.url）。 */
export const MINIMAX_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v2/query/video_generation/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "task.id",
    status: "task.status",
    video_url: "task.content.url",
    error_message: "task.error.message",
  },
};

/** create op 的公共片段：从顶层 task_id 抽任务 id（V2 创建响应扁平 {task_id}）。 */
export const MINIMAX_CREATE_TASK_ID_PATH = "task_id" as const;
