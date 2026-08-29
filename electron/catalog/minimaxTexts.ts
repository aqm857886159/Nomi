// MiniMax 文本模型（官方原生）curated 种子 —— 创作助手 / 拆镜头的「大脑」。
//
// MiniMax-M1 是 OpenAI 兼容 chat（R5 已核官方文档）：
//   POST /v1/chat/completions  { model:"MiniMax-M1", messages, ... }   —— 同步、标准形状。
// 故文本模型**不需要 create/query mapping**：agent 走 electron/ai/vendorLanguageModel.ts 的
// buildLanguageModelForVendor（minimax 默认 providerKind=openai-compatible → baseURL=/v1 → AI SDK
// 自动补 /chat/completions）。catalog 只需一条 kind="text" 的 Model 记录，modelKey 即 chat model id。

export type MinimaxTextModel = {
  modelKey: string;
  labelZh: string;
};

export const MINIMAX_TEXT_MODELS: MinimaxTextModel[] = [
  { modelKey: "MiniMax-M1", labelZh: "MiniMax M1" },
];
