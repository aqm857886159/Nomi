import type { HttpOperation, Model, ProfileKind } from "./types";
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
// 故文本模型**不需要 create/query mapping**：Agent 与文本任务都走 electron/ai/vendorModelConnection.ts 的
// nomiModelConfigFor（apimart 默认 providerKind=openai-compatible → baseURL=/v1 → pi-ai 的 openai-completions
// 自动补 /chat/completions）。catalog 只需一条 kind="text" 的 Model 记录，modelKey 即 chat model id。
//
// 默认大脑 = deepseek-v4-pro：2026-08-21 用已配置 key 调 APIMart 官方
// GET /v1/models?expand=category&category=chat 对账，并逐个以 chat + tool-call 探针确认。
// 用户可在「模型设置」自行加别的文本模型（gpt-5 / claude-opus-4-8 等），chooseTextModel
// 会把用户启用的一并纳入选择池。

/** 一个 apimart 文本模型的 curated 定义（无 archetype / 无 mapping；modelKey = chat model id）。 */
export type ApimartTextModel = {
  modelKey: string;
  labelZh: string;
  /** 合并进 Model.meta；`supportsImageInput` 供 chooseTextModel 的 imageInputRank 选型（显式声明优先于名字正则）。 */
  meta?: Record<string, unknown>;
  /** 按 token 计费的价目（USD / 每百万 token）。见 `Model.tokenPricing`。 */
  tokenPricing?: Model["tokenPricing"];
  /** 显式不按 token 计费。 */
  free?: true;
};

// Public APIMart prices checked 2026-11-07. The current tokenPricing shape has one rate,
// so use the highest published tier (including cache lifetime) rather than underquoting long requests.
// These are conservative estimates; membership, time discounts and the task receipt remain authoritative.
const APIMART_PRICING_SOURCE = { url: "https://api.apimart.ai/api/pricing/models/all", checkedAt: "2026-11-07" } as const;

export const APIMART_TEXT_MODELS: ApimartTextModel[] = [
  {
    modelKey: "gpt-6-astra", labelZh: "GPT-6 Astra",
    tokenPricing: { inputPerMTokUsd: 16.0, outputPerMTokUsd: 60.0, cacheReadPerMTokUsd: 1.6, cacheWritePerMTokUsd: 40.0, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "gpt-6.1-sol", labelZh: "GPT-6.1 Sol",
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 12.0, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 8.0, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "gpt-6.1-terra", labelZh: "GPT-6.1 Terra",
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 6.0, cacheReadPerMTokUsd: 0.08, cacheWritePerMTokUsd: 4.0, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "gpt-6-luna", labelZh: "GPT-6 Luna",
    tokenPricing: { inputPerMTokUsd: 0.16, outputPerMTokUsd: 0.6, cacheReadPerMTokUsd: 0.016, cacheWritePerMTokUsd: 0.4, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "claude-opus-5-5", labelZh: "Claude Opus 5.5",
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 16, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 6.4, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "claude-sonnet-5-5", labelZh: "Claude Sonnet 5.5",
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 8, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 3.2, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "claude-haiku-5-5", labelZh: "Claude Haiku 5.5",
    tokenPricing: { inputPerMTokUsd: 0.4, outputPerMTokUsd: 2.0, cacheReadPerMTokUsd: 0.04, cacheWritePerMTokUsd: 0.8, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "claude-fable-5.1", labelZh: "Claude Fable 5.1",
    tokenPricing: { inputPerMTokUsd: 8, outputPerMTokUsd: 40, cacheReadPerMTokUsd: 0.2, cacheWritePerMTokUsd: 16, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "gemini-4-argon", labelZh: "Gemini 4 Argon", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 8, cacheReadPerMTokUsd: 0.08, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "gemini-3.8-flash", labelZh: "Gemini 3.8 Flash", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 0.6, outputPerMTokUsd: 3, cacheReadPerMTokUsd: 0.06, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "deepseek-v4-pro", labelZh: "DeepSeek V4 Pro",
    tokenPricing: { inputPerMTokUsd: 1.0285712, outputPerMTokUsd: 3.0857144, cacheReadPerMTokUsd: 0.0514284, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "deepseek-v4.1-flash", labelZh: "DeepSeek V4.1 Flash",
    tokenPricing: { inputPerMTokUsd: 0.2285712, outputPerMTokUsd: 0.9142856, cacheReadPerMTokUsd: 0.0114284, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "qwen3.8-max-0902", labelZh: "Qwen 3.8 Max 0902",
    tokenPricing: { inputPerMTokUsd: 1.3714288, outputPerMTokUsd: 4.1142856, cacheReadPerMTokUsd: 0.1714288, cacheWritePerMTokUsd: 1.7142856, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "qwen3.8-flash", labelZh: "Qwen 3.8 Flash",
    tokenPricing: { inputPerMTokUsd: 0.0914288, outputPerMTokUsd: 0.3085712, cacheReadPerMTokUsd: 0.0114288, cacheWritePerMTokUsd: 0.1428568, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "qwen3.8-27b", labelZh: "Qwen 3.8 27B",
    tokenPricing: { inputPerMTokUsd: 0.3428568, outputPerMTokUsd: 1.3714288, cacheReadPerMTokUsd: 0.0685712, cacheWritePerMTokUsd: 0.4285712, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "qwen3.8-2.4t-a95b", labelZh: "Qwen 3.8 2.4T A95B",
    tokenPricing: { inputPerMTokUsd: 1.3714288, outputPerMTokUsd: 4.1142856, cacheReadPerMTokUsd: 0.1714288, cacheWritePerMTokUsd: 1.7142856, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "glm-5.3", labelZh: "GLM 5.3",
    tokenPricing: { inputPerMTokUsd: 1.12, outputPerMTokUsd: 3.52, cacheReadPerMTokUsd: 0.208, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "glm-5.3-flash", labelZh: "GLM 5.3 Flash",
    tokenPricing: { inputPerMTokUsd: 0.06, outputPerMTokUsd: 0.2, cacheReadPerMTokUsd: 0.012, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "kimi-k3", labelZh: "Kimi K3",
    tokenPricing: { inputPerMTokUsd: 2.4, outputPerMTokUsd: 12, cacheReadPerMTokUsd: 0.24, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "grok-4.7", labelZh: "Grok 4.7",
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 9.6, cacheReadPerMTokUsd: 0.8, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "minimax-m3", labelZh: "MiniMax M3",
    tokenPricing: { inputPerMTokUsd: 0.24, outputPerMTokUsd: 0.96, source: APIMART_PRICING_SOURCE },
  },
  {
    modelKey: "step-3.7-flash", labelZh: "Step 3.7 Flash",
    tokenPricing: { inputPerMTokUsd: 0.15424, outputPerMTokUsd: 0.92544, source: APIMART_PRICING_SOURCE },
  },
  // Saved legacy identities remain executable; lifecycle policy only changes recommendation order.
  {
    modelKey: "deepseek-v4-flash", labelZh: "DeepSeek V4 Flash",
    // 峰价：cache miss 输入 $0.44 / 输出 $1.32 / cache hit $0.014（谷价为其一半）。
    tokenPricing: { inputPerMTokUsd: 0.44, outputPerMTokUsd: 1.32, cacheReadPerMTokUsd: 0.014,
      source: { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: "2026-09-07" } },
  },
  // V3.1-terminus **故意留白**：2026-09-07 实查 DeepSeek 官方定价页，表里只有 v4-flash / v4-pro /
  // v4-flash-vision-exp 三行，V3 系列一个字都没有。查不到就不填——
  // 编一个「大概和 flash 差不多」的数字，面板上会印出一个看起来很确定的金额。
  // 它在运行时落到「花费不可知」那一态。
  { modelKey: "deepseek-v3.1-terminus", labelZh: "DeepSeek V3.1 Terminus" },
  {
    modelKey: "gemini-3.5-flash", labelZh: "Gemini 3.5 Flash", meta: { supportsImageInput: true },
    // Google 付费档：输入 $1.50 / 输出 $9.00（含 thinking token）/ 上下文缓存读 $0.15。
    tokenPricing: { inputPerMTokUsd: 1.5, outputPerMTokUsd: 9, cacheReadPerMTokUsd: 0.15,
      source: { url: "https://ai.google.dev/gemini-api/docs/pricing", checkedAt: "2026-09-07" } },
  },
  // Context-IR 不是 chat 模型：它走 /v1/videos/generations 的异步任务，`textBrainResolver`
  // 的 `isPromptRefineOnlyModel` 明确把它挡在 Agent 主控之外（electron/ai/textBrainResolver.ts:26-31）。
  // 不按 token 计费也不是「免费」，所以两个字段都不声明——价目门岗按同一个生产判据豁免它。
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
