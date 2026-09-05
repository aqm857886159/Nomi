import {
  reduceProjectAgentThreadMutation,
} from "./projectAgentThreadReduction";
import type {
  ProjectAgentAppliedCommand,
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentMutation,
  ProjectAgentPatch,
  ProjectAgentStatus,
  ProjectAgentTurn,
} from "../shared/projectAgentContracts";
import { ProjectAgentReducerError, type ProjectAgentReducerErrorCode } from "./projectAgentReducerContract";
import {
  reduceProjectAgentProposalPut,
  reduceProjectAgentProposalTransition,
} from "./projectAgentProposalReduction";
import { assertCanAppendProjectAgentItem } from "./projectAgentItemSemantics";
import {
  assertCanonicalMutationTimestamp,
  assertExactMutationKeys,
  assertOptionalMutationBoolean,
  assertProjectAgentMutationEnvelope,
  hashProjectAgentMutation,
} from "./projectAgentMutationValidation";
import { assertProjectAgentUsage } from "./projectAgentStateValidationPrimitives";
import { assertProjectAgentRuntimeContext } from "./projectAgentRuntimeContextValidation";
import type { ProjectAgentReduction } from "./projectAgentReduction";
import {
  isProjectAgentAbortStatus,
  isProjectAgentAsyncTurnStatus,
  isProjectAgentProposalSettlementStatus,
} from "./projectAgentStatusSemantics";
import {
  appendTrustedProjectAgentHostState,
  findTrustedProjectAgentAppliedCommand,
  freezeProjectAgentSnapshot,
  sameProjectAgentBinding,
  snapshotProjectAgentHostState,
  stableProjectAgentJson,
} from "./projectAgentState";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";
import { reduceProjectAgentAssistantAppend } from "./projectAgentAssistantAppendReduction";
import {
  reduceProjectAgentAssistantFinal,
  reduceProjectAgentAssistantTerminal,
} from "./projectAgentAssistantFinalReduction";
import { reduceProjectAgentQueueEdit } from "./projectAgentQueueEditReduction";
import { reduceProjectAgentQueueMutation } from "./projectAgentQueueMutationReduction";
import { reduceProjectAgentTurnStart } from "./projectAgentTurnStartReduction";
import {
  assertStatusTransition,
  findQueueForTurn,
  findTurn,
  replaceById,
  transitionRecord,
  updateProposalItems,
} from "./projectAgentRecordReduction";
export {
  PROJECT_AGENT_REDUCER_ERROR_CODES,
  ProjectAgentReducerError,
  isProjectAgentStatusTransition,
} from "./projectAgentReducerContract";
export type { ProjectAgentReducerErrorCode } from "./projectAgentReducerContract";
export { hashProjectAgentMutation } from "./projectAgentMutationValidation";
export { replayProjectAgentCompactCommand } from "./projectAgentCompactReplay";
export type { ProjectAgentReduction } from "./projectAgentReduction";
function fail(code: ProjectAgentReducerErrorCode): never {
  throw new ProjectAgentReducerError(code);
}

function finalizeReduction(
  current: ProjectAgentHostState,
  mutation: ProjectAgentMutation,
  hash: string,
  next: Omit<ProjectAgentHostState, "hostRevision" | "commandLedgerHighWater" | "recentAppliedCommands">,
  changes: readonly ProjectAgentChange[],
): ProjectAgentReduction {
  const hostRevision = current.hostRevision + 1;
  const patch = freezeProjectAgentSnapshot<ProjectAgentPatch>({
    binding: current.binding,
    previousRevision: current.hostRevision,
    hostRevision,
    changes,
  });
  const receipt = freezeProjectAgentSnapshot<ProjectAgentAppliedCommand>({
    commandId: mutation.commandId,
    mutationHash: hash,
    appliedRevision: hostRevision,
    patch,
  });
  const state = appendTrustedProjectAgentHostState(current, next, receipt);
  const durableReceipt = state.recentAppliedCommands[state.recentAppliedCommands.length - 1]!;
  return Object.freeze({
    state,
    patch: durableReceipt.patch,
    receipt: durableReceipt,
    replayed: false,
    snapshotRequired: false,
  });
}

export function reduceProjectAgentMutation(
  inputState: ProjectAgentHostState,
  inputMutation: ProjectAgentMutation,
): ProjectAgentReduction {
  const current = snapshotProjectAgentHostState(inputState);
  let mutation: ProjectAgentMutation;
  try {
    mutation = freezeProjectAgentSnapshot(inputMutation);
  } catch {
    fail("invalid_mutation");
  }
  assertProjectAgentMutationEnvelope(mutation);
  if (!sameProjectAgentBinding(current.binding, mutation.binding)) {
    fail("project_binding_mismatch");
  }

  const hash = hashProjectAgentMutation(mutation);
  const existing = findTrustedProjectAgentAppliedCommand(current, mutation.commandId);
  if (existing) {
    if (existing.mutationHash !== hash) fail("command_id_conflict");
    return Object.freeze({
      state: current,
      patch: existing.patch,
      receipt: existing,
      replayed: true,
      snapshotRequired: false,
    });
  }
  if (mutation.expectedRevision !== current.hostRevision) fail("revision_conflict");

  let activeThreadId = current.activeThreadId;
  let threads = current.threads;
  let turns = current.turns;
  let items = current.items;
  let queue = current.queue;
  let proposalApprovals = current.proposalApprovals;
  const changes: ProjectAgentChange[] = [];

  try {
    switch (mutation.type) {
      case "thread.put":
      case "thread.remove":
      case "thread.activate":
      case "turn.enqueue": {
        const reduced = reduceProjectAgentThreadMutation(current, mutation);
        activeThreadId = reduced.activeThreadId;
        threads = reduced.threads;
        turns = reduced.turns;
        items = reduced.items;
        queue = reduced.queue;
        proposalApprovals = reduced.proposalApprovals;
        changes.push(...reduced.changes);
        break;
      }
      case "queue.edit": {
        const edited = reduceProjectAgentQueueEdit(current, mutation);
        turns = edited.turns;
        items = edited.items;
        queue = edited.queue;
        changes.push(...edited.changes);
        break;
      }
      case "queue.delete":
      case "queue.move_up":
      case "queue.move_down":
      case "queue.pause":
      case "queue.resume": {
        const reduced = reduceProjectAgentQueueMutation(current, mutation);
        turns = reduced.turns;
        items = reduced.items;
        queue = reduced.queue;
        changes.push(...reduced.changes);
        break;
      }
      case "turn.start": {
        const started = reduceProjectAgentTurnStart(current, mutation);
        turns = started.turns;
        items = started.items;
        queue = started.queue;
        changes.push(...started.changes);
        break;
      }
      case "assistant.append": {
        const appended = reduceProjectAgentAssistantAppend(current, mutation);
        items = appended.items;
        changes.push(...appended.changes);
        break;
      }
      case "turn.transition": {
        assertExactMutationKeys(mutation.payload, ["turnId", "status", "retryable", "deviated", "updatedAt"]);
        const turn = findTurn(current, mutation.payload.turnId);
        const queueItem = findQueueForTurn(queue, turn.turnId);
        const hasPendingApproval = proposalApprovals.some(
          (approval) => approval.ref.turnId === turn.turnId && approval.lifecycle === "pending",
        );
        const hasClaimedApproval = proposalApprovals.some(
          (approval) => approval.ref.turnId === turn.turnId && approval.lifecycle === "claimed",
        );
        if (
          mutation.payload.status === "proposed" ||
          (hasClaimedApproval && mutation.payload.status !== "stopped" && mutation.payload.status !== "failed") ||
          (hasPendingApproval && !isProjectAgentAbortStatus(mutation.payload.status))
        ) {
          fail("proposal_transition_invalid");
        }
        if (mutation.payload.status === "running") fail("status_transition_invalid");
        if (
          turn.status === "running" &&
          !isProjectAgentAbortStatus(mutation.payload.status) &&
          items.some((item) => item.kind === "assistant" && item.turnId === turn.turnId && item.status === "running")
        ) {
          fail("status_transition_invalid");
        }
        const updatedTurn = transitionRecord(turn, mutation.payload);
        const updatedQueue = transitionRecord(queueItem, mutation.payload);
        turns = replaceById(
          turns,
          turn.turnId,
          (value) => value.turnId,
          () => updatedTurn,
        );
        queue = replaceById(
          queue,
          queueItem.queueItemId,
          (value) => value.queueItemId,
          () => updatedQueue,
        );
        changes.push({ kind: "turn-upserted", turn: updatedTurn }, { kind: "queue-upserted", queueItem: updatedQueue });
        if (isProjectAgentAbortStatus(mutation.payload.status)) {
          const removed = proposalApprovals.filter(
            (approval) => approval.ref.turnId === turn.turnId && approval.lifecycle === "pending",
          );
          for (const approval of removed) {
            const terminalItems = updateProposalItems(
              items,
              approval.ref.approvalId,
              mutation.payload.status,
              mutation.payload.updatedAt,
              mutation.payload.retryable,
            );
            items = terminalItems.items;
            changes.push(...terminalItems.changes);
          }
          proposalApprovals = proposalApprovals.filter((approval) => !removed.includes(approval));
          changes.push(
            ...removed.map(
              (approval): ProjectAgentChange => ({
                kind: "proposal-removed",
                approvalId: approval.ref.approvalId,
              }),
            ),
          );
          const claimed = proposalApprovals.filter(
            (approval) => approval.ref.turnId === turn.turnId && approval.lifecycle === "claimed",
          );
          for (const approval of claimed) {
            const terminalItems = updateProposalItems(
              items,
              approval.ref.approvalId,
              mutation.payload.status,
              mutation.payload.updatedAt,
              mutation.payload.retryable,
            );
            items = terminalItems.items;
            changes.push(...terminalItems.changes);
          }
          const terminalAssistant = reduceProjectAgentAssistantTerminal(
            items,
            turn.turnId,
            mutation.payload.status,
            mutation.payload.updatedAt,
          );
          items = terminalAssistant.items;
          changes.push(...terminalAssistant.changes);
        }
        break;
      }
      case "execution.recover": {
        if (mutation.sender.kind !== "internal" || mutation.sender.senderId !== "execution-recovery") {
          fail("invalid_mutation");
        }
        assertExactMutationKeys(mutation.payload, ["turnId", "failure", "recoveredAt"]);
        const { failure, recoveredAt } = mutation.payload;
        assertCanonicalMutationTimestamp(recoveredAt);
        const turn = findTurn(current, mutation.payload.turnId);
        const queueItem = findQueueForTurn(queue, turn.turnId);
        if (
          !["queued", "running", "proposed"].includes(turn.status) ||
          queueItem.status !== turn.status ||
          failure.kind !== "failure" ||
          failure.threadId !== turn.threadId ||
          failure.turnId !== turn.turnId ||
          failure.code !== "execution_recovery_required" ||
          failure.status !== "failed" ||
          !failure.retryable ||
          failure.deviated ||
          failure.createdAt !== recoveredAt ||
          failure.updatedAt !== recoveredAt
        ) {
          fail("invalid_mutation");
        }
        assertCanAppendProjectAgentItem(items, failure, false);
        const updatedTurn = transitionRecord(turn, {
          status: "failed",
          retryable: true,
          updatedAt: recoveredAt,
        });
        const updatedQueue = transitionRecord(queueItem, {
          status: "failed",
          retryable: true,
          updatedAt: recoveredAt,
        });
        turns = replaceById(
          turns,
          turn.turnId,
          (value) => value.turnId,
          () => updatedTurn,
        );
        queue = replaceById(
          queue,
          queueItem.queueItemId,
          (value) => value.queueItemId,
          () => updatedQueue,
        );
        const approvals = proposalApprovals.filter((approval) => approval.ref.turnId === turn.turnId);
        for (const approval of approvals) {
          const terminalItems = updateProposalItems(items, approval.ref.approvalId, "failed", recoveredAt, true);
          items = terminalItems.items;
          changes.push(...terminalItems.changes);
        }
        const removed = approvals.filter((approval) => approval.lifecycle === "pending");
        proposalApprovals = proposalApprovals.filter((approval) => !removed.includes(approval));
        changes.push(
          ...removed.map(
            (approval): ProjectAgentChange => ({
              kind: "proposal-removed",
              approvalId: approval.ref.approvalId,
            }),
          ),
        );
        const terminalAssistant = reduceProjectAgentAssistantTerminal(items, turn.turnId, "failed", recoveredAt);
        items = [...terminalAssistant.items, failure];
        changes.push(
          ...terminalAssistant.changes,
          { kind: "turn-upserted", turn: updatedTurn },
          { kind: "queue-upserted", queueItem: updatedQueue },
          { kind: "item-upserted", item: failure },
        );
        break;
      }
      case "item.put": {
        assertExactMutationKeys(mutation.payload, ["item"]);
        const { item } = mutation.payload;
        assertCanAppendProjectAgentItem(items, item, false);
        items = [...items, item];
        changes.push({ kind: "item-upserted", item });
        break;
      }
      case "item.transition": {
        assertExactMutationKeys(mutation.payload, ["itemId", "status", "retryable", "deviated", "updatedAt"]);
        const existingItem = items.find((value) => value.itemId === mutation.payload.itemId);
        if (!existingItem) fail("record_not_found");
        if (existingItem.kind === "task" || existingItem.kind === "proposal" || existingItem.kind === "assistant") {
          fail("foreign_domain_state");
        }
        const updated = transitionRecord(existingItem, mutation.payload);
        items = replaceById(
          items,
          existingItem.itemId,
          (value) => value.itemId,
          () => updated,
        );
        changes.push({ kind: "item-upserted", item: updated });
        break;
      }
      case "proposal.put":
      case "proposal.transition": {
        const reduced =
          mutation.type === "proposal.put"
            ? reduceProjectAgentProposalPut(current, mutation)
            : reduceProjectAgentProposalTransition(current, mutation);
        turns = reduced.turns;
        items = reduced.items;
        queue = reduced.queue;
        proposalApprovals = reduced.proposalApprovals;
        changes.push(...reduced.changes);
        break;
      }
      case "async.result": {
        if (mutation.sender.kind !== "embedded-agent" && mutation.sender.kind !== "internal") {
          fail("invalid_mutation");
        }
        assertExactMutationKeys(mutation.payload, [
          "asyncToken",
          "binding",
          "threadId",
          "turnId",
          "queueItemId",
          "target",
          "preconditions",
          "expectedRevision",
          "items",
          "turnStatus",
          "usage",
          "runtimeContext",
          "retryable",
          "proposalApprovalId",
          "proposalStatus",
          "proposalSettlements",
          "assistantFinal",
          "receivedAt",
        ]);
        const result = mutation.payload;
        assertCanonicalMutationTimestamp(result.receivedAt);
        assertOptionalMutationBoolean(result.retryable);
        if (result.runtimeContext !== undefined) { try { assertProjectAgentRuntimeContext(result.runtimeContext); } catch { fail("async_result_stale"); } }
        if (result.usage !== undefined) {
          try {
            assertProjectAgentUsage(result.usage);
          } catch {
            fail("async_result_stale");
          }
        }
        assertExactMutationKeys(result.binding, ["projectId", "immutableProjectUuid", "projectGeneration"]);
        if (
          result.expectedRevision !== mutation.expectedRevision ||
          !sameProjectAgentBinding(result.binding, current.binding) ||
          !isProjectAgentAsyncTurnStatus(result.turnStatus)
        ) {
          fail("async_result_stale");
        }
        const turn = findTurn(current, result.turnId);
        const queueItem = findQueueForTurn(queue, result.turnId);
        if (
          turn.threadId !== result.threadId ||
          queueItem.queueItemId !== result.queueItemId ||
          turn.executionToken !== result.asyncToken ||
          turn.status !== "running" ||
          new Date(result.receivedAt).getTime() < new Date(turn.updatedAt).getTime() ||
          stableProjectAgentJson(queueItem.target) !== stableProjectAgentJson(result.target) ||
          stableProjectAgentJson(queueItem.preconditions) !== stableProjectAgentJson(result.preconditions)
        ) {
          fail("async_result_stale");
        }
        if (turn.status !== result.turnStatus) {
          assertStatusTransition(turn.status, result.turnStatus);
        } else if (result.turnStatus !== "running") {
          fail("status_transition_invalid");
        }
        const prospectiveItems = [...items];
        for (const item of result.items) {
          if (item.threadId !== result.threadId || item.turnId !== result.turnId) {
            fail("async_result_stale");
          }
          assertCanAppendProjectAgentItem(prospectiveItems, item, false, true);
          prospectiveItems.push(item);
        }
        const terminalRetryable = result.retryable ?? result.turnStatus === "failed";
        if (
          result.items.some(
            (item) =>
              item.kind === "failure" && (item.status !== result.turnStatus || item.retryable !== terminalRetryable),
          )
        ) {
          fail("async_result_stale");
        }
        const runningProposalIds = items.flatMap((item) =>
          item.kind === "proposal" && item.approval && item.status === "running" ? [item.approval.approvalId] : [],
        );
        const hasProposalApprovalId = result.proposalApprovalId !== undefined;
        const hasProposalStatus = result.proposalStatus !== undefined;
        const hasProposalSettlements = result.proposalSettlements !== undefined;
        if (hasProposalApprovalId !== hasProposalStatus || (hasProposalApprovalId && hasProposalSettlements)) {
          fail("async_result_stale");
        }
        let proposalSettlements: readonly Readonly<{ approvalId: string; status: ProjectAgentStatus }>[] = [];
        if (hasProposalSettlements) {
          if (!Array.isArray(result.proposalSettlements)) fail("async_result_stale");
          proposalSettlements = result.proposalSettlements;
        } else if (hasProposalApprovalId && result.proposalApprovalId && result.proposalStatus) {
          proposalSettlements = [{ approvalId: result.proposalApprovalId, status: result.proposalStatus }];
        }
        if (
          proposalSettlements.length !== runningProposalIds.length ||
          new Set(proposalSettlements.map((settlement) => settlement.approvalId)).size !== proposalSettlements.length ||
          proposalSettlements.some(
            (settlement) =>
              !settlement ||
              typeof settlement !== "object" ||
              Object.keys(settlement).length !== 2 ||
              !Object.hasOwn(settlement, "approvalId") ||
              !Object.hasOwn(settlement, "status") ||
              typeof settlement.approvalId !== "string" ||
              !runningProposalIds.includes(settlement.approvalId) ||
              !isProjectAgentProposalSettlementStatus(settlement.status),
          )
        ) {
          fail("async_result_stale");
        }
        for (const settlement of proposalSettlements) {
          const approval = proposalApprovals.find((value) => value.ref.approvalId === settlement.approvalId);
          if (
            !approval ||
            approval.lifecycle !== "claimed" ||
            approval.ref.turnId !== result.turnId ||
            !runningProposalIds.includes(settlement.approvalId)
          ) {
            fail("async_result_stale");
          }
          const settledProposal = updateProposalItems(
            items,
            settlement.approvalId,
            settlement.status,
            result.receivedAt,
            settlement.status === result.turnStatus ? terminalRetryable : false,
          );
          items = settledProposal.items;
          changes.push(...settledProposal.changes);
        }
        const assistantFinal = reduceProjectAgentAssistantFinal(items, result);
        items = assistantFinal.items;
        changes.push(...assistantFinal.changes);
        const updatedTurnBase = transitionRecord(
          turn,
          {
            status: result.turnStatus,
            retryable: terminalRetryable,
            updatedAt: result.receivedAt,
          },
          true,
        );
        const updatedTurn = freezeProjectAgentIncremental({
          ...updatedTurnBase,
          ...(result.usage !== undefined ? { usage: result.usage } : {}),
          ...(result.runtimeContext !== undefined ? { runtimeContext: result.runtimeContext } : {}),
        }) as ProjectAgentTurn;
        const updatedQueue = transitionRecord(
          queueItem,
          {
            status: result.turnStatus,
            retryable: terminalRetryable,
            updatedAt: result.receivedAt,
          },
          true,
        );
        turns = replaceById(
          turns,
          turn.turnId,
          (value) => value.turnId,
          () => updatedTurn,
        );
        queue = replaceById(
          queue,
          queueItem.queueItemId,
          (value) => value.queueItemId,
          () => updatedQueue,
        );
        items = [...items, ...result.items];
        changes.push(
          ...result.items.map((item): ProjectAgentChange => ({ kind: "item-upserted", item })),
          { kind: "turn-upserted", turn: updatedTurn },
          { kind: "queue-upserted", queueItem: updatedQueue },
        );
        break;
      }
      default:
        fail("invalid_mutation");
    }
  } catch (error) {
    if (error instanceof ProjectAgentReducerError) throw error;
    fail("invalid_mutation");
  }

  try {
    return finalizeReduction(
      current,
      mutation,
      hash,
      {
        binding: current.binding,
        activeThreadId,
        threads,
        turns,
        items,
        queue,
        proposalApprovals,
      },
      changes,
    );
  } catch (error) {
    if (error instanceof ProjectAgentReducerError) throw error;
    fail("invalid_mutation");
  }
}

export type ProjectAgentSerialReducer = Readonly<{
  dispatch: (mutation: ProjectAgentMutation) => Promise<ProjectAgentReduction>;
  getSnapshot: () => ProjectAgentHostState;
}>;

export function createProjectAgentSerialReducer(initialState: ProjectAgentHostState): ProjectAgentSerialReducer {
  let current = snapshotProjectAgentHostState(initialState);
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    dispatch(input: ProjectAgentMutation): Promise<ProjectAgentReduction> {
      let mutation: ProjectAgentMutation;
      try {
        mutation = freezeProjectAgentSnapshot(input);
      } catch {
        return Promise.reject(new ProjectAgentReducerError("invalid_mutation"));
      }
      const operation = tail.then(() => {
        const result = reduceProjectAgentMutation(current, mutation);
        current = result.state;
        return result;
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    getSnapshot(): ProjectAgentHostState {
      return current;
    },
  });
}
