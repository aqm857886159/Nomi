// Agnes AI 文本模型（创作助手 / 拆镜头的「大脑」）的 curated 种子。
//
// AGNES 是 OpenAI 兼容 chat（R5 核：wiki.agnes-ai.com/en/docs/agnes-20-flash.md）：
//   POST /v1/chat/completions  { model, messages, tools?, stream? }  —— 同步、标准形状，
//   支持 tool_use + 视觉(image_url) + 流式，512K 上下文。
// 故文本模型**不需要 create/query mapping**：agent 走 buildLanguageModelForVendor（providerKind
// 缺省 openai-compatible → baseURL 补 /v1 → AI SDK 自动补 /chat/completions）。catalog 只需一条
// kind="text" 的 Model 记录。
//
// 价值（同 modelscope 免费 Qwen）：给没付费用户一个**免费、tool_use 可用**的 agent 大脑，
// 一个 AGNES key 即解锁文本/图/视频全链路。

/** 一个 AGNES 文本模型的 curated 定义（无 archetype / 无 mapping；modelKey = chat model id）。 */
export type AgnesTextModel = {
  modelKey: string;
  labelZh: string;
};

/** AGNES 免费文本大脑（单源）。 */
export const AGNES_TEXT_MODELS: AgnesTextModel[] = [
  { modelKey: "agnes-2.0-flash", labelZh: "Agnes 2.0 Flash" },
];
