// Nano Banana（Google/Gemini 影像）图像档案的**传输塑形**（curated 单源，仿 kieSeedream）。
// kie 文档（2026-06 实时核对）：
//   文生图 google/nano-banana：input {prompt, output_format(png/jpeg), aspect_ratio(1:1默认…/auto)}。
//   改图   google/nano-banana-edit：input {prompt, image_urls[≤10 输入图], output_format, aspect_ratio}。
// 伞档案 `nano-banana` 靠 per-mode modelEnum 分流；两模式 taskKind 不同，各带 modelKey=`nano-banana`
// 精确路由（与 GPT/Seedream 同桶不撞，selectTaskMapping）。结果路径 data.resultJson.resultUrls.0（kie 统一）。

import type { HttpOperation, ProfileKind } from "./types";

const KIE_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["waiting", "queuing", "queued", "pending"],
  running: ["generating", "processing", "running"],
  succeeded: ["success", "succeeded", "completed"],
  failed: ["fail", "failed", "error", "expired"],
};

export const NANO_BANANA_QUERY_OP: HttpOperation = {
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

export const NANO_BANANA_T2I_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      output_format: "{{request.params.output_format}}",
    },
  },
};

export const NANO_BANANA_EDIT_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      image_urls: "{{request.params.image_urls}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      output_format: "{{request.params.output_format}}",
    },
  },
};

export const NANO_BANANA_MODEL_SEED = {
  modelKey: "nano-banana",
  labelZh: "Nano Banana",
  kind: "image" as const,
} as const;

export const NANO_BANANA_T2I_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_image" as ProfileKind,
  modelKey: "nano-banana",
  name: "Nano Banana · 文生图",
  create: NANO_BANANA_T2I_CREATE_OP,
  query: NANO_BANANA_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};

export const NANO_BANANA_EDIT_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_edit" as ProfileKind,
  modelKey: "nano-banana",
  name: "Nano Banana · 改图",
  create: NANO_BANANA_EDIT_CREATE_OP,
  query: NANO_BANANA_QUERY_OP,
  statusMapping: KIE_STATUS_MAPPING,
};
