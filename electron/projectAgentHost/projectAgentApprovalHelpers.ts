import type { AgentChatToolDecision } from "../harness/agentChatContracts";
import type { RuntimeToolCall } from "../harness/runtime/runtimePort";

export type PreparedApproval = Readonly<{ invocation: unknown }>;

export function callWithEffectiveArgs(call: RuntimeToolCall, decision: AgentChatToolDecision): RuntimeToolCall {
  return decision.ok && decision.effectiveArgs ? { ...call, args: decision.effectiveArgs } : call;
}

export async function reprepareEffectiveCall<T extends PreparedApproval>(
  call: RuntimeToolCall,
  decision: AgentChatToolDecision,
  prepared: T,
  prepare: (call: RuntimeToolCall) => Promise<T | null>,
): Promise<{ ok: true; call: RuntimeToolCall; prepared: T } | { ok: false; code: "capability_input_invalid" }> {
  if (!decision.ok || !decision.effectiveArgs) return { ok: true, call, prepared };
  const effectiveCall = callWithEffectiveArgs(call, decision);
  try {
    const next = await prepare(effectiveCall);
    return next ? { ok: true, call: effectiveCall, prepared: next } : { ok: false, code: "capability_input_invalid" };
  } catch {
    return { ok: false, code: "capability_input_invalid" };
  }
}

type ProductionAdapter = Readonly<{
  prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<PreparedApproval | null>;
  execute(prepared: PreparedApproval, approval: Readonly<{ receiptProposalId: string; approvalId: string; actionHash: string }>, signal: AbortSignal): Promise<AgentChatToolDecision>;
}>;

export async function executeProductionApproval(input: Readonly<{
  adapter: ProductionAdapter;
  call: RuntimeToolCall;
  signal: AbortSignal;
  awaitDecision: (call: RuntimeToolCall, signal: AbortSignal) => Promise<AgentChatToolDecision>;
  persist: (call: RuntimeToolCall, decision: AgentChatToolDecision, prepared: PreparedApproval) => Promise<Readonly<{ approvalId: string; receiptProposalId: string; actionHash: string }>>;
  remember: (code: string | undefined, fallback: string, denied?: boolean) => AgentChatToolDecision;
  settle: (approvalId: string, status: "done" | "failed") => void;
}>): Promise<AgentChatToolDecision | null> {
  let prepared: PreparedApproval | null;
  try {
    prepared = await input.adapter.prepare(input.call, input.signal);
  } catch (error) {
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : error instanceof Error ? error.message : "capability_execution_failed";
    return input.remember(code, "capability_unsupported");
  }
  if (!prepared) return null;
  const decision = await input.awaitDecision(input.call, input.signal);
  if (!decision.ok) return input.remember(decision.code, input.signal.aborted ? "capability_input_invalid" : "capability_target_stale", decision.denied);
  const effective = await reprepareEffectiveCall(input.call, decision, prepared, (call) => input.adapter.prepare(call, input.signal));
  if (!effective.ok) return input.remember(effective.code, effective.code);
  const persisted = await input.persist(effective.call, decision, effective.prepared);
  const executed = await input.adapter.execute(effective.prepared, persisted, input.signal);
  input.settle(persisted.approvalId, executed.ok ? "done" : "failed");
  return executed.ok ? executed : input.remember(executed.code, input.signal.aborted ? "capability_input_invalid" : "capability_target_stale");
}
