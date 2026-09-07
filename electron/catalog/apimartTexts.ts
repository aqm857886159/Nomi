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
// 故文本模型**不需要 create/query mapping**：agent 走 electron/ai/vendorLanguageModel.ts 的
// buildLanguageModelForVendor（apimart 默认 providerKind=openai-compatible → baseURL=/v1 → AI SDK
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

/**
 * 价目取值的两条纪律（2026-09-07 定，落成注释是因为下一个填价的人会碰到同样的岔路）：
 *
 * ① **峰谷两价取高的那个。** DeepSeek 自 2026-08-16 起分时计价（峰：UTC 周一至周五
 *    01:00–04:00 与 06:00–10:00；其余为谷），而 pi 的 `Model.cost` 只有一个平价、没有时间维度
 *    （`pi-ai/dist/types.d.ts:712-715` 的 tiers 是按输入量分档，不是按时段）。二选一时取峰价：
 *    宁可高估也不低估——面板上一个偏高的金额只是保守，一个偏低的金额会让用户按它做决定。
 * ② **中转价查不到就记一手价。** APIMart 是中转，用户实际付的是 APIMart 的价，但它的公开文档
 *    （`https://docs.apimart.ai/en/api-reference/texts/general/chat-completions`，2026-09-07 实查）
 *    只列模型名、不列单价。所以这里记的是**模型一手厂商**的官网价，量级对得上、逐分未必对得上——
 *    这条限制写在这里，不许把它当成账单。
 */
const DEEPSEEK_PRICING_SOURCE = { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: "2026-09-07" } as const;

/**
 * apimart 的 curated 文本模型（单源）。DeepSeek IDs 来自 2026-08-21
 * 的 authenticated `/v1/models?expand=category&category=chat` 返回，并通过 chat + tool-call 探针。
 *
 * - `deepseek-v4-pro`：默认大脑，思考型纯文本与工具调用的主控入口。
 * - `deepseek-v4-flash`：低延迟回退，纯文本与工具调用。
 * - `deepseek-v3.2`：通用文本与工具调用回退。
 * - `deepseek-v3.1-terminus`：V3.1 终版文本与工具调用回退。
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
  {
    modelKey: "deepseek-v4-pro", labelZh: "DeepSeek V4 Pro",
    // 峰价：cache miss 输入 $1.32 / 输出 $3.96 / cache hit $0.044（谷价为其一半）。
    tokenPricing: { inputPerMTokUsd: 1.32, outputPerMTokUsd: 3.96, cacheReadPerMTokUsd: 0.044,
      source: DEEPSEEK_PRICING_SOURCE },
  },
  {
    modelKey: "deepseek-v4-flash", labelZh: "DeepSeek V4 Flash",
    // 峰价：cache miss 输入 $0.44 / 输出 $1.32 / cache hit $0.014（谷价为其一半）。
    tokenPricing: { inputPerMTokUsd: 0.44, outputPerMTokUsd: 1.32, cacheReadPerMTokUsd: 0.014,
      source: DEEPSEEK_PRICING_SOURCE },
  },
  // V3 两条**故意留白**：2026-09-07 实查 DeepSeek 官方定价页，表里只有 v4-flash / v4-pro /
  // v4-flash-vision-exp 三行，V3.2 与 V3.1-terminus 一个字都没有。查不到就不填——
  // 编一个「大概和 flash 差不多」的数字，面板上会印出一个看起来很确定的金额。
  // 它们在运行时落到「花费不可知」那一态，并登记在 scripts/archetype-sources-baseline.json 的棘轮里。
  { modelKey: "deepseek-v3.2", labelZh: "DeepSeek V3.2" },
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
