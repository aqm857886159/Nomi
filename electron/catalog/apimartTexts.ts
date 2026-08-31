// apimart 文本模型（创作助手 / 拆镜头的「大脑」）的 curated 种子。
//
// 为什么需要它（Issue #9 根因）：创作助手是 agent，主控需要一个 kind="text" 的 LLM
// （electron/ai/agentChatV2.ts:chooseTextModel）。apimart 早期接入只播了图片/视频/音频生成
// 模型，没播文本模型，于是用户「接好 apimart、显示已连通」却在拆镜头时撞
// 「No local text model is configured」。修复 = 把 apimart 本就提供的 chat 大脑接出来。
//
// apimart 本身是 OpenAI 兼容 chat（R5 已核：https://docs.apimart.ai/en/api-reference/texts/general/chat-completions）：
//   POST /v1/chat/completions  { model, messages, ... }   ——同步、标准形状。
// 故文本模型**不需要 create/query mapping**：agent 走 electron/ai/vendorLanguageModel.ts 的
// buildLanguageModelForVendor（apimart 默认 providerKind=openai-compatible → baseURL=/v1 → AI SDK
// 自动补 /chat/completions）。catalog 只需一条 kind="text" 的 Model 记录，modelKey 即 chat model id。
//
// 默认大脑 = deepseek-v4-pro：apimart 真实 id、便宜、中文好、tool_use 可用（接入即验证见
// docs/plan/2026-06-19-text-brain-onboarding-gap.md 验收门 S2）。用户可在「模型设置」自行加别的
// 文本模型（gpt-5 / claude-opus-4-8 等），chooseTextModel 会把用户启用的一并纳入选择池。

import type { HttpOperation, ProfileKind } from "./types";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_STATUS_MAPPING } from "./apimartVendor";

/** 一个 apimart 文本模型的 curated 定义（modelKey = chat 或专用异步模型 id）。 */
export type ApimartTextModel = {
  modelKey: string;
  labelZh: string;
  meta?: Record<string, unknown>;
};

/** apimart 的 curated 文本模型（单源）。 */
export const APIMART_TEXT_MODELS: ApimartTextModel[] = [
  { modelKey: "deepseek-v4-pro", labelZh: "DeepSeek V4 Pro" },
  // Context-IR 不是 chat/completions 模型，而是视频族的异步提示词增强端点；标记能力避免
  // Agent 主控把它误当普通对话模型，仍可通过 prompt_refine profile 复用 Nomi 文本结果管线。
  { modelKey: "MiniMax-H3-Context-IR", labelZh: "MiniMax H3 · Context-IR 提示词增强", meta: { promptRefineOnly: true } },
];

const CONTEXT_IR_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/videos/generations",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{model.modelKey}}",
    prompt: "{{request.prompt}}",
    duration: "{{request.params.duration}}",
    aspect_ratio: "{{request.params.aspect_ratio}}",
    first_frame_image: "{{request.params.first_frame_image}}",
    last_frame_image: "{{request.params.last_frame_image}}",
    image_urls: "{{request.params.image_urls}}",
    video_urls: "{{request.params.video_urls}}",
    audio_urls: "{{request.params.audio_urls}}",
  },
  response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
  provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
  defaultParams: { duration: 5, aspect_ratio: "16:9" },
};

const CONTEXT_IR_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    text: "data.result.prompt",
    error_message: "data.error.message",
  },
};

export type ApimartTextMapping = {
  id: string;
  taskKind: ProfileKind;
  modelKey: string;
  name: string;
  create: HttpOperation;
  query: HttpOperation;
  statusMapping: Record<string, string[]>;
};

/** 需要专用异步 profile 的文本模型 mapping；普通 chat 大脑不造死 mapping。 */
export const APIMART_TEXT_MAPPINGS: ApimartTextMapping[] = [
  {
    id: "seed-apimart-minimax-h3-context-ir-prompt_refine",
    taskKind: "prompt_refine",
    modelKey: "MiniMax-H3-Context-IR",
    name: "MiniMax H3 · Context-IR 提示词增强",
    create: CONTEXT_IR_CREATE_OP,
    query: CONTEXT_IR_QUERY_OP,
    statusMapping: APIMART_STATUS_MAPPING,
  },
];
