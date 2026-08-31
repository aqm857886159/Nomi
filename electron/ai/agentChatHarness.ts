// Harness helpers shared by the unified agent loop (agentLoop.ts) and its
// callers (runAgentChatV2 / onboarding). Pure, testable functions only —
// kept out of the runtime.ts mega-shell (规则 9/12).
import {
  generateText,
  type CoreMessage,
  type LanguageModelV1,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

// History cap: bound BOTH message count AND estimated tokens, so a single fat
// message (e.g. a big tool result) can't blow a small context window even within
// the count cap. Slicing can decapitate a tool-call/tool-result pair, so after
// trimming we drop leading orphan `tool` messages (results the provider rejects).
// Note: token estimate is a provider-agnostic ~4 chars/token heuristic (CJK runs
// denser, so this errs conservative). Summarization-based compaction of dropped
// turns is a later step — for now we truncate oldest-first.
const AGENT_HISTORY_MAX_MESSAGES = 30;
const AGENT_HISTORY_TOKEN_BUDGET = 24_000;

function estimateMessageTokens(message: CoreMessage): number {
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  return Math.ceil((content?.length ?? 0) / 4);
}

// T3 token 优化:最近一轮之外的工具载荷(tool-call args / tool-result)把长字符串
// 截到 120 字——旧轮的 3 节点长提示词全文回放是每请求 ~2-3k token 的洞;
// 模型对旧轮只需要"做过什么",不需要逐字原文。保结构(配对/类型不动),只缩字符串值。
const COMPACT_KEEP_TAIL = 8;
const COMPACT_STRING_MAX = 120;

function truncateDeepStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > COMPACT_STRING_MAX ? `${value.slice(0, COMPACT_STRING_MAX)}…[截断]` : value;
  }
  if (Array.isArray(value)) return value.map(truncateDeepStrings);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = truncateDeepStrings(item);
    return out;
  }
  return value;
}

export function compactOldToolPayloads(messages: CoreMessage[]): CoreMessage[] {
  if (messages.length <= COMPACT_KEEP_TAIL) return messages;
  const cutoff = messages.length - COMPACT_KEEP_TAIL;
  return messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (typeof message.content === "string" || !Array.isArray(message.content)) return message;
    let touched = false;
    const content = message.content.map((part) => {
      const record = part as { type?: string; args?: unknown; result?: unknown };
      if (record.type === "tool-call" && record.args !== undefined) {
        touched = true;
        return { ...part, args: truncateDeepStrings(record.args) };
      }
      if (record.type === "tool-result" && record.result !== undefined) {
        touched = true;
        return { ...part, result: truncateDeepStrings(record.result) };
      }
      return part;
    });
    return touched ? ({ ...message, content } as CoreMessage) : message;
  });
}

export function capAgentHistory(messages: CoreMessage[]): CoreMessage[] {
  const compacted = compactOldToolPayloads(messages);
  let trimmed =
    compacted.length > AGENT_HISTORY_MAX_MESSAGES
      ? compacted.slice(compacted.length - AGENT_HISTORY_MAX_MESSAGES)
      : compacted;
  let total = trimmed.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  while (trimmed.length > 1 && total > AGENT_HISTORY_TOKEN_BUDGET) {
    total -= estimateMessageTokens(trimmed[0]);
    trimmed = trimmed.slice(1);
  }
  while (trimmed.length > 0 && trimmed[0].role === "tool") {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

// Multi-round planning skills create many nodes in a single turn; the old
// hard-coded `maxSteps: 5` silently truncated a long storyboard / 角色卡 plan.
// Give planners headroom; keep a modest default for one-shot edit skills.
const PLANNING_SKILL_KEYS = new Set<string>([
  "workbench.storyboard.planner",
  "workbench.fixation.planner",
  "workbench.generation.canvas-planner",
]);
const DEFAULT_AGENT_MAX_STEPS = 8;
const PLANNING_AGENT_MAX_STEPS = 24;
export function maxStepsForSkill(skillKey: string): number {
  return PLANNING_SKILL_KEYS.has(skillKey) ? PLANNING_AGENT_MAX_STEPS : DEFAULT_AGENT_MAX_STEPS;
}

// Funnel an optional external abort signal (e.g. the user's "Stop" button) into
// a fresh local AbortController, so streamText aborts on EITHER the first-chunk
// timeout OR an external cancel — a single abort funnel. Returns the controller
// to wire into streamText + the stream consumer.
export function createLinkedAbortController(external?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}

/**
 * Prompt parts for streamText, with provider-conditional prompt caching (P4):
 * on Anthropic-family models the large, stable system+skill prompt is marked
 * `ephemeral` so repeated turns within the ~5-min cache TTL reuse it (big cost +
 * latency win). On every other provider the result is byte-identical to passing
 * `{ system, messages }` — caching is opt-in per provider, never forced.
 */
export function buildAgentPromptParts(
  system: string | undefined,
  messages: CoreMessage[],
  isAnthropic: boolean,
): { system?: string; messages: CoreMessage[] } {
  if (system && isAnthropic) {
    // 缓存命中率:断点① system(身份/规则,跨轮稳定);断点② 最后一条消息(把整段对话
    // 历史也纳入前缀缓存——只标 system 时增长的历史每步每轮全价重算)。
    const withTailBreakpoint = messages.map((message, index) =>
      index === messages.length - 1
        ? ({ ...message, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } as CoreMessage)
        : message,
    );
    return {
      messages: [
        { role: "system", content: system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
        ...withTailBreakpoint,
      ],
    };
  }
  return { ...(system ? { system } : {}), messages };
}

// Self-repair malformed tool-call JSON: weaker models sometimes emit invalid
// args for complex schemas. Ask the same model to fix its own JSON instead of
// crashing the whole turn; return null to let the SDK report the original error.
// 全仓唯一 repair 实现(S0 不变量②)——两条循环都经 agentLoop 取用,不许复制。
export function createToolCallRepair(model: LanguageModelV1, abortSignal?: AbortSignal): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error, messages }) => {
    try {
      const repaired = await generateText({
        model,
        // 透传主循环的 abortSignal:用户按 Stop / 流被 abort 时,这次自愈调用也要一起取消,
        // 否则它会脱离主流继续烧 token 到自己返回(planner 24 步每步都可能触发一次 repair)。
        ...(abortSignal ? { abortSignal } : {}),
        system:
          "You are a JSON repair assistant. Given a tool call with broken arguments, return ONLY the corrected JSON object that matches the tool's parameter schema.",
        messages: [
          ...messages,
          {
            role: "user",
            content:
              `The previous tool call to "${toolCall.toolName}" had invalid arguments:\n` +
              `\`\`\`json\n${toolCall.args}\n\`\`\`\n` +
              `Error: ${error.message}\n` +
              `Output only the corrected JSON arguments — no markdown, no explanation.`,
          },
        ],
        temperature: 0.1,
        maxTokens: 1024,
      });
      JSON.parse(repaired.text);
      return { ...toolCall, args: repaired.text };
    } catch {
      return null;
    }
  };
}
