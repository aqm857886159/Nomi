/**
 * Model Profile system — quirk handling for AI SDK openai-compatible providers.
 *
 * Why: different "OpenAI-compatible" providers have different real-world
 * behaviors. Some require certain body fields, reject certain JSON Schema
 * features, cap max_tokens too low, or refuse custom temperature.
 *
 * Rather than scatter `if (modelId.startsWith('kimi-k2'))` checks across
 * the agent runtime, we centralize known quirks here. Each profile:
 *   - matches a model id (via regex or substring)
 *   - declares its quirks declaratively
 *   - the runtime layer (buildAiSdkModel + agent.ts) consumes the profile
 *
 * Adding a new quirky provider = adding one entry. The agent core stays clean.
 */

export type ModelQuirks = {
  /** Required fixed temperature value (e.g. some reasoning models require exactly 1). */
  requireTemperature?: number;
  // 注意：这里**没有** defaultMaxTokens——单轮输出上限是模型自身属性（4k~64k+ 差异巨大，且多数
  // 服务商对超限值直接 400 不 clamp），不由代码编造。旧 fallback 注入的 max_tokens:4096 曾把
  // 拆镜头这类「单发整份大 JSON」的轮次拦腰截断（2026-07-15 Mimo/Deepseek 真实事故，根因见
  // agentError.ts）。需要上限时走目录 meta.maxOutputTokens（用户数据）→ agentChatV2 透传。
  /** Extra body fields to merge into every request (e.g. `enable_thinking: false`). */
  extraBody?: Record<string, unknown>;
  /** Whether this model is known to truncate tool-call JSON arguments mid-stream. */
  unreliableToolJson?: boolean;
  /** Whether this model is known to drop reasoning_content on tool-call assistants (blocks multi-round tool use). */
  requiresReasoningContentRoundtrip?: boolean;
  /** Free-form note shown to UI / developer when picking this model as agent. */
  agentSuitability?: "good" | "acceptable" | "poor";
  agentNote?: string;
};

type ProfileEntry = ModelQuirks & {
  match: (modelId: string) => boolean;
  description: string;
};

const PROFILES: ProfileEntry[] = [
  // ─── OpenAI ────────────────────────────────────────────────
  {
    description: "OpenAI reasoning models (o1, o3) require temperature: 1",
    match: (id) => /^(o1|o3)(-|$)/i.test(id),
    requireTemperature: 1,
    agentSuitability: "good",
  },
  {
    description: "OpenAI GPT-4o / GPT-5 family — reliable agent",
    match: (id) => /^gpt-(4o|5)/i.test(id),
    agentSuitability: "good",
  },

  // ─── Anthropic ────────────────────────────────────────────
  {
    description: "Anthropic Claude — reliable agent",
    match: (id) => /^claude-/i.test(id),
    agentSuitability: "good",
  },

  // ─── Google ───────────────────────────────────────────────
  {
    description: "Google Gemini — reliable agent",
    match: (id) => /^(gemini-|models\/gemini-)/i.test(id),
    agentSuitability: "good",
  },

  // ─── Moonshot Kimi K2 ──────────────────────────────────────
  // K2 series always emits reasoning_content. AI SDK openai-compatible 0.2.x
  // drops it on subsequent rounds, breaking multi-tool-call loops.
  {
    description: "Moonshot Kimi K2.x — thinking mode breaks multi-round tool calls",
    match: (id) => /^kimi-k2/i.test(id),
    requireTemperature: 1,
    extraBody: { enable_thinking: false },  // server ignores this; documented for honesty
    requiresReasoningContentRoundtrip: true,
    agentSuitability: "poor",
    agentNote:
      "Kimi K2 always returns reasoning_content but AI SDK openai-compatible doesn't preserve it across rounds. Multi-tool-call loops will fail. Use only for single-shot text generation.",
  },

  // ─── Moonshot v1 family ───────────────────────────────────
  // Older Kimi: tokenizer rejects some Unicode + array-of-types JSON Schema.
  // Tool-call JSON arguments are truncated even at 4k tokens.
  {
    description: "Moonshot v1 (moonshot-v1-*, kimi-latest) — unreliable tool-call JSON",
    match: (id) => /^(moonshot-v1|kimi-latest|kimi-thinking)/i.test(id),
    unreliableToolJson: true,
    agentSuitability: "poor",
    agentNote:
      "Moonshot v1 series truncates tool-call argument JSON mid-stream. Not reliable as agent for complex tool schemas.",
  },
];

const FALLBACK_PROFILE: ModelQuirks = {
  agentSuitability: "acceptable",
};

/**
 * Look up the quirks profile for a given model id.
 * Returns FALLBACK_PROFILE if no specific match.
 */
export function getModelProfile(modelId: string): ModelQuirks & { description: string } {
  const normalized = (modelId || "").trim();
  for (const entry of PROFILES) {
    if (entry.match(normalized)) {
      const { match, ...rest } = entry;
      return rest;
    }
  }
  return { ...FALLBACK_PROFILE, description: "Unknown model (using safe defaults)" };
}

/**
 * Apply a profile's request-side adjustments to a chat-completion body.
 * Pure function — returns a new body, doesn't mutate.
 */
export function applyProfileToRequestBody(
  body: Record<string, unknown>,
  profile: ModelQuirks,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  if (profile.requireTemperature !== undefined) {
    next.temperature = profile.requireTemperature;
  }
  if (profile.extraBody) {
    Object.assign(next, profile.extraBody);
  }
  return next;
}
