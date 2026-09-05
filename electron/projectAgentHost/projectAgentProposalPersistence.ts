import type { AgentChatToolDecision } from "../harness/agentChatContracts";
import type {
  ProjectAgentHostState,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProposalApprovalRef,
} from "../shared/projectAgentContracts";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import { isRendererOwnedStoryboardProposal } from "../shared/agentCapabilities/canvasWrite";
import { digest, stableJson } from "./projectAgentExecutionHelpers";
import type { ActiveExecution, ExecutionPartition } from "./projectAgentExecutionCoordinatorTypes";

/**
 * The coordinator owns mutation ordering and the clock; proposal persistence
 * only needs to borrow them, so they arrive as an explicit context instead of
 * being captured from the coordinator closure.
 */
export interface ProjectAgentProposalPersistenceContext {
  now: () => string;
  queueExecutionMutation: (execution: ActiveExecution, work: () => Promise<void>) => Promise<void>;
  dispatchFresh: (
    partition: ExecutionPartition,
    build: (state: ProjectAgentHostState) => ProjectAgentMutation,
  ) => Promise<Awaited<ReturnType<OfflineProjectAgentHost["dispatch"]>>>;
}

type ToolCall = { toolCallId: string; toolName: string; args: unknown };

type VerifiedInvocation = Readonly<{
  approvalId: string;
  receiptProposalId: string;
  target: ProjectAgentQueueItem["target"];
  preconditions: ProjectAgentQueueItem["preconditions"];
  policyRevision: number;
  inputHash: string;
  actionHash: string;
}>;

export async function persistApprovedProposal(
  context: ProjectAgentProposalPersistenceContext,
  partition: ExecutionPartition,
  execution: ActiveExecution,
  call: ToolCall,
  decision: AgentChatToolDecision,
  verified?: VerifiedInvocation,
): Promise<ProposalApprovalRef | undefined> {
  // A silent decision means the current Host-turn policy reused a prior
  // explicit approval. It still needs its own durable receipt/action hash;
  // only the renderer prompt is skipped. Persist it as an ordinary
  // proposal so recovery and audit never lose the write.
  if (!decision.ok) return;
  const { now, queueExecutionMutation, dispatchFresh } = context;
  const occurredAt = now();
  const expiresAt = new Date(new Date(occurredAt).getTime() + 10 * 60_000).toISOString();
  const approvalId = verified?.approvalId
    ?? decision.proposalId?.trim()
    ?? `approval-${digest([execution.turn.executionToken, call.toolCallId])}`;
  // Renderer-owned storyboard writes are prepared through the canvas
  // adapter even when the Agent turn was queued from the creation
  // document.  The verified invocation target is needed by the adapter,
  // but the Host proposal ledger must remain anchored to its queue item;
  // otherwise proposal.put rejects the cross-surface target as an invalid
  // transition before the renderer can persist the storyboard plan.
  const rendererOwnedStoryboard = isRendererOwnedStoryboardProposal(call.toolName, call.args);
  const target = rendererOwnedStoryboard
    ? execution.queueItem.target
    : verified?.target ?? execution.queueItem.target;
  const preconditions = rendererOwnedStoryboard
    ? execution.queueItem.preconditions
    : verified?.preconditions ?? execution.queueItem.preconditions;
  const fallbackActionHash = digest({
    toolName: call.toolName,
    args: call.args,
    target,
    preconditions,
  });
  const ref = Object.freeze({
    approvalId,
    receiptProposalId: verified?.receiptProposalId ?? approvalId,
    threadId: execution.turn.threadId,
    turnId: execution.turn.turnId,
    toolCallId: call.toolCallId,
    policyRevision: verified?.policyRevision ?? execution.queueItem.policyRevision,
    inputHash: verified?.inputHash ?? digest({ toolName: call.toolName, args: call.args }),
    actionHash: verified?.actionHash ?? fallbackActionHash,
    target,
    preconditions,
    expiresAt,
  });
  const item = Object.freeze({
    itemId: `proposal-${digest([execution.turn.executionToken, call.toolCallId])}`,
    threadId: execution.turn.threadId,
    turnId: execution.turn.turnId,
    kind: "proposal" as const,
    approval: ref,
    status: "proposed" as const,
    retryable: false,
    deviated: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  await queueExecutionMutation(execution, async () => {
    await dispatchFresh(partition, (current) => ({
      commandId: `proposal-put-${digest([execution.turn.executionToken, call.toolCallId])}`,
      expectedRevision: current.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: execution.turn.executionToken },
      type: "proposal.put",
      payload: { approval: { ref, lifecycle: "pending" }, item, occurredAt },
    }));
    await dispatchFresh(partition, (claimed) => ({
      commandId: `proposal-claim-${digest([execution.turn.executionToken, call.toolCallId])}`,
      expectedRevision: claimed.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: execution.turn.executionToken },
      type: "proposal.transition",
      payload: { approvalId, lifecycle: "claimed", occurredAt: now() },
    }));
  });
  const persisted = partition.host
    .getSnapshot(partition.binding)
    .proposalApprovals.find((approval) => approval.ref.approvalId === approvalId);
  if (!persisted || persisted.lifecycle !== "claimed" || stableJson(persisted.ref) !== stableJson(ref)) {
    throw new Error("approval_persistence_failed");
  }
  const committedQueue = partition.host.getSnapshot(partition.binding).queue.find((queueItem) => queueItem.turnId === execution.turn.turnId);
  if (committedQueue) execution.queueItem = committedQueue;
  execution.approvedProposalIds ??= [];
  execution.approvedProposalIds.push(approvalId);
  return persisted.ref;
}

export async function persistPreparedProposal(
  context: ProjectAgentProposalPersistenceContext,
  partition: ExecutionPartition,
  execution: ActiveExecution,
  call: ToolCall,
  decision: AgentChatToolDecision,
  prepared: { invocation: Omit<VerifiedInvocation, "approvalId" | "receiptProposalId"> },
): Promise<ProposalApprovalRef> {
  const persisted = await persistApprovedProposal(context, partition, execution, call, decision, {
    approvalId: `approval-${digest([execution.turn.executionToken, call.toolCallId])}`,
    receiptProposalId: `receipt-${digest([execution.turn.executionToken, call.toolCallId, "receipt"])}`,
    ...prepared.invocation,
  });
  if (!persisted) throw new Error("approval_persistence_failed");
  return persisted;
}
