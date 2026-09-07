/**
 * 对话模型的**官方**上下文窗口。逐条带一手出处，查不到的**明写 unknown**。
 *
 * 为什么要这张表：目录里的 `meta.contextWindow` 只有 onboarding 时供应商自己报了才有。
 * 2026-09-06 实测用户真实目录里 21 个对话模型，**一个都没有**——于是 Agent 面板头上的
 * 上下文环恒为空圈「—」。环画的是「这次对话装了多少」，分母缺了它就什么都说不了。
 *
 * 三条纪律（R5：接/改任何模型前先抓真实官方文档逐项对账）：
 *
 * 1. **一手出处优先**。中转页（APIMart / kie / OpenRouter / ModelScope 镜像）写的数常常低于、
 *    或干脆不同于模型自己的上限——中转页的上限是那家中转的上限，不是模型的。
 *    所以 `source` 只填模型厂商自己的文档/权重卡，中转页不作数。
 * 2. **查不到、或一手来源自相矛盾，就写 `unknown`，不推、不借用同族**。一个编出来的 200K 会让环
 *    画出一个用户没法核对的百分比，那比空圈更糟：空圈至少诚实地说「不知道」。
 *    `agnes-2.0-flash` 就是这一条的现场：厂商自己两个页面一个写 256K、一个写 512K，所以留 unknown。
 * 3. **按模型键认，不按供应商认**（P4 通用第一）。同一个模型经三家中转接进来是同一个模型，
 *    同一个窗口。所以这张表的键是模型键，`vendorKey` 一个字都不出现。
 *
 * 关于 `derived`：不少厂商只公布简写（「128K」「1M」「512K」），不给整数。把简写换算成整数是
 * **一次有记录的换算**，不是编造，所以照记但打上 `derived: true` 并在 `note` 里写清原文写的是什么。
 * 二进制/十进制的取舍按各家自己的语境：DeepSeek/Moonshot 的 128K 记 131072（它们的权重配置就是 2 的幂），
 * Anthropic / MiniMax / Agnes 的 1M 记 1_000_000（它们的文档与计价都按十进制说）。
 *
 * 表里**保留** unknown 那几条并写清「查过哪里、为什么没有」——「查过、没查到」和「没查过」
 * 是两件事，下次有人接手时不该从零再查一遍。
 */

export type ModelContextWindowFact = Readonly<{
  /** 官方公布的上下文窗口（token）。查不到时为 `undefined` —— 不填数、不估。 */
  contextWindow?: number;
  /** 这个数是什么：整个上下文窗口，还是只有输入上限。两者对某些厂商不是一回事。 */
  measures?: "context-window" | "max-input-tokens";
  /** true = 厂商只写了简写（128K / 1M），整数是按 `note` 里记的换算得来的，不是原文抄的。 */
  derived?: boolean;
  /** 一手出处。`unknown` 那几条填的是「查过哪里」，不是数的出处。 */
  source: string;
  checkedAt: string;
  /** 换算依据，或查不到的原因——下一个人据此决定要不要再查一遍。 */
  note?: string;
}>;

const CHECKED = "2026-09-06";

export const MODEL_CONTEXT_WINDOW_FACTS: Readonly<Record<string, ModelContextWindowFact>> = Object.freeze({
  // ── DeepSeek ────────────────────────────────────────────────────────────
  "deepseek-v4-pro": {
    contextWindow: 1_048_576,
    measures: "context-window",
    source: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/raw/main/config.json",
    checkedAt: CHECKED,
    note: "API 文档写「1M」，整数取厂商自己权重配置里的 max_position_embeddings = 1048576。",
  },
  "deepseek-v4-flash": {
    contextWindow: 1_048_576,
    measures: "context-window",
    source: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/raw/main/config.json",
    checkedAt: CHECKED,
    note: "同 deepseek-v4-pro。",
  },
  "deepseek-v3.2": {
    contextWindow: 131_072,
    measures: "context-window",
    derived: true,
    source: "http://web.archive.org/web/20260204135805/https://api-docs.deepseek.com/quick_start/pricing/",
    checkedAt: CHECKED,
    note: "该型号 2026-07-24 已从 DeepSeek API 下架，数取自存档的一手计价页「CONTEXT LENGTH 128K」；128K→131072。",
  },
  "deepseek-v3.2-think": {
    contextWindow: 131_072,
    measures: "context-window",
    derived: true,
    source: "http://web.archive.org/web/20260204135805/https://api-docs.deepseek.com/quick_start/pricing/",
    checkedAt: CHECKED,
    note: "同上页同一行（thinking 模式，原 deepseek-reasoner）。",
  },
  "deepseek-v3.1-terminus": {
    contextWindow: 131_072,
    measures: "context-window",
    derived: true,
    source: "https://api-docs.deepseek.com/news/news250821",
    checkedAt: CHECKED,
    note: "Terminus 的发布说明没重述窗口，数取自 V3.1 发布说明「128K context for both」；128K→131072。中等把握。",
  },

  // ── Qwen（开放权重，模型卡即一手） ────────────────────────────────────
  "Qwen/Qwen3-Next-80B-A3B-Instruct": {
    contextWindow: 262_144,
    measures: "context-window",
    source: "https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct",
    checkedAt: CHECKED,
    note: "原生 262144；模型卡另称 YaRN 可外推到 ~1.01M，那是外推不是原生，不记。",
  },
  "Qwen/Qwen3-30B-A3B": {
    contextWindow: 32_768,
    measures: "context-window",
    source: "https://huggingface.co/Qwen/Qwen3-30B-A3B",
    checkedAt: CHECKED,
    note: "原生 32768（YaRN 可到 131072，不记）。注意同族的 -Instruct-2507 / -Thinking-2507 原生是 262144，是另一个键。",
  },
  "Qwen/Qwen3-8B": {
    contextWindow: 32_768,
    measures: "context-window",
    source: "https://huggingface.co/Qwen/Qwen3-8B",
    checkedAt: CHECKED,
    note: "原生 32768（YaRN 可到 131072，不记）。",
  },

  // ── Moonshot / Kimi ────────────────────────────────────────────────────
  "moonshot-v1-128k-vision-preview": {
    contextWindow: 131_072,
    measures: "context-window",
    derived: true,
    source: "https://web.archive.org/web/20251209082955/https://platform.moonshot.cn/docs/introduction",
    checkedAt: CHECKED,
    note: "该型号 2026-08-31 已下架，现役文档站（platform.kimi.com）只剩 K3/K2.7/K2.6。存档页原文「128k，包括输入和输出」；128k→131072。",
  },

  // ── MiniMax ─────────────────────────────────────────────────────────────
  "MiniMax-M3": {
    contextWindow: 1_000_000,
    measures: "context-window",
    source: "https://platform.minimax.io/docs/guides/text-generation",
    checkedAt: CHECKED,
    note: "官方模型表 Context Window 列写 1M，计价按十进制分档（512K 输入切档），故记 1_000_000。",
  },
  "MiniMax-H3-Context-IR": {
    source: "https://platform.minimax.io/docs/api-reference/video-generation-v2-h3-context-ir",
    checkedAt: CHECKED,
    note: "**不是对话模型**：它是视频生成 V2 的 task_type，限额按字符数/图数/请求体大小算，根本没有 token 窗口这回事。",
  },

  // ── Google / Anthropic / OpenAI ────────────────────────────────────────
  "gemini-3.5-flash": {
    contextWindow: 1_048_576,
    measures: "max-input-tokens",
    source: "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash",
    checkedAt: CHECKED,
    note: "Google 把输入与输出上限**分开**公布，这里记的是输入上限（输出另有 65536）。",
  },
  "claude-fable-5": {
    contextWindow: 1_000_000,
    measures: "context-window",
    derived: true,
    source: "https://platform.claude.com/docs/en/models/fable-5/overview",
    checkedAt: CHECKED,
    note: "文档写 1M（十进制语境）；精确整数由 Models API 的 max_input_tokens 暴露，文档页本身不给。",
  },
  "gpt-5.5": {
    contextWindow: 1_050_000,
    measures: "context-window",
    source: "https://developers.openai.com/api/docs/models/gpt-5.5",
    checkedAt: CHECKED,
    note: "快照 gpt-5.5-2026-04-23；文档直接给整数。",
  },

  // ── Agnes ───────────────────────────────────────────────────────────────
  "agnes-2.0-flash": {
    source: "https://github.com/AgnesAI-Labs/AgnesAI-Models",
    checkedAt: CHECKED,
    note: "**厂商自己两个一手来源打架**：GitHub 目录写 256K（并说明 2026-06 从临时的 1M 回滚），wiki 写 512K。矛盾时按纪律 2 留 unknown，不挑一个。",
  },
  "agnes-2.5-flash": {
    contextWindow: 524_288,
    measures: "context-window",
    derived: true,
    source: "https://wiki.agnes-ai.com/en/docs/agnes-25-flash.md",
    checkedAt: CHECKED,
    note: "wiki 只写 512K；512K→524288。",
  },
  "agnes-2.5-pro": {
    contextWindow: 1_000_000,
    measures: "context-window",
    derived: true,
    source: "https://wiki.agnes-ai.com/en/docs/agnes-25-pro.md",
    checkedAt: CHECKED,
    note: "wiki 只写 1M（十进制语境，同 Anthropic/MiniMax 的处理）。",
  },
  "agnes-2.5-pro-alpha": {
    contextWindow: 1_048_576,
    measures: "max-input-tokens",
    source: "https://huggingface.co/Agnes-AI/Agnes-2.5-Pro-Alpha",
    checkedAt: CHECKED,
    note: "模型卡给了精确整数（输入 token）。",
  },
  "agnes-2.5-pro-beta": {
    contextWindow: 1_000_000,
    measures: "context-window",
    derived: true,
    source: "https://wiki.agnes-ai.com/en/docs/agnes-25-pro-beta.md",
    checkedAt: CHECKED,
    note: "wiki 只写 1M。",
  },
});

/** 按模型键取官方窗口。表里没有、或那一条是 `unknown` → `undefined`（诚实地不知道）。 */
export function officialModelContextWindow(modelKey: string | undefined): number | undefined {
  if (!modelKey) return undefined;
  return MODEL_CONTEXT_WINDOW_FACTS[modelKey.trim()]?.contextWindow;
}
