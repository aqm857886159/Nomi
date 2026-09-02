import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectAgentChange, ProjectAgentHostState, ProjectAgentThread } from "../shared/projectAgentContracts";
import { projectAgentApprovalPolicyOf, projectAgentWorkModeOf } from "../shared/projectAgentContracts";
import { assertProjectAgentAssistantLifecycle } from "./projectAgentAssistantStateInvariant";
import { stableProjectAgentJson } from "./projectAgentSnapshot";
import { ProjectAgentStateError } from "./projectAgentStateError";
import {
  hasDuplicateProjectAgentApprovalIdentity,
  hasDuplicateProjectAgentArtifactIdentity,
  hasDuplicateProjectAgentProposalReceiptIdentity,
  hasDuplicateProjectAgentToolIdentity,
} from "./projectAgentSemanticIdentity";

type AssertPatchChange = (
  value: unknown,
  binding: ProjectBinding,
  threadIds: ReadonlySet<string>,
  turnIds: ReadonlySet<string>,
  turnThreadById: ReadonlyMap<string, string>,
  itemTurnById: ReadonlyMap<string, string>,
) => void;

export function assertTrustedProjectAgentDelta(
  next: Omit<ProjectAgentHostState, "hostRevision" | "commandLedgerHighWater" | "recentAppliedCommands">,
  changes: readonly ProjectAgentChange[],
  assertThread: (value: unknown) => asserts value is ProjectAgentThread,
  assertPatchChange: AssertPatchChange,
): void {
  if (next.activeThreadId !== null && !next.threads.some((thread) => thread.threadId === next.activeThreadId)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (hasDuplicateProjectAgentToolIdentity(next.items)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (hasDuplicateProjectAgentArtifactIdentity(next.items)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (hasDuplicateProjectAgentProposalReceiptIdentity(next.items)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (hasDuplicateProjectAgentApprovalIdentity(next.proposalApprovals)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (changes.every((change) => change.kind === "thread-upserted")) {
    for (const change of changes) {
      if (change.kind !== "thread-upserted") continue;
      assertThread(change.thread);
      const actual = next.threads.find((thread) => thread.threadId === change.thread.threadId);
      if (
        !actual ||
        !Object.isFrozen(actual) ||
        stableProjectAgentJson(actual) !== stableProjectAgentJson(change.thread)
      ) {
        throw new ProjectAgentStateError("invalid_state");
      }
    }
    return;
  }

  const threadIds = new Set(next.threads.map((thread) => thread.threadId));
  const turnIds = new Set(next.turns.map((turn) => turn.turnId));
  const turnThreadById = new Map(next.turns.map((turn) => [turn.turnId, turn.threadId]));
  const itemTurnById = new Map(next.items.map((item) => [item.itemId, item.turnId]));
  for (const change of changes) {
    assertPatchChange(change, next.binding, threadIds, turnIds, turnThreadById, itemTurnById);
    let actual: object | undefined;
    let described: object | undefined;
    switch (change.kind) {
      case "thread-upserted":
        actual = next.threads.find((thread) => thread.threadId === change.thread.threadId);
        described = change.thread;
        break;
      case "thread-removed":
        if (next.threads.some((thread) => thread.threadId === change.threadId)) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
      case "active-thread-changed":
        if (next.activeThreadId !== change.activeThreadId) throw new ProjectAgentStateError("invalid_state");
        continue;
      case "turn-upserted":
        actual = next.turns.find((turn) => turn.turnId === change.turn.turnId);
        described = change.turn;
        break;
      case "turn-removed":
        if (next.turns.some((turn) => turn.turnId === change.turnId)) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
      case "item-upserted":
        actual = next.items.find((item) => item.itemId === change.item.itemId);
        described = change.item;
        break;
      case "item-removed":
        if (next.items.some((item) => item.itemId === change.itemId)) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
      case "queue-upserted":
        actual = next.queue.find((item) => item.queueItemId === change.queueItem.queueItemId);
        described = change.queueItem;
        break;
      case "queue-removed":
        if (next.queue.some((item) => item.queueItemId === change.queueItemId)) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
      case "queue-reordered":
        if (
          change.queueItemIds.length !== next.queue.length ||
          change.queueItemIds.some((queueItemId, index) => next.queue[index]?.queueItemId !== queueItemId)
        ) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
      case "proposal-upserted":
        actual = next.proposalApprovals.find((approval) => approval.ref.approvalId === change.approval.ref.approvalId);
        described = change.approval;
        break;
      case "proposal-removed":
        if (next.proposalApprovals.some((approval) => approval.ref.approvalId === change.approvalId)) {
          throw new ProjectAgentStateError("invalid_state");
        }
        continue;
    }
    if (
      !actual ||
      !described ||
      !Object.isFrozen(actual) ||
      stableProjectAgentJson(actual) !== stableProjectAgentJson(described)
    ) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
  const mirroredTurnIds = new Set(
    changes.flatMap((change) => {
      if (change.kind === "turn-upserted") return [change.turn.turnId];
      if (change.kind === "queue-upserted") return [change.queueItem.turnId];
      return [];
    }),
  );
  if (
    changes.some((change) => change.kind === "turn-upserted" && change.turn.status === "running") &&
    next.turns.filter((turn) => turn.status === "running").length > 1
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }
  const assistantTurnIds = new Set(
    changes.flatMap((change) => {
      if (change.kind === "turn-upserted") return [change.turn.turnId];
      if (change.kind === "item-upserted" && change.item.kind === "assistant") return [change.item.turnId];
      return [];
    }),
  );
  assertProjectAgentAssistantLifecycle(next.turns, next.items, assistantTurnIds);
  for (const turnId of mirroredTurnIds) {
    const turn = next.turns.find((value) => value.turnId === turnId);
    const queueItem = next.queue.find((item) => item.turnId === turnId);
    if (
      !turn ||
      !queueItem ||
      queueItem.threadId !== turn.threadId ||
      queueItem.status !== turn.status ||
      queueItem.retryable !== turn.retryable ||
      queueItem.deviated !== turn.deviated ||
      queueItem.updatedAt !== turn.updatedAt ||
      stableProjectAgentJson(projectAgentApprovalPolicyOf(queueItem.approvalPolicy)) !==
        stableProjectAgentJson(projectAgentApprovalPolicyOf(turn.approvalPolicy)) ||
      stableProjectAgentJson(queueItem.contextRef) !== stableProjectAgentJson(turn.contextRef) ||
      stableProjectAgentJson(queueItem.model) !== stableProjectAgentJson(turn.model) ||
      projectAgentWorkModeOf(queueItem.workMode) !== projectAgentWorkModeOf(turn.workMode) ||
      stableProjectAgentJson(queueItem.skillVersions) !== stableProjectAgentJson(turn.skillVersions) ||
      stableProjectAgentJson(queueItem.capabilityVersions) !== stableProjectAgentJson(turn.capabilityVersions)
    ) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
}
