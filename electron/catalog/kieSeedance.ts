// 内置「模型档案」的**传输塑形**那一半（评审 CTO/M1：单一真相源）。
// 这是 Seedance 2.0 经 kie.ai 的 curated 接入定义 —— 不靠 onboarding 逐份解析文档，
// 主流模型用我们精心写好的这份；长尾模型才回退 onboarding（见
// docs/plan/2026-06-05-model-archetype-seedance-happyhorse.md，C1 薄垂直片）。
//
// 约定（关键，避开 joinUrl 的双前缀坑 —— 见 electron/ai/requestPipeline.ts joinUrl，
// 以及该文件 .test.ts 的实际约定）：
//   vendor.baseUrl = "https://api.kie.ai"（**裸**，不带 /api/v1）
//   operation.path = 完整 "/api/v1/jobs/..."（带 /api/v1）
// 这样 joinUrl(base, path) = https://api.kie.ai/api/v1/jobs/...，不会拼成
// ".../api/v1/api/v1/..."。Kling 试装 fixture 里 baseUrl 写成 ".../api/v1" + path 也带
// "/api/v1" 是会出双前缀的反例，**不要照抄**。
//
// 本轮（C1）只覆盖 Seedance「首帧」(image_to_video) 这一条，验证传输打通；
// 首尾帧 / 全能参考 / HappyHorse 在后续 chunk 增量加。

import type { HttpOperation, ProfileKind } from "./types";

/** kie.ai 供应商种子（裸 baseUrl + bearer）。 */
export const KIE_VENDOR_SEED = {
  key: "kie",
  name: "Kie.ai",
  baseUrl: "https://api.kie.ai",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** Seedance 2.0 模型种子（modelKey 直接就是 kie 要的 model enum，故 body 用 {{model.modelKey}} 即可，无需 per-mode 覆盖）。 */
export const SEEDANCE_2_MODEL_SEED = {
  modelKey: "bytedance/seedance-2",
  labelZh: "Seedance 2.0",
  kind: "video" as const,
} as const;

/** Seedance 2.0 Fast 模型种子。与 2.0 同形、**复用同一条 (kie, image_to_video) mapping**——
 *  body 的 {{model.modelKey}} 自动取到 fast 的 enum。只是 catalog 多一行 + 档案多一份（480/720 清晰度）。 */
export const SEEDANCE_2_FAST_MODEL_SEED = {
  modelKey: "bytedance/seedance-2-fast",
  labelZh: "Seedance 2.0 Fast",
  kind: "video" as const,
} as const;

/**
 * createTask 操作（首帧 / image_to_video）。
 * body 是 kie 的 `{ model, input: {...} }` 嵌套形状；模板引擎对「整串就是一个 {{}}」
 * 的值做原样透传（数组/对象不被 stringify），见 requestPipeline.renderTemplateValue。
 */
export const SEEDANCE_2_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    model: "{{model.modelKey}}",
    input: {
      prompt: "{{request.prompt}}",
      // 一条 body 覆盖三模式：模板引擎对值为 undefined 的键整键丢弃（requestPipeline.renderTemplateValue），
      // 而 catalogTaskActions 已按「当前模式」把别的模式的参考键投影掉 → 这里非当前模式的键自然不进 body（M2 互斥）。
      first_frame_url: "{{request.params.first_frame_url}}",
      last_frame_url: "{{request.params.last_frame_url}}",
      // 全能参考（omni）数组键。**输出键逐字符照抄 kie 文档（§2 坑1）**：
      // reference_image_urls / reference_audio_urls 无尾随空格；reference_video_urls **带一个尾随空格**。
      // 这是 kie 专属的 input 键，单源只此一处（M1）；值取自供应商无关的通用 snake 参数。
      reference_image_urls: "{{request.params.reference_image_urls}}",
      "reference_video_urls ": "{{request.params.reference_video_urls}}",
      reference_audio_urls: "{{request.params.reference_audio_urls}}",
      resolution: "{{request.params.resolution}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      duration: "{{request.params.duration}}",
      generate_audio: "{{request.params.generate_audio}}",
    },
  },
};

/**
 * 轮询操作。沿用已端到端验证过的 kie job 端点 `/api/v1/jobs/recordInfo`
 * （Kling 3.0 试装即用此端点；docs 另写的 /market/common/get-task-detail 未经我们实测，
 * 故先用 recordInfo，待一次真实生成核对后再决定是否切换）。
 */
export const SEEDANCE_2_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/jobs/recordInfo",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.state",
    video_url: "data.resultJson.resultUrls.0",
    error_message: "data.failMsg",
  },
};

/** (kie, image_to_video) 的完整 mapping 种子。 */
export const SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_to_video" as ProfileKind,
  name: "Seedance 2.0 · 首帧",
  create: SEEDANCE_2_CREATE_OP,
  query: SEEDANCE_2_QUERY_OP,
};
