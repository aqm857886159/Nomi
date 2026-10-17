// HappyHorse 1.0 经 kie.ai 的 curated 传输契约（C4）。4 个端点合 1 个 catalog 条目，靠
// per-mode `model` enum 区分（评审 M3）—— body 的 model 取 `{{request.params.model}}`（来自档案
// 当前模式的 modelEnum，见 archetypeMeta.buildArchetypeInputParams），而非 catalog 行的 modelKey。
//
// 所有 HappyHorse 模式都打到同一个 kie createTask 端点，故只需 1 条 mapping（挂在 text_to_video
// 上，见 catalogTaskActions 的档案 taskKind 归一 + seedBuiltins）；kie 按 model enum 自己分流，
// 不靠我们的 taskKind。这样也避开和 Seedance 的 (kie, image_to_video) 撞车。
//
// **尾随空格键（§2 坑1）逐字符照抄**：`image_urls ` / `reference_image ` 文档里带尾随空格。
// 这是 kie 的表示 quirk，单源只此一处（M1）；档案侧只写逻辑键名（image_urls / reference_image）。

import type { HttpOperation, ProfileKind } from "./types";
import { ARCHETYPE_WIRE_MODEL } from "../shared/modelArchetypes/wireModelIdentity";

/** HappyHorse 模型种子（modelKey 是 catalog 基 id；真正发请求的 enum 由 per-mode modelEnum 覆盖）。 */
export const HAPPYHORSE_MODEL_SEED = {
  modelKey: "happyhorse",
  labelZh: "HappyHorse 1.0",
  kind: "video" as const,
} as const;

export const HAPPYHORSE_CREATE_OP: HttpOperation = {
  method: "POST",
  wireModel: ARCHETYPE_WIRE_MODEL, // 收档案所选的模式 / 变体线上名（wireModelIdentity）
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    // per-mode enum 覆盖（M3）：值来自 request.params.model（档案当前模式的 modelEnum）。
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      // 一条 body 覆盖 4 模式：renderer 只投影当前模式声明的键 → 别的模式的键渲染成 undefined 被丢弃（M2）。
      // image-to-video：image_urls[正好 1]；reference/edit：reference_image[N]；edit：video_url。
      "image_urls ": "{{request.params.image_urls}}",
      "reference_image ": "{{request.params.reference_image}}",
      video_url: "{{request.params.video_url}}",
      resolution: "{{request.params.resolution}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      duration: "{{request.params.duration}}",
      seed: "{{request.params.seed}}",
      audio_setting: "{{request.params.audio_setting}}",
    },
  },
};

/** 轮询：沿用已端到端验证过的 kie job 端点（与 Seedance 同，recordInfo）。 */
export const HAPPYHORSE_QUERY_OP: HttpOperation = {
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

/** (kie, text_to_video) 的 mapping 种子 —— 承载全部 HappyHorse 模式（kie 按 model enum 分流）。 */
export const HAPPYHORSE_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_video" as ProfileKind,
  name: "HappyHorse 1.0 · 全模式",
  create: HAPPYHORSE_CREATE_OP,
  query: HAPPYHORSE_QUERY_OP,
};
