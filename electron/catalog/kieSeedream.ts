// Seedream（字节）图像档案的**传输塑形**（curated 单源，仿 kieGptImage2/kieSeedance）。
// kie 文档（2026-06 实时核对）：
//   文生图 seedream/4.5-text-to-image：input {prompt, aspect_ratio(1:1默认/4:3/3:4/16:9/9:16/2:3/3:2/21:9),
//     quality(basic=2K / high=4K)}。
//   改图   bytedance/seedream-v4-edit：input {prompt, image_urls[≤10 输入图], image_size, image_resolution(1K/2K/4K),
//     max_images(1-6)}。
// 伞档案 `seedream` 靠 per-mode modelEnum 分流（body model 读 {{request.params.model}}）；两模式 taskKind
// 不同（text_to_image / image_edit），各带 modelKey=`seedream` 精确路由，与 GPT 同桶不撞（selectTaskMapping）。
// 结果路径与 Seedance/GPT 一致：data.resultJson.resultUrls.0（kie 统一）。

import type { HttpOperation, ProfileKind } from "./types";

const KIE_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["waiting", "queued", "pending"],
  running: ["generating", "processing", "running"],
  succeeded: ["success", "succeeded", "completed"],
  failed: ["fail", "failed", "error", "expired"],
};

export const SEEDREAM_QUERY_OP: HttpOperation = {
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

/** 文生图 createTask（seedream/4.5-text-to-image）。 */
export const SEEDREAM_T2I_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{request.params.model}}", // per-mode enum（伞档案分流）
    input: {
      prompt: "{{request.prompt}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      quality: "{{request.params.quality}}",
    },
  },
};

/** 改图 createTask（bytedance/seedream-v4-edit）：image_urls 取档案改图模式的输入图数组（slot inputKey=image_urls）。 */
export const SEEDREAM_EDIT_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      image_urls: "{{request.params.image_urls}}",
      image_size: "{{request.params.image_size}}",
      image_resolution: "{{request.params.image_resolution}}",
      max_images: "{{request.params.max_images}}",
    },
  },
};

export const SEEDREAM_MODEL_SEED = {
  modelKey: "seedream",
  labelZh: "Seedream 4.5",
  kind: "image" as const,
} as const;

export const SEEDREAM_T2I_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_image" as ProfileKind,
  modelKey: "seedream",
  name: "Seedream · 文生图",
  create: SEEDREAM_T2I_CREATE_OP,
  query: SEEDREAM_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};

export const SEEDREAM_EDIT_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_edit" as ProfileKind,
  modelKey: "seedream",
  name: "Seedream · 改图",
  create: SEEDREAM_EDIT_CREATE_OP,
  query: SEEDREAM_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};
