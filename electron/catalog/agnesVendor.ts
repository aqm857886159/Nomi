// Agnes AI（Sapiens AI，新加坡）供应商种子 —— 全模态 OpenAI 兼容网关，文本/图片/视频**无限期免费**
// （2026-06-01 起，免费层 RPM 20，邮箱注册不绑卡）。与 apimart 同构（curated 全模态 relay），
// 但形状有 AGNES 专属 quirk（已照官方文档核实：wiki.agnes-ai.com/en/docs/*.md + github.com/AgnesAI-Labs/Agnes-AI）：
//   文本  POST /v1/chat/completions   —— 标准 OpenAI 同步（无 mapping，走 buildLanguageModelForVendor）
//   图片  POST /v1/images/generations —— **同步** { created, data:[{ url | b64_json }] }（data.0.url）
//   视频  POST /v1/videos             —— **异步** { video_id, task_id, status:"queued" }
//   轮询  GET  /agnesapi?video_id=<ID> —— **不在 /v1 下，video_id 走 query 参数**（非路径）
//         → { status, remixed_from_video_id:<mp4 URL（status=completed 时）>, error }
//   status: queued | in_progress | completed | failed
//
// 两个必处理坑（live + mock 盯死）：
//   ① 轮询是 /agnesapi（非 /v1/...）+ query 参数 → 用 op.path="/agnesapi" + op.query.video_id。
//   ② 成品 mp4 URL 在 **remixed_from_video_id**（不是 video_url，官方文档自己写错）；此字段不在
//      runtime 防御式 extractAssetUrl 的兜底路径里 → 必须显式 response_mapping.video_url 取。
//
// baseUrl/path 约定（避 joinUrl 双前缀，见 apimartVendor.ts:12-14）：
//   vendor.baseUrl = "https://apihub.agnes-ai.com"（**裸**，不带 /v1）
//   op.path = 完整 "/v1/images/generations" / "/v1/videos"；轮询 "/agnesapi"（裸根，非 /v1）。

import type { HttpOperation } from "./types";

/** Agnes 供应商种子（裸 baseUrl + bearer；providerKind 缺省 openai-compatible，文本走 /v1/chat/completions）。 */
export const AGNES_VENDOR_SEED = {
  key: "agnes",
  name: "Agnes AI",
  baseUrl: "https://apihub.agnes-ai.com",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** AGNES status 动词 → 归一态。 */
export const AGNES_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["queued", "pending", "submitted"],
  running: ["in_progress", "processing", "running"],
  succeeded: ["completed", "succeeded", "success"],
  failed: ["failed", "error", "cancelled"],
};

/**
 * 视频轮询 op（所有 AGNES 视频模型共用）。video_id 走 **query 参数**（appendQueryParams 渲染）；
 * 成品 URL 在顶层 remixed_from_video_id（反常字段，必须显式映射，extractAssetUrl 兜底不到）。
 */
export const AGNES_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/agnesapi",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { video_id: "{{providerMeta.video_id}}" },
  response_mapping: {
    task_id: "video_id",
    status: "status",
    video_url: "remixed_from_video_id",
    error_message: "error",
  },
};
