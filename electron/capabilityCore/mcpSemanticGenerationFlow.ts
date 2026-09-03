import type { GenerationGateChallengeProjection, GenerationGateConfirmation } from "./mcpProtocol";

export type SemanticGenerationFlowDependencies = {
  invoke: (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  requestConfirmation: (challenge: GenerationGateChallengeProjection, signal?: AbortSignal) => Promise<GenerationGateConfirmation>;
  buildResult: (toolName: string, args: Record<string, unknown>, result: unknown) => Record<string, unknown>;
  reply: (id: unknown, result: unknown) => void;
  locale: () => "zh-CN" | "en";
};

/** Resolve the one server-owned challenge, approve the same Run, then start it. */
export async function handleSemanticGenerationGate(
  id: unknown,
  toolName: string,
  args: Record<string, unknown>,
  built: Record<string, unknown>,
  deps: SemanticGenerationFlowDependencies,
  signal?: AbortSignal,
): Promise<void> {
  const challenge = await deps.invoke("nomi_request_generation_gate", built, signal) as GenerationGateChallengeProjection;
  const confirmation = await deps.requestConfirmation(challenge, signal);
  if (!confirmation.confirmed || (!confirmation.receiptId && !confirmation.receiptToken)) {
    deps.reply(id, {
      content: [{ type: "text", text: deps.locale() === "en"
        ? "Not started: confirm this generation in the current client or in the single Nomi fallback card."
        : "未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。" }],
      isError: true,
      structuredContent: { nomiOutcome: { errorCode: "human_approval_required", nextAction: "confirm", capability: "gate_decide" } },
    });
    return;
  }
  const approved = await deps.invoke("nomi_decide_generation_gate", {
    ...built,
    contractHash: typeof challenge.handoff?.contractHash === "string" ? challenge.handoff.contractHash : undefined,
    receiptId: confirmation.receiptId,
    receiptToken: confirmation.receiptToken,
  }, signal);
  const started = await deps.invoke("nomi_start_generation", {
    ...built,
    leaseHandle: approved && typeof (approved as Record<string, unknown>).leaseHandle === "string"
      ? (approved as Record<string, unknown>).leaseHandle
      : built.leaseHandle,
    receiptId: confirmation.receiptId,
    receiptToken: confirmation.receiptToken,
  }, signal);
  // Return the signed challenge's public display projection for journey/audit consumers, but never the
  // opaque handoff token. This lets a client verify that a multi-shot approval covered the same reference
  // media it is about to submit without turning the transport response into another receipt channel.
  const { handoff: _handoff, ...publicChallenge } = challenge;
  deps.reply(id, deps.buildResult(toolName, args, { challenge: publicChallenge, confirmation, approved, started }));
}
