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

/**
 * 一条文字声明凭什么写（2026-11-07 按官方文档对齐定，见设计卡 docs/plan/2026-11-07-catalog-audio-text.md「按官方文档对齐」）。
 *
 * 口径（通用协议模型）：**协议页给依据，模型列表 + 真调用给封印。** APIMart 的文字模型都走通用 OpenAI 协议，
 * 官方只给协议页和 `/v1/models` 列表接口，不逐个出模型页；所以「文档出处」认协议页，「能不能调」只认真调用——
 * 列表里有 ≠ 能调（`deepseek-v3.2` 列着却确定性 404），价目里有也 ≠ 能调。字段必填：新加一条声明就得写清这几样。
 */
export type ApimartTextEvidence = {
  /** 我们发请求走的那一份通用协议页。 */
  protocolDoc: string;
  /** 模型 id 在官方文档里逐字出现的那一页（有才写；id 的写法以它为准）。 */
  modelDoc?: string;
  /** 公开价目接口（不用 Key）；`tokenPricing` 的数按它的有效值取，取法见 `APIMART_TEXT_PRICING_RULE`。 */
  pricingApi: string;
  /** 是否已真跑：「未」，或有记录的那次真调用（日期 + 记录在哪）。 */
  liveCall: "未" | { checkedAt: string; record: string };
  /** 读图声明的出处：`meta.supportsImageInput: true` 必须带它（契约测试守）。`/v1/models` 的 Vision 标签或一次带图真调用才算。 */
  imageInput?: { checkedAt: string; record: string };
};

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
  /** 这条声明凭什么写。只在代码里，不进目录记录（seedBuiltins 按字段挑着播）。 */
  evidence: ApimartTextEvidence;
};

/**
 * 价目取值（2026-11-07 起统一按 APIMart 公开价目接口；以前「中转价查不到就记一手厂商价」那条作废——
 * 现在中转价查得到，用户付的就是它）：
 *   有效值 = 列表价 `rates` × `price_factor`（现在是 0.8），就是接口里 `effective_rates` 的算法；
 *   ① 按输入量分档（`tiers[]`）取最高档：`Model.tokenPricing` 只有一个价，宁可高估长请求，不低估；
 *   ② 峰谷分时取峰价，理由同上（2026-09-07 定的老纪律：面板上偏高只是保守，偏低会让用户按它做决定）；
 *   ③ 缓存读取有隐式 / 显式两价时取高的；缓存写入有 5 分钟 / 1 小时两价时取 1 小时那个；
 *   ④ 接口里整个没有的字段 = 不适用，不填（缓存读取缺省按输入价算）。
 * 契约测试（apimartLatestContracts.test.ts）按同一条规则从接口原始快照重算，和这里逐项对。会员档、
 * 分时折扣、真实扣费以 APIMart 账单为准，这里只是保守估计，不许当成账单。
 */
export const APIMART_TEXT_PRICING_RULE = "rates × price_factor；分档取最高档；峰谷取峰；缓存读取取高、缓存写入取 1 小时" as const;

const PRICING_CHECKED_AT = "2026-11-07";
const CHAT_PROTOCOL_DOC = "https://docs.apimart.ai/en/api-reference/texts/general/chat-completions";
export const apimartTextPricingApi = (modelKey: string) =>
  `https://api.apimart.ai/api/pricing/model?model=${encodeURIComponent(modelKey)}`;
const pricingSource = (modelKey: string) => ({ url: apimartTextPricingApi(modelKey), checkedAt: PRICING_CHECKED_AT });
/** 只有协议页 + 价目、还没真跑过的那一类（这次新加的都是）。 */
const unrun = (modelKey: string, modelDoc?: string): ApimartTextEvidence => ({
  protocolDoc: CHAT_PROTOCOL_DOC,
  ...(modelDoc ? { modelDoc } : {}),
  pricingApi: apimartTextPricingApi(modelKey),
  liveCall: "未",
});
/** 2026-08-21 真 key 对账 + 逐个 chat、tool-call 探针（见文件头），之后一直是付费走查的缺省大脑一族。 */
const DEEPSEEK_PROBED_0821 = {
  checkedAt: "2026-08-21",
  record: "本文件头：/v1/models?expand=category&category=chat 对账 + 逐个 chat、tool-call 探针",
} as const;
/** 2026-11-08 一问一个（tests/ux/apimart-text-brains-real.paid.mjs，走 Agent 主进程大脑路，每个只问一次、不重试）。逐条结果在设计卡。 */
const ASKED_20261108 = {
  checkedAt: "2026-11-08",
  record: "docs/plan/2026-11-07-catalog-audio-text.md「一问一个结果（2026-11-08）」",
} as const;
/** 同一次里带一张暗号图再问一次，模型完整回出了暗号。 */
const SAW_IMAGE_20261108 = {
  checkedAt: "2026-11-08",
  record: "docs/plan/2026-11-07-catalog-audio-text.md「一问一个结果（2026-11-08）」：带暗号图问一次，完整回出暗号",
} as const;
/** 协议页 + 价目 + 2026-11-08 真调用通过；`sawImage` = 同一次带图也读出来了。 */
const asked = (modelKey: string, modelDoc?: string, sawImage?: "sawImage"): ApimartTextEvidence => ({
  ...unrun(modelKey, modelDoc),
  liveCall: ASKED_20261108,
  ...(sawImage ? { imageInput: SAW_IMAGE_20261108 } : {}),
});

/**
 * apimart 的 curated 文本模型（单源）。
 *
 * - `deepseek-v4-pro`：默认大脑，思考型纯文本与工具调用的主控入口。
 * - `deepseek-v4-flash`：低延迟回退，纯文本与工具调用。
 * - `deepseek-v3.1-terminus`：V3.1 终版文本与工具调用回退。2026-11-07：文档和全量价目表都查不到它，
 *   单模型价目接口只回一条旧倍率价（像 `deepseek-v3.2` 那样的残留）；价格照旧留白。2026-11-08 一问一个
 *   （tests/ux/apimart-text-brains-real.paid.mjs）回 503 `model_not_found`，`/v1/models` 列表里也没有它：
 *   按退役处理，走 seedBuiltins 的退役清单（有老用户，要迁移，另开 PR，计划表登记）。
 *
 * `deepseek-v3.2` 2026-10-27 下架：APIMart 的 `/v1/models` 仍列着它，调用却确定性 404 `model_not_found`
 * （10-18 付费走查实录）。退役清单与存量迁移见 seedBuiltins.ts 的 `RETIRED_APIMART_TEXT_MODEL_KEYS`。
 * - `gemini-3.5-flash`：**看得见的那个**。图进文字出（image_to_prompt）走它——浏览器「画面复刻/画面风格」
 *   提取、以及视频拆解读帧，都需要一个能读图的文本模型；deepseek 读不了图。
 *
 * R5 实测对账（2026-08-12，真 key 打 https://api.apimart.ai）：
 *   ✅ `gemini-3.5-flash` 在 OpenAI 兼容 `/v1/chat/completions` 上活着，且认 OpenAI 式
 *      `content:[{type:"image_url",image_url:{url:"data:image/jpeg;base64,…"}}]` 多模态 part
 *      → 无需新通道，直接吃现成的文本任务执行器（electron/textTaskRunner.ts；图片经 modelImageInput 内联）。
 *   ❌ `gemini-3.0-flash` / `gemini-3-flash` 均 503 不可用——**别写这两个 id**（官方文档
 *      https://docs.apimart.ai/en/api-reference/texts/gemini/quickstart.md 列的是 3.5-flash / 3.1-pro-preview
 *      / 3-pro-preview / 2.5-pro；images 分区那些 "Gemini 3.1 Flash / Nano banana2" 是**生图**模型，别混）。
 *   ⚠️ 它是**思考型**模型：实测回「可用」两个字就烧掉 47 completion_tokens（先 thinking 再吐正文）。
 *      maxTokens 给小了 → 正文为空 + finishReason='length'，看着像"模型不行"其实是我们自己截断的
 *      （文本任务把 finishReason 带回调用方，能分清这两种空）。调用方按整段输出预算给足，别照文本模型的老经验给 200。
 *      单镜分镜提取实测：1178 token 进（图片占 1058）/ 1160 出 / 10.4s。
 *
 * 2026-11-07 新加的这一批（GPT-6 / Claude 5.5 / Gemini 4 / Qwen 3.8 / GLM 5.3 / Kimi K3 / Grok 4.7 / MiniMax M3 / Step 3.7）：
 * 依据是协议页 + 价目接口；2026-11-08 一问一个真调用：除 `claude-fable-5.1` 外都调通（它两次 402：没带输出上限时
 * APIMart 按最长输出预扣 $40，超过余额；等文本大脑总发输出上限后再问）；带暗号图问一次、完整回出暗号的 6 个
 * （Claude Opus / Sonnet / Haiku 5.5、Gemini 4 Argon、Gemini 3.8 Flash、DeepSeek V4.1 Flash）加回读图声明，
 * 其余不写读图。`qwen3.8-max` 照官方专页的写法
 * （texts/qwen3.8-max/guide），不用价目表里另挂的 `-0902`。合入前跑一遍免费的 `/v1/models` 对账
 * （tests/ux/apimart-text-list.real.mjs）和付费一问一个，调不通的在同一个 PR 里删（新加的，没有老用户）。
 */
export const APIMART_TEXT_MODELS: ApimartTextModel[] = [
  {
    modelKey: "gpt-6-astra", labelZh: "GPT-6 Astra",
    tokenPricing: { inputPerMTokUsd: 16.0, outputPerMTokUsd: 60.0, cacheReadPerMTokUsd: 1.6, cacheWritePerMTokUsd: 40.0, source: pricingSource("gpt-6-astra") },
    evidence: asked("gpt-6-astra"),
  },
  {
    modelKey: "gpt-6.1-sol", labelZh: "GPT-6.1 Sol",
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 12.0, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 8.0, source: pricingSource("gpt-6.1-sol") },
    evidence: asked("gpt-6.1-sol"),
  },
  {
    modelKey: "gpt-6.1-terra", labelZh: "GPT-6.1 Terra",
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 6.0, cacheReadPerMTokUsd: 0.08, cacheWritePerMTokUsd: 4.0, source: pricingSource("gpt-6.1-terra") },
    evidence: asked("gpt-6.1-terra", "https://docs.apimart.ai/en/api-reference/texts/openai/context-cache"),
  },
  {
    modelKey: "gpt-6-luna", labelZh: "GPT-6 Luna",
    tokenPricing: { inputPerMTokUsd: 0.16, outputPerMTokUsd: 0.6, cacheReadPerMTokUsd: 0.016, cacheWritePerMTokUsd: 0.4, source: pricingSource("gpt-6-luna") },
    evidence: asked("gpt-6-luna"),
  },
  {
    modelKey: "claude-opus-5-5", labelZh: "Claude Opus 5.5", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 16, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 6.4, source: pricingSource("claude-opus-5-5") },
    evidence: asked("claude-opus-5-5", undefined, "sawImage"),
  },
  {
    modelKey: "claude-sonnet-5-5", labelZh: "Claude Sonnet 5.5", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 8, cacheReadPerMTokUsd: 0.16, cacheWritePerMTokUsd: 3.2, source: pricingSource("claude-sonnet-5-5") },
    evidence: asked("claude-sonnet-5-5", undefined, "sawImage"),
  },
  {
    modelKey: "claude-haiku-5-5", labelZh: "Claude Haiku 5.5", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 0.4, outputPerMTokUsd: 2.0, cacheReadPerMTokUsd: 0.04, cacheWritePerMTokUsd: 0.8, source: pricingSource("claude-haiku-5-5") },
    evidence: asked("claude-haiku-5-5", undefined, "sawImage"),
  },
  {
    modelKey: "claude-fable-5.1", labelZh: "Claude Fable 5.1",
    tokenPricing: { inputPerMTokUsd: 8, outputPerMTokUsd: 40, cacheReadPerMTokUsd: 0.2, cacheWritePerMTokUsd: 16, source: pricingSource("claude-fable-5.1") },
    evidence: unrun("claude-fable-5.1"),
  },
  {
    modelKey: "gemini-4-argon", labelZh: "Gemini 4 Argon", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 1.6, outputPerMTokUsd: 8, cacheReadPerMTokUsd: 0.08, source: pricingSource("gemini-4-argon") },
    evidence: asked("gemini-4-argon", undefined, "sawImage"),
  },
  {
    modelKey: "gemini-3.8-flash", labelZh: "Gemini 3.8 Flash", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 0.6, outputPerMTokUsd: 3, cacheReadPerMTokUsd: 0.06, source: pricingSource("gemini-3.8-flash") },
    evidence: asked("gemini-3.8-flash", undefined, "sawImage"),
  },
  {
    modelKey: "deepseek-v4-pro", labelZh: "DeepSeek V4 Pro",
    tokenPricing: { inputPerMTokUsd: 1.0285712, outputPerMTokUsd: 3.0857144, cacheReadPerMTokUsd: 0.1028568, source: pricingSource("deepseek-v4-pro") },
    evidence: { protocolDoc: CHAT_PROTOCOL_DOC, modelDoc: CHAT_PROTOCOL_DOC, pricingApi: apimartTextPricingApi("deepseek-v4-pro"), liveCall: DEEPSEEK_PROBED_0821 },
  },
  {
    modelKey: "deepseek-v4.1-flash", labelZh: "DeepSeek V4.1 Flash", meta: { supportsImageInput: true },
    tokenPricing: { inputPerMTokUsd: 0.2285712, outputPerMTokUsd: 0.9142856, cacheReadPerMTokUsd: 0.0228568, source: pricingSource("deepseek-v4.1-flash") },
    evidence: asked("deepseek-v4.1-flash", undefined, "sawImage"),
  },
  {
    modelKey: "qwen3.8-max", labelZh: "Qwen 3.8 Max",
    tokenPricing: { inputPerMTokUsd: 1.3714288, outputPerMTokUsd: 4.1142856, cacheReadPerMTokUsd: 0.1714288, cacheWritePerMTokUsd: 1.7142856, source: pricingSource("qwen3.8-max") },
    evidence: asked("qwen3.8-max", "https://docs.apimart.ai/en/api-reference/texts/qwen3.8-max/guide"),
  },
  {
    modelKey: "qwen3.8-flash", labelZh: "Qwen 3.8 Flash",
    tokenPricing: { inputPerMTokUsd: 0.0914288, outputPerMTokUsd: 0.3085712, cacheReadPerMTokUsd: 0.0114288, cacheWritePerMTokUsd: 0.1428568, source: pricingSource("qwen3.8-flash") },
    evidence: asked("qwen3.8-flash"),
  },
  {
    modelKey: "qwen3.8-27b", labelZh: "Qwen 3.8 27B",
    tokenPricing: { inputPerMTokUsd: 0.3428568, outputPerMTokUsd: 1.3714288, cacheReadPerMTokUsd: 0.0685712, cacheWritePerMTokUsd: 0.4285712, source: pricingSource("qwen3.8-27b") },
    evidence: asked("qwen3.8-27b"),
  },
  {
    modelKey: "qwen3.8-2.4t-a95b", labelZh: "Qwen 3.8 2.4T A95B",
    tokenPricing: { inputPerMTokUsd: 1.3714288, outputPerMTokUsd: 4.1142856, cacheReadPerMTokUsd: 0.1714288, cacheWritePerMTokUsd: 1.7142856, source: pricingSource("qwen3.8-2.4t-a95b") },
    evidence: asked("qwen3.8-2.4t-a95b"),
  },
  {
    modelKey: "glm-5.3", labelZh: "GLM 5.3",
    tokenPricing: { inputPerMTokUsd: 1.12, outputPerMTokUsd: 3.52, cacheReadPerMTokUsd: 0.208, source: pricingSource("glm-5.3") },
    evidence: asked("glm-5.3"),
  },
  {
    modelKey: "glm-5.3-flash", labelZh: "GLM 5.3 Flash",
    tokenPricing: { inputPerMTokUsd: 0.06, outputPerMTokUsd: 0.2, cacheReadPerMTokUsd: 0.012, source: pricingSource("glm-5.3-flash") },
    evidence: asked("glm-5.3-flash"),
  },
  {
    modelKey: "kimi-k3", labelZh: "Kimi K3",
    tokenPricing: { inputPerMTokUsd: 2.4, outputPerMTokUsd: 12, cacheReadPerMTokUsd: 0.24, source: pricingSource("kimi-k3") },
    evidence: asked("kimi-k3"),
  },
  {
    modelKey: "grok-4.7", labelZh: "Grok 4.7",
    tokenPricing: { inputPerMTokUsd: 3.2, outputPerMTokUsd: 9.6, cacheReadPerMTokUsd: 0.8, source: pricingSource("grok-4.7") },
    evidence: asked("grok-4.7"),
  },
  {
    modelKey: "minimax-m3", labelZh: "MiniMax M3",
    tokenPricing: { inputPerMTokUsd: 0.24, outputPerMTokUsd: 0.96, source: pricingSource("minimax-m3") },
    evidence: asked("minimax-m3"),
  },
  {
    modelKey: "step-3.7-flash", labelZh: "Step 3.7 Flash",
    tokenPricing: { inputPerMTokUsd: 0.15424, outputPerMTokUsd: 0.92544, source: pricingSource("step-3.7-flash") },
    evidence: asked("step-3.7-flash"),
  },
  // Saved legacy identities remain executable; lifecycle policy only changes recommendation order.
  {
    modelKey: "deepseek-v4-flash", labelZh: "DeepSeek V4 Flash",
    // 2026-11-07 起记 APIMart 价（以前记 DeepSeek 官网峰价 0.44 / 1.32 / 缓存读 0.014）。
    tokenPricing: { inputPerMTokUsd: 0.3428568, outputPerMTokUsd: 1.0285712, cacheReadPerMTokUsd: 0.0342856, source: pricingSource("deepseek-v4-flash") },
    evidence: { protocolDoc: CHAT_PROTOCOL_DOC, modelDoc: CHAT_PROTOCOL_DOC, pricingApi: apimartTextPricingApi("deepseek-v4-flash"), liveCall: DEEPSEEK_PROBED_0821 },
  },
  // V3.1-terminus **故意留白**：2026-09-07 实查 DeepSeek 官方定价页，表里只有 v4-flash / v4-pro /
  // v4-flash-vision-exp 三行，V3 系列一个字都没有；2026-11-07 APIMart 全量价目表也没有它（见上面的注释）。
  // 查不到就不填——编一个「大概和 flash 差不多」的数字，面板上会印出一个看起来很确定的金额。
  // 它在运行时落到「花费不可知」那一态。
  {
    modelKey: "deepseek-v3.1-terminus", labelZh: "DeepSeek V3.1 Terminus",
    evidence: { protocolDoc: CHAT_PROTOCOL_DOC, pricingApi: apimartTextPricingApi("deepseek-v3.1-terminus"), liveCall: DEEPSEEK_PROBED_0821 },
  },
  {
    modelKey: "gemini-3.5-flash", labelZh: "Gemini 3.5 Flash",
    // autoImageReader：没指定模型时自动读图（视频拆解读帧）用它。2026-08-12 单镜分镜提取实测过；
    // 别的读图模型读帧的质量和花费还没比过，比过再换（计划表登记）。
    meta: { supportsImageInput: true, autoImageReader: true },
    // 2026-11-07 起记 APIMart 价（旧倍率计费，接口里没有缓存价；以前记 Google 官网 1.5 / 9 / 缓存读 0.15）。
    tokenPricing: { inputPerMTokUsd: 1.2, outputPerMTokUsd: 7.2, source: pricingSource("gemini-3.5-flash") },
    evidence: {
      protocolDoc: CHAT_PROTOCOL_DOC,
      modelDoc: "https://docs.apimart.ai/en/api-reference/texts/gemini/quickstart",
      pricingApi: apimartTextPricingApi("gemini-3.5-flash"),
      liveCall: { checkedAt: "2026-08-12", record: "上面的 R5 实测对账：真 key 打 /v1/chat/completions" },
      imageInput: { checkedAt: "2026-08-12", record: "上面的 R5 实测对账：OpenAI 式 image_url 多模态 part 被认" },
    },
  },
  // Context-IR 不是 chat 模型：它走 /v1/videos/generations 的异步任务，`textBrainResolver`
  // 的 `isPromptRefineOnlyModel` 明确把它挡在 Agent 主控之外（electron/ai/textBrainResolver.ts:26-31）。
  // 不按 token 计费也不是「免费」，所以两个字段都不声明——价目门岗按同一个生产判据豁免它。
  {
    modelKey: "MiniMax-H3-Context-IR", labelZh: "MiniMax H3 · Context-IR 提示词增强", meta: { promptRefineOnly: true },
    evidence: {
      protocolDoc: "https://docs.apimart.ai/en/api-reference/videos/minimax-h3/context-ir",
      pricingApi: apimartTextPricingApi("MiniMax-H3-Context-IR"),
      liveCall: "未",
    },
  },
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
