import type { HttpOperation, ProfileKind } from "./types";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_STATUS_MAPPING } from "./apimartVendor";

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
// 默认大脑 = deepseek-v3.1-250821：使用 APIMart 官方文档当前列出的 DeepSeek V3.1 变体。
// 用户可在「模型设置」自行加别的
// 文本模型（gpt-5 / claude-opus-4-8 等），chooseTextModel 会把用户启用的一并纳入选择池。

/** 一个 apimart 文本模型的 curated 定义（无 archetype / 无 mapping；modelKey = chat model id）。 */
export type ApimartTextModel = {
  modelKey: string;
  labelZh: string;
  /** 合并进 Model.meta；`supportsImageInput` 供 chooseTextModel 的 imageInputRank 选型（显式声明优先于名字正则）。 */
  meta?: Record<string, unknown>;
};

/**
 * apimart 的 curated 文本模型（单源）。
 *
 * - `deepseek-v3.1-250821`：默认大脑，纯文本、中文创作与工具调用的主控入口。
 * - `gemini-3.5-flash`：**看得见的那个**。图进文字出（image_to_prompt）走它——浏览器「画面复刻/画面风格」
 *   提取、以及视频拆解读帧，都需要一个能读图的文本模型；deepseek 读不了图。
 *
 * R5 实测对账（2026-08-12，真 key 打 https://api.apimart.ai）：
 *   ✅ `gemini-3.5-flash` 在 OpenAI 兼容 `/v1/chat/completions` 上活着，且认 OpenAI 式
 *      `content:[{type:"image_url",image_url:{url:"data:image/jpeg;base64,…"}}]` 多模态 part
 *      → 无需新通道，直接吃现成的 streamTextTask（toImagePart 已处理 data: URL）。
 *   ❌ `gemini-3.0-flash` / `gemini-3-flash` 均 503 不可用——**别写这两个 id**（官方文档
 *      https://docs.apimart.ai/en/api-reference/texts/gemini/quickstart.md 列的是 3.5-flash / 3.1-pro-preview
 *      / 3-pro-preview / 2.5-pro；images 分区那些 "Gemini 3.1 Flash / Nano banana2" 是**生图**模型，别混）。
 *   ⚠️ 它是**思考型**模型：实测回「可用」两个字就烧掉 47 completion_tokens（先 thinking 再吐正文）。
 *      maxTokens 给小了 → 正文为空 + finishReason='length'，看着像"模型不行"其实是我们自己截断的
 *      （streamTextTask 已有该判别）。调用方按整段输出预算给足，别照文本模型的老经验给 200。
 *      单镜分镜提取实测：1178 token 进（图片占 1058）/ 1160 出 / 10.4s。
 */
export const APIMART_TEXT_MODELS: ApimartTextModel[] = [
  { modelKey: "deepseek-v3.1-250821", labelZh: "DeepSeek V3.1" },
  { modelKey: "gemini-3.5-flash", labelZh: "Gemini 3.5 Flash", meta: { supportsImageInput: true } },
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
