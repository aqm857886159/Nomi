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

export function capAgentHistory(messages: CoreMessage[]): CoreMessage[] {
  let trimmed =
    messages.length > AGENT_HISTORY_MAX_MESSAGES
      ? messages.slice(messages.length - AGENT_HISTORY_MAX_MESSAGES)
      : messages;
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
    return {
      messages: [
        { role: "system", content: system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
        ...messages,
      ],
    };
  }
  return { ...(system ? { system } : {}), messages };
}

// Self-repair malformed tool-call JSON: weaker models sometimes emit invalid
// args for complex schemas. Ask the same model to fix its own JSON instead of
// crashing the whole turn; return null to let the SDK report the original error.
// 全仓唯一 repair 实现(S0 不变量②)——两条循环都经 agentLoop 取用,不许复制。
export function createToolCallRepair(model: LanguageModelV1): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error, messages }) => {
    try {
      const repaired = await generateText({
        model,
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
