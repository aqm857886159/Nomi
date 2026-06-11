// 统一 agent 循环内核(harness 总方案 S0):对话(stream)与 onboarding(oneshot)
// 共用同一台发动机——maxSteps/retry/repair/prompt 缓存只此一份,S3 的轨迹埋点也只埋这里。
//
// 三不变量(总方案 §2):
// ① 本模块零模块级可变状态——可重入,同一 model 并发多次互不污染(Subagents 预留);
// ② repair 全仓唯一来源(agentChatHarness.createToolCallRepair),不许再复制;
// ③ 确认门焊在工具层(makeAgentTool),对话历史归调用方——内核只负责"开一轮循环"。
import { generateText, streamText, type CoreMessage, type LanguageModelV1, type ToolSet } from "ai";
import { buildAgentPromptParts, createToolCallRepair, maxStepsForSkill } from "./agentChatHarness";

// 显式 retry(SDK 默认 2):中转/代理偶发 429/5xx 不该杀掉整轮。两模式统一为 3
// (oneshot 原默认 2,统一是有意的行为变化,见 S0 commit)。
const AGENT_MAX_RETRIES = 3;

export type AgentLoopRequest = {
  model: LanguageModelV1;
  system?: string;
  messages: CoreMessage[];
  tools: ToolSet;
  /** anthropic 系模型时给 system 挂 ephemeral 缓存;其余 provider 字节不变(P4)。 */
  isAnthropic?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 显式步数上限;不传则按 skillKey 分档(planner 24 / 默认 8)。 */
  maxSteps?: number;
  skillKey?: string;
  abortSignal?: AbortSignal;
};

export type AgentLoopHooks = {
  /** 每步收尾回调(stepIndex 从 1 起)——调用方不再手写计数。 */
  onStepFinish?: (step: { stepIndex: number; text?: string }) => void;
  /** 流模式的错误外溢(oneshot 模式错误直接 throw,不走此口)。 */
  onError?: (message: string) => void;
  /** S3 因果链预留:子循环(Subagents)落事件时此值写进 causeId。S0 仅透传占位。 */
  parentEventId?: string;
};

export function runAgentLoop(
  req: AgentLoopRequest,
  hooks: AgentLoopHooks,
  opts: { mode: "stream" },
): ReturnType<typeof streamText>;
export function runAgentLoop(
  req: AgentLoopRequest,
  hooks: AgentLoopHooks,
  opts: { mode: "oneshot" },
): ReturnType<typeof generateText>;
export function runAgentLoop(
  req: AgentLoopRequest,
  hooks: AgentLoopHooks,
  opts: { mode: "stream" | "oneshot" },
): ReturnType<typeof streamText> | ReturnType<typeof generateText> {
  // 每次调用自带计数器(局部状态,不变量①)。
  let stepIndex = 0;
  const onStepFinish = hooks.onStepFinish
    ? (step: { text?: string }) => {
        stepIndex += 1;
        hooks.onStepFinish?.({ stepIndex, ...(step.text ? { text: step.text } : {}) });
      }
    : undefined;

  const shared = {
    model: req.model,
    ...buildAgentPromptParts(req.system, req.messages, req.isAnthropic === true),
    tools: req.tools,
    maxSteps: req.maxSteps ?? maxStepsForSkill(req.skillKey ?? ""),
    maxRetries: AGENT_MAX_RETRIES,
    experimental_repairToolCall: createToolCallRepair(req.model),
    ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
    ...(typeof req.maxTokens === "number" ? { maxTokens: req.maxTokens } : {}),
    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
    ...(onStepFinish ? { onStepFinish } : {}),
  };

  if (opts.mode === "oneshot") {
    return generateText(shared);
  }
  return streamText({
    ...shared,
    toolCallStreaming: true,
    ...(hooks.onError
      ? { onError: ({ error }: { error: unknown }) => hooks.onError?.(error instanceof Error ? error.message : String(error)) }
      : {}),
  });
}
