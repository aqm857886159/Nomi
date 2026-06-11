/**
 * The onboarding agent loop.
 *
 * Single entry point: run one trial. Returns the structured outcome
 * suitable for serialization to disk (trace.json).
 *
 * Used by:
 *  - scripts/lab-onboard.ts (CLI)
 *  - electron/main.ts IPC handler (Phase B — user-facing)
 */
import { runAgentLoop } from "../agentLoop";
import { buildAiSdkModel } from "../buildAiSdkModel";
import { sanitizeForBroadCompat } from "../promptSanitize";
import { buildOnboardingTools, clearFetchCache } from "./tools";
import { buildSystemPrompt } from "./systemPrompt";
import { draftStore } from "./draft";
import type { ModelKind, ProviderKind, TrialEvent, TrialOutcome } from "./types";

export type OnboardingAgentInput = {
  trialId: string;
  docsUrl: string;
  targetKind: ModelKind;
  /** Real API key used to test the target model. Never enters LLM context. */
  userApiKey: string;
  /** Agent LLM credentials. */
  agent: {
    providerKind: ProviderKind;
    baseUrl: string;
    modelId: string;
    apiKey: string;
    /** Custom request headers for relay/proxy gateways (from the vendor's meta). */
    extraHeaders?: Record<string, string>;
  };
  /** Max LLM steps. Default 10. */
  maxSteps?: number;
  /** Event sink for trace reporter. */
  onEvent?: (e: TrialEvent) => void;
};

export async function runOnboardingTrial(input: OnboardingAgentInput): Promise<TrialOutcome> {
  const startedAt = Date.now();
  const sessionId = input.trialId;
  const draft = draftStore.create(sessionId, input.targetKind);

  input.onEvent?.({
    type: "trial-start",
    trialId: input.trialId,
    docsUrl: input.docsUrl,
    targetKind: input.targetKind,
    agentModel: input.agent.modelId,
  });

  let toolCalls = 0;

  const tools = buildOnboardingTools({
    sessionId,
    resolveUserApiKey: () => input.userApiKey,
    onToolCall: (event) => {
      toolCalls += 1;
      input.onEvent?.({
        type: "tool-call",
        toolName: event.tool,
        args: event.args,
        toolCallId: `call-${toolCalls}`,
      });
      input.onEvent?.({
        type: "tool-result",
        toolName: event.tool,
        result: event.result,
        toolCallId: `call-${toolCalls}`,
      });
    },
    allowedDomain: () => draftStore.get(sessionId).vendorBaseUrl,
  });

  const model = buildAiSdkModel({
    kind: input.agent.providerKind,
    baseURL: input.agent.baseUrl,
    apiKey: input.agent.apiKey,
    modelId: input.agent.modelId,
    ...(input.agent.extraHeaders ? { headers: input.agent.extraHeaders } : {}),
  });

  let llmError: Error | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let stepCount = 0;

  try {
    // Build prompts then sanitize for broad tokenizer compatibility (em-dashes,
    // curly quotes, math symbols etc. break older tokenizers like Moonshot's).
    const systemPrompt = sanitizeForBroadCompat(buildSystemPrompt(input.targetKind, input.docsUrl));
    const userMessage = sanitizeForBroadCompat(
      `Please onboard this model. Docs URL: ${input.docsUrl}. Target kind: ${input.targetKind}. Follow the workflow.`,
    );

    // The model profile (modelProfiles.ts) declaratively handles per-model
    // quirks: temperature requirements, default max_tokens, extra body fields.
    // buildAiSdkModel's profiled fetch applies them; the call here passes the
    // generic temperature/maxTokens and lets the profile override.
    // 统一循环内核（S0）：repair/retry/步数计数由 agentLoop 提供，本文件不再自带副本。
    const result = await runAgentLoop(
      {
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        tools,
        maxSteps: input.maxSteps ?? 14,
        temperature: 0.1,
        maxTokens: 4096,
        isAnthropic: input.agent.providerKind === "anthropic",
      },
      {
        onStepFinish: ({ stepIndex, text }) => {
          stepCount = stepIndex;
          input.onEvent?.({
            type: "llm-step",
            stepIndex,
            ...(text ? { text: text.slice(0, 1000) } : {}),
          });
        },
      },
      { mode: "oneshot" },
    );
    promptTokens = result.usage?.promptTokens || 0;
    completionTokens = result.usage?.completionTokens || 0;
    totalTokens = result.usage?.totalTokens || 0;
  } catch (e) {
    llmError = e instanceof Error ? e : new Error(String(e));
  }

  const finishedAt = Date.now();
  const finalDraft = draftStore.get(sessionId);

  // Determine final status from draft state, not just LLM result
  const lastTest = finalDraft.testAttempts[finalDraft.testAttempts.length - 1];
  const hasCommitableDraft = !draftStore.validateForCommit(sessionId);

  let status: TrialOutcome["status"];
  let failureReason: string | undefined;
  if (llmError) {
    status = "failure";
    failureReason = `LLM error: ${llmError.message}`;
  } else if (hasCommitableDraft && lastTest?.ok) {
    status = "success";
  } else if (lastTest?.ok) {
    status = "partial";
    failureReason = "Test passed but draft incomplete (missing required catalog fields)";
  } else if (finalDraft.modelFields.length > 0) {
    status = "partial";
    failureReason = lastTest ? `Last test failed: ${lastTest.diagnostics.join("; ")}` : "No successful test attempt";
  } else {
    status = "failure";
    failureReason = "Agent gave up before extracting any fields";
  }

  const outcome: TrialOutcome = {
    trialId: input.trialId,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    docsUrl: input.docsUrl,
    targetKind: input.targetKind,
    agentModel: input.agent.modelId,
    status,
    ...(failureReason ? { failureReason } : {}),
    rounds: stepCount,
    toolCalls,
    tokenUsage: { promptTokens, completionTokens, totalTokens },
    draft: finalDraft,
  };

  input.onEvent?.({ type: "trial-end", outcome });

  // cleanup
  draftStore.delete(sessionId);
  clearFetchCache(sessionId);

  return outcome;
}
