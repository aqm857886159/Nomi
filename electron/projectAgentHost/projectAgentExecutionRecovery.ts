import type {
  ProjectAgentFailureItem,
  ProjectAgentHostState,
  ProjectAgentTurn,
} from "../shared/projectAgentContracts";
import {
  CANVAS_WRITE_OUTCOMES,
  readProposalReceiptSafely,
  type ExecutionPartition,
  type ProjectAgentProposalReceiptReader,
} from "./projectAgentExecutionCoordinatorTypes";
import { committedProjectAgentReceiptMatchesApproval } from "./projectAgentProposalReceiptCorrelation";
import { digest } from "./projectAgentExecutionHelpers";
import { desktopT } from "../i18n";

export async function recoverClaimedCanvasExecution(
  partition: ExecutionPartition,
  state: ProjectAgentHostState,
  turn: ProjectAgentTurn,
  readProposalReceipt: ProjectAgentProposalReceiptReader | undefined,
  now: () => string,
): Promise<boolean> {
  const approvals = state.proposalApprovals.filter(
    (candidate) => candidate.lifecycle === "claimed"
      && candidate.ref.turnId === turn.turnId
      && candidate.ref.target.kind === "canvas",
  );
  if (approvals.length === 0) return false;
  const queueItem = state.queue.find((candidate) => candidate.turnId === turn.turnId);
  const assistant = state.items.find(
    (candidate) => candidate.kind === "assistant" && candidate.turnId === turn.turnId && candidate.status === "running",
  );
  if (!queueItem || !assistant || assistant.kind !== "assistant") return false;
  const receipt = readProposalReceiptSafely(readProposalReceipt);
  const matchingApprovals = approvals.filter((approval) =>
    committedProjectAgentReceiptMatchesApproval(partition.binding, receipt, approval.ref));
  const latestApproval = approvals.at(-1)!;
  const matchedApprovalIndex = matchingApprovals.length === 1
    ? approvals.findIndex((approval) => approval.ref.approvalId === matchingApprovals[0].ref.approvalId)
    : -1;
  const matched = matchedApprovalIndex === approvals.length - 1;
  const recoveredAt = now();
  const failure: ProjectAgentFailureItem | undefined = matched
    ? undefined
    : Object.freeze({
        itemId: `failure-${digest([partition.binding, turn.executionToken, "capability_receipt_unresolved"])}`,
        threadId: turn.threadId,
        turnId: turn.turnId,
        correlationId: latestApproval.ref.toolCallId,
        kind: "failure" as const,
        code: "capability_receipt_unresolved",
        message: "capability_receipt_unresolved",
        nextAction: CANVAS_WRITE_OUTCOMES.capability_receipt_unresolved.nextAction,
        status: "failed" as const,
        retryable: false,
        deviated: false,
        createdAt: recoveredAt,
        updatedAt: recoveredAt,
      });
  await partition.host.dispatch({
    commandId: `canvas-receipt-recover-${turn.executionToken}`,
    expectedRevision: state.hostRevision,
    binding: partition.binding,
    sender: { kind: "internal", senderId: "execution-recovery" },
    type: "async.result",
    payload: {
      asyncToken: turn.executionToken,
      binding: partition.binding,
      threadId: turn.threadId,
      turnId: turn.turnId,
      queueItemId: queueItem.queueItemId,
      target: queueItem.target,
      preconditions: queueItem.preconditions,
      expectedRevision: state.hostRevision,
      items: failure ? [failure] : [],
      turnStatus: matched ? "done" : "failed",
      retryable: false,
      proposalSettlements: approvals.map((approval, index) => ({
        approvalId: approval.ref.approvalId,
        status: index <= matchedApprovalIndex ? "done" : "failed",
      })),
      assistantFinal: {
        itemId: assistant.itemId,
        executionToken: turn.executionToken,
        expectedTextRevision: assistant.textRevision,
        text: assistant.text,
      },
      receivedAt: recoveredAt,
    },
  });
  return true;
}

export async function recoverOrphanedExecutions(
  partition: ExecutionPartition,
  readProposalReceipt: ProjectAgentProposalReceiptReader | undefined,
  now: () => string,
): Promise<void> {
  while (true) {
    const state = partition.host.getSnapshot(partition.binding);
    const turn = state.turns.find((candidate) => {
      if (!["queued", "running", "proposed"].includes(candidate.status)) return false;
      if (candidate.status !== "queued") return true;
      const queueItem = state.queue.find((item) => item.turnId === candidate.turnId);
      return queueItem?.paused !== true;
    });
    if (!turn) return;
    if (await recoverClaimedCanvasExecution(partition, state, turn, readProposalReceipt, now)) continue;
    const recoveredAt = now();
    await partition.host.dispatch({
      commandId: `execution-recover-${turn.executionToken}`,
      expectedRevision: state.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: "execution-recovery" },
      type: "execution.recover",
      payload: {
        turnId: turn.turnId,
        failure: Object.freeze({
          itemId: `failure-${digest([partition.binding, turn.executionToken, "process-restart"])}`,
          threadId: turn.threadId,
          turnId: turn.turnId,
          kind: "failure" as const,
          code: "execution_recovery_required",
          message: desktopT("agent.processInterrupted"),
          status: "failed" as const,
          retryable: true,
          deviated: false,
          createdAt: recoveredAt,
          updatedAt: recoveredAt,
        }),
        recoveredAt,
      },
    });
  }
}
