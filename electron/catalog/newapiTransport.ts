// new-api 中转的图片/视频传输模板 + 标准参数（Issue #8）。单源：mapping body 引用的
// {{request.params.X}} 与下方 STANDARD_*_PARAMS 的 key 一一对应（改一处即同步，P1）。
//
// new-api 是开源中转软件，接口被软件固定（R5 已核 doc.newapi.pro / newapi.ai）：
//   图片  POST {base}/v1/images/generations  { model, prompt, size, quality, n, response_format }
//         → **同步** { created, data:[{ url | b64_json }] }
//   视频  POST {base}/v1/video/generations    { model, prompt, duration, size, image? }
//         → **异步** { task_id, status:"processing" }
//   轮询  GET  {base}/v1/video/generations/{task_id}
//         → { status:"succeeded"|"failed"|"processing", data:[{ url }] }
//
// 一个 new-api 适配器覆盖**所有自建 new-api 实例**（baseUrl 用户填，paths 固定）。
// baseUrl 裸（不带 /v1），op.path 自带 /v1（与 apimart/modelscope 同约定，避 joinUrl 双前缀）。
//
// 真实 vendor 字段细微差异（尤其视频轮询结果 url 路径文档没给全）由 runtime 的**防御式
// extractAssetUrl**（试 11 种路径含 data[0].url / videos[0].url / result.video_url）兜底 +
// issue reporter 跑 tests/transport-spike/newapi.mjs 探测确认。

import type { HttpOperation, ProfileKind } from "./types";

const JSON_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// new-api 状态动词 → 归一态。
export const NEWAPI_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["queued", "pending", "submitted", "not_start", "notstart"],
  running: ["processing", "running", "in_progress", "queueing"],
  succeeded: ["succeeded", "success", "completed", "done"],
  failed: ["failed", "fail", "error", "cancelled", "canceled", "timeout"],
};

// ── 图片：同步 create（无 query；create 返回即结果，buildProfileTaskResult 用 extractAssetUrl 取 data[0].url）──
export const NEWAPI_IMAGE_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/images/generations",
  headers: JSON_HEADERS,
  body: {
    model: "{{model.modelKey}}",
    prompt: "{{request.prompt}}",
    size: "{{request.params.size}}",
    quality: "{{request.params.quality}}",
    n: 1,
    response_format: "url",
  },
  response_mapping: { image_url: "data.0.url" },
};

// ── 视频：异步 create（返回 task_id 进轮询）──
export const NEWAPI_VIDEO_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/video/generations",
  headers: JSON_HEADERS,
  body: {
    model: "{{model.modelKey}}",
    prompt: "{{request.prompt}}",
    duration: "{{request.params.duration}}",
    size: "{{request.params.size}}",
    image: "{{request.params.image}}", // i2v 首帧链接（可选，未填模板丢弃）
  },
  response_mapping: { task_id: "task_id" },
  provider_meta_mapping: { task_id: "task_id" },
};

// ── 视频：轮询 query（task_id 走路径参数）──
export const NEWAPI_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/video/generations/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "task_id",
    status: "status",
    video_url: "data.0.url",
    error_message: "error.message",
  },
};

// ── 标准参数（落 model.meta.parameters，节点 UI 渲染；key 与上方 body 模板对齐）──
type ParamControl = {
  key: string;
  label: string;
  type: "select" | "number" | "text" | "boolean" | "image-url";
  options: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
};

const sel = (values: string[]) => values.map((value) => ({ value, label: value }));

export const NEWAPI_STANDARD_IMAGE_PARAMS: ParamControl[] = [
  { key: "size", label: "尺寸", type: "select", options: sel(["1024x1024", "1792x1024", "1024x1792"]), defaultValue: "1024x1024" },
  { key: "quality", label: "质量", type: "select", options: sel(["standard", "hd"]), defaultValue: "standard" },
];

export const NEWAPI_STANDARD_VIDEO_PARAMS: ParamControl[] = [
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 30, defaultValue: 5 },
  { key: "size", label: "比例 / 尺寸", type: "select", options: sel(["16:9", "9:16", "1:1", "1280x720", "720x1280"]), defaultValue: "16:9" },
  { key: "image", label: "首帧图(图生视频，可选)", type: "image-url", options: [] },
];

/** 一个 new-api 模型的传输配方（按 kind 取 create/query + taskKind）。 */
export function newapiTransportFor(kind: "image" | "video"): {
  taskKind: ProfileKind;
  create: HttpOperation;
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
  params: ParamControl[];
} {
  if (kind === "video") {
    return { taskKind: "text_to_video", create: NEWAPI_VIDEO_CREATE_OP, query: NEWAPI_VIDEO_QUERY_OP, statusMapping: NEWAPI_STATUS_MAPPING, params: NEWAPI_STANDARD_VIDEO_PARAMS };
  }
  return { taskKind: "text_to_image", create: NEWAPI_IMAGE_CREATE_OP, params: NEWAPI_STANDARD_IMAGE_PARAMS };
}
