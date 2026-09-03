import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectAgentChange, ProjectAgentHostState, ProjectAgentMutation, ProjectAgentProposalApproval, ProjectAgentQueueItem, ProjectAgentThread, ProjectAgentTurn } from "../shared/projectAgentContracts";
import { projectAgentApprovalPolicyOf, projectAgentWorkModeOf } from "../shared/projectAgentContracts";
import { ProjectAgentReducerError, type ProjectAgentReducerErrorCode } from "./projectAgentReducerContract";
import { assertExactMutationKeys, assertCanonicalMutationTimestamp, assertOptionalMutationBoolean, isCanonicalProjectAgentId } from "./projectAgentMutationValidation";
import { reduceProjectAgentThreadActivation } from "./projectAgentThreadActivation";
import { replaceById } from "./projectAgentRecordReduction";
import { sameProjectAgentBinding, stableProjectAgentJson } from "./projectAgentState";
import { isProjectAgentQueueBlockingStatus } from "./projectAgentStatusSemantics";

type ThreadMutation = Extract<ProjectAgentMutation, {
  type: "thread.put" | "thread.remove" | "thread.activate" | "turn.enqueue";
}>;

export type ProjectAgentThreadMutationReduction = Readonly<{
  activeThreadId: string | null;
  threads: readonly ProjectAgentThread[];
  turns: readonly ProjectAgentTurn[];
  items: ProjectAgentHostState["items"];
  queue: ProjectAgentHostState["queue"];
  proposalApprovals: readonly ProjectAgentProposalApproval[];
  changes: readonly ProjectAgentChange[];
}>;

function fail(code: ProjectAgentReducerErrorCode): never {
  throw new ProjectAgentReducerError(code);
}

function assertNoAreaIdentity(thread: ProjectAgentThread): void {
  const record = thread as unknown as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, "area") ||
    Object.prototype.hasOwnProperty.call(record, "legacyArea") ||
    Object.prototype.hasOwnProperty.call(record, "sessionKey")
  ) {
    fail("area_identity_forbidden");
  }
  if (!isCanonicalProjectAgentId(thread.threadId)) fail("invalid_mutation");
}

function assertThreadHistory(existing: ProjectAgentThread | undefined, incoming: ProjectAgentThread): void {
  if (
    existing &&
    (existing.createdAt !== incoming.createdAt ||
      new Date(incoming.updatedAt).getTime() < new Date(existing.updatedAt).getTime())
  ) {
    fail("invalid_mutation");
  }
}

function assertQueueBinding(item: ProjectAgentQueueItem, binding: ProjectBinding): void {
  if (!sameProjectAgentBinding(item.binding, binding)) fail("project_binding_mismatch");
}

export function reduceProjectAgentThreadMutation(
  current: ProjectAgentHostState,
  mutation: ThreadMutation,
): ProjectAgentThreadMutationReduction {
  let activeThreadId = current.activeThreadId;
  let threads = current.threads;
  let turns = current.turns;
  let items = current.items;
  let queue = current.queue;
  let proposalApprovals = current.proposalApprovals;
  const changes: ProjectAgentChange[] = [];

  switch (mutation.type) {
case "thread.put": {
  assertExactMutationKeys(mutation.payload, ["thread", "makeActive"]);
  const { thread, makeActive = false } = mutation.payload;
  assertOptionalMutationBoolean(mutation.payload.makeActive);
  assertNoAreaIdentity(thread);
  const existingThread = threads.find((value) => value.threadId === thread.threadId);
  assertThreadHistory(existingThread, thread);
  threads = existingThread
    ? replaceById(
        threads,
        thread.threadId,
        (value) => value.threadId,
        () => thread,
      )
    : [...threads, thread];
  const previousActiveThreadId = activeThreadId;
  if (makeActive || activeThreadId === null) activeThreadId = thread.threadId;
  changes.push({ kind: "thread-upserted", thread });
  if (activeThreadId !== previousActiveThreadId) {
    changes.push({ kind: "active-thread-changed", activeThreadId });
  }
  break;
}

case "thread.remove": {
  assertExactMutationKeys(mutation.payload, ["threadId", "occurredAt"]);
  assertCanonicalMutationTimestamp(mutation.payload.occurredAt);
  const thread = current.threads.find((value) => value.threadId === mutation.payload.threadId);
  if (!thread) fail("record_not_found");
  if (current.activeThreadId === thread.threadId) fail("thread_read_only");
  if (
    current.turns.some(
      (turn) => turn.threadId === thread.threadId && isProjectAgentQueueBlockingStatus(turn.status),
    )
  ) {
    fail("thread_read_only");
  }
  const turnIds = new Set(
    current.turns.filter((turn) => turn.threadId === thread.threadId).map((turn) => turn.turnId),
  );
  const itemIds = new Set(
    current.items.filter((item) => item.threadId === thread.threadId).map((item) => item.itemId),
  );
  const queueItemIds = new Set(
    current.queue.filter((item) => item.threadId === thread.threadId).map((item) => item.queueItemId),
  );
  const approvalIds = new Set(
    current.proposalApprovals
      .filter((approval) => approval.ref.threadId === thread.threadId)
      .map((approval) => approval.ref.approvalId),
  );
  threads = current.threads.filter((value) => value.threadId !== thread.threadId);
  turns = current.turns.filter((value) => !turnIds.has(value.turnId));
  items = current.items.filter((value) => !itemIds.has(value.itemId));
  queue = current.queue.filter((value) => !queueItemIds.has(value.queueItemId));
  proposalApprovals = current.proposalApprovals.filter((value) => !approvalIds.has(value.ref.approvalId));
  changes.push(
    ...current.items
      .filter((value) => itemIds.has(value.itemId))
      .map((value): ProjectAgentChange => ({ kind: "item-removed", itemId: value.itemId })),
    ...current.queue
      .filter((value) => queueItemIds.has(value.queueItemId))
      .map((value): ProjectAgentChange => ({ kind: "queue-removed", queueItemId: value.queueItemId })),
    ...current.turns
      .filter((value) => turnIds.has(value.turnId))
      .map((value): ProjectAgentChange => ({ kind: "turn-removed", turnId: value.turnId })),
    ...current.proposalApprovals
      .filter((value) => approvalIds.has(value.ref.approvalId))
      .map((value): ProjectAgentChange => ({ kind: "proposal-removed", approvalId: value.ref.approvalId })),
    { kind: "thread-removed", threadId: thread.threadId },
  );
  if (activeThreadId === thread.threadId) {
    activeThreadId = null;
    changes.push({ kind: "active-thread-changed", activeThreadId });
  }
  break;
}

case "thread.activate": {
  const activated = reduceProjectAgentThreadActivation(current, mutation);
  activeThreadId = activated.activeThreadId;
  changes.push(...activated.changes);
  break;
}

case "turn.enqueue": {
  assertExactMutationKeys(mutation.payload, ["thread", "turn", "userItem", "queueItem"]);
  const { thread, turn, userItem, queueItem } = mutation.payload;
  assertNoAreaIdentity(thread);
  if (
    turn.status !== "queued" ||
    queueItem.status !== "queued" ||
    userItem.kind !== "user" ||
    turn.threadId !== thread.threadId ||
    userItem.threadId !== thread.threadId ||
    userItem.turnId !== turn.turnId ||
    queueItem.threadId !== thread.threadId ||
    queueItem.turnId !== turn.turnId ||
    queueItem.retryable !== turn.retryable ||
    queueItem.deviated !== turn.deviated ||
    queueItem.updatedAt !== turn.updatedAt ||
    stableProjectAgentJson(queueItem.contextRef) !== stableProjectAgentJson(turn.contextRef) ||
    stableProjectAgentJson(queueItem.model) !== stableProjectAgentJson(turn.model) ||
    projectAgentWorkModeOf(queueItem.workMode) !== projectAgentWorkModeOf(turn.workMode) ||
    stableProjectAgentJson(projectAgentApprovalPolicyOf(queueItem.approvalPolicy)) !==
      stableProjectAgentJson(projectAgentApprovalPolicyOf(turn.approvalPolicy)) ||
    stableProjectAgentJson(queueItem.skillVersions) !== stableProjectAgentJson(turn.skillVersions) ||
    stableProjectAgentJson(queueItem.capabilityVersions) !== stableProjectAgentJson(turn.capabilityVersions) ||
    turns.some((value) => value.turnId === turn.turnId) ||
    turns.some((value) => value.executionToken === turn.executionToken) ||
    items.some((value) => value.itemId === userItem.itemId) ||
    queue.some((value) => value.queueItemId === queueItem.queueItemId)
  ) {
    fail("record_exists");
  }
  assertQueueBinding(queueItem, current.binding);
  const existingThread = threads.find((value) => value.threadId === thread.threadId);
  assertThreadHistory(existingThread, thread);
  threads = existingThread
    ? replaceById(
        threads,
        thread.threadId,
        (value) => value.threadId,
        () => thread,
      )
    : [...threads, thread];
  turns = [...turns, turn];
  items = [...items, userItem];
  queue = [...queue, queueItem];
  const previousActiveThreadId = activeThreadId;
  activeThreadId = thread.threadId;
  changes.push(
    { kind: "thread-upserted", thread },
    { kind: "turn-upserted", turn },
    { kind: "item-upserted", item: userItem },
    { kind: "queue-upserted", queueItem },
  );
  if (activeThreadId !== previousActiveThreadId) {
    changes.push({ kind: "active-thread-changed", activeThreadId });
  }
  break;
}
  }

  return {
    activeThreadId,
    threads,
    turns,
    items,
    queue,
    proposalApprovals,
    changes,
  };
}
