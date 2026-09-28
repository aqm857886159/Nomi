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
  // APIMart 是唯一 code-owned、已发布契约的直连 vendor（见 builtinVendorSeeds.ts VendorSeed.credentialMode
  // 注释）——凭据经内置 Settings 卡直接生效，不走认证晋升。缺此字段则 isBuiltinDirectKeyVendor 恒 false、
  // assertDirectKeyContract 早退，认证占用守卫（cert-owned 连接必须走其认证传输）就哑火。
  credentialMode: "direct-key" as const,
  /**
   * 每周雷达的逐模型存活探针（`scripts/model-liveness.ts` 专用，一个模型一次、刻意付费）。
   * **不要**拿它验 key —— 那是下面的 `credentialProbe`；2026-09-22 之前两者共用这一个字段，
   * 于是用户点一次「保存验证」就替他跑了一遍这条付费探针（T-MO-10、09-11 群反馈）。
   */
  livenessProbe: {
    request: { method: "POST", path: "/api/v1/chat/completions", body: { model: "{{model}}", messages: [{ role: "user", content: "Hi" }], max_tokens: 1, stream: false } },
    successPath: "choices.0",
    source: { url: "https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream.md", checkedAt: "2026-09-08" },
  },
  /**
   * **免费**的 key 有效性探测：`GET /v1/balance`（查这把 token 的剩余/已用额度）。
   *
   * 实测对照组（2026-09-22，只发 GET、不生成）：
   *   · 假 key    → HTTP 401 `{"error":{"message":"invalid API key",...,"type":"apimart_error"}}`
   *   · 不带鉴权  → HTTP 401 同上
   * 即它**按 key 判**（不是 apimart 全站对 `/v1/models` 恒 401 的那种无差别拒绝），
   * 所以 401/403 → key 无效这条判据在这个端点上成立。
   *
   * 成功判据取 `remain_balance`：文档说 `message` 只在失败时出现，`remain_balance` 只在
   * 成功时给；无限额度时它是 `-1`（仍非 null，照样判 verified）。
   */
  credentialProbe: {
    request: { method: "GET", path: "/v1/balance" },
    successPath: "remain_balance",
    cost: "free" as const,
    source: { url: "https://docs.apimart.ai/en/api-reference/account/token-balance.md", checkedAt: "2026-09-22" },
  },
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
 * requestPipeline.ts:239）；结果通常在 data.result.images[0].url；旧响应里 url 是数组，新响应里也有
 * 直接返回字符串的情况，所以映射保留两个候选路径，不能把 `.url.0` 写死。
 */
export const APIMART_IMAGE_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    image_url: ["data.result.images.0.url.0", "data.result.images.0.url"],
    error_message: "data.error.message",
  },
};

/**
 * 视频轮询 op（所有 apimart 视频模型共用）。结果通常在 data.result.videos[0].url；旧响应里 url 是数组，
 * 新响应里也有直接返回字符串的情况，所以与图片一样保留两个候选路径。
 */
export const APIMART_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    video_url: ["data.result.videos.0.url.0", "data.result.videos.0.url"],
    error_message: "data.error.message",
  },
};

/** create op 的公共片段：从 data[0].task_id 抽任务 id（数组下标，extractTaskId 的 explicitPath 支持）。 */
export const APIMART_CREATE_TASK_ID_PATH = "data.0.task_id" as const;
