// 魔搭社区的免费 LLM（创作助手/拆镜头的「免费文本大脑」）。
//
// 价值：魔搭 api-inference 一个 key 免费(每日 2000 次)，给没付费接 OpenAI/APIMart 的用户一个
// 能用的文本大脑——补 Issue #9（接好魔搭就能让创作助手/拆镜头跑起来，零额外成本）。
//
// 真实验证(tests/ux/modelscope-expand.e2e.mjs，MODELSCOPE_E2E=1，用户 key)——**只收 chat+tool_use
// 双通的**，不手配漂。verify-first 实测结论(2026-06-20)：
//   ✓ Qwen3 全系(8B/14B/32B/30B-A3B/Next-80B-A3B)chat+tool_use 双通；
//   ✗ DeepSeek-R1/V3、Qwen2.5-72B、GLM-4.5 全「has no provider supported」(魔搭免费推理不serve)；
//   ✗ Qwen3-235B tool_use 格式不兼容；✗ 文生视频(Wan)500 不serve。
// 选 3 个 A3B/轻量阶梯(省免费额度)：8B 轻量 / 30B-A3B 均衡 / Next-80B-A3B 最强。
//
// kind=text 无 mapping：走 buildLanguageModelForVendor 直连 /v1/chat/completions(魔搭 baseUrl
// 已是 api-inference.modelscope.cn，默认 openai-compatible)。modelKey = 魔搭 hub 路径。

export type ModelscopeTextModel = {
  modelKey: string;
  labelZh: string;
  /**
   * 显式「不按 token 计费」。魔搭 api-inference 是**免费额度制**（每日 2000 次调用），
   * 没有 per-token 单价——所以它不是「我们查不到价目」，是「按 token 算钱这件事在这里不存在」。
   * 两者在面板上是两句不同的话：这里印「免费」，查不到的那种印「不可知」（方案 §1.7）。
   */
  free: true;
};

export const MODELSCOPE_TEXT_MODELS: ModelscopeTextModel[] = [
  { modelKey: "Qwen/Qwen3-Next-80B-A3B-Instruct", labelZh: "Qwen3 Next 80B（免费）", free: true },
  { modelKey: "Qwen/Qwen3-30B-A3B", labelZh: "Qwen3 30B（免费）", free: true },
  { modelKey: "Qwen/Qwen3-8B", labelZh: "Qwen3 8B（免费）", free: true },
];
