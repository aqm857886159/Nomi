import type {
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentTurn,
} from "../shared/projectAgentContracts";
import {
  assertCanonicalMutationTimestamp,
  assertExactMutationKeys,
  isCanonicalProjectAgentId,
} from "./projectAgentMutationValidation";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";

type QueueMutation = Extract<
  ProjectAgentMutation,
  { type: "queue.delete" | "queue.move_up" | "queue.move_down" | "queue.pause" | "queue.resume" }
>;

export type ProjectAgentQueueMutationReduction = Readonly<{
  turns: readonly ProjectAgentTurn[];
  items: readonly ProjectAgentItem[];
  queue: readonly ProjectAgentQueueItem[];
  changes: readonly ProjectAgentChange[];
}>;

function fail(code: "invalid_mutation" | "record_not_found" | "queue_order_violation"): never {
  throw new ProjectAgentReducerError(code);
}

function assertQueueMutationEnvelope(mutation: QueueMutation): void {
  assertExactMutationKeys(mutation.payload, ["queueItemId", "occurredAt"]);
  assertCanonicalMutationTimestamp(mutation.payload.occurredAt);
  if (mutation.sender.kind !== "renderer" || !isCanonicalProjectAgentId(mutation.payload.queueItemId)) {
    fail("invalid_mutation");
  }
}

function findQueueAndTurn(
  current: ProjectAgentHostState,
  queueItemId: string,
): { queueItem: ProjectAgentQueueItem; turn: ProjectAgentTurn } {
  const queueItem = current.queue.find((candidate) => candidate.queueItemId === queueItemId);
  if (!queueItem) fail("record_not_found");
  const turn = current.turns.find((candidate) => candidate.turnId === queueItem.turnId);
  if (!turn) fail("record_not_found");
  if (
    queueItem.status !== "queued" ||
    turn.status !== "queued" ||
    queueItem.threadId !== turn.threadId ||
    queueItem.updatedAt !== turn.updatedAt
  ) {
    fail("invalid_mutation");
  }
  return { queueItem, turn };
}

function assertTimestampAtOrAfter(candidate: string, current: string): void {
  if (new Date(candidate).getTime() < new Date(current).getTime()) fail("invalid_mutation");
}

function reduceDelete(
  current: ProjectAgentHostState,
  queueItem: ProjectAgentQueueItem,
  turn: ProjectAgentTurn,
): ProjectAgentQueueMutationReduction {
  const removedItems = current.items.filter((item) => item.turnId === turn.turnId);
  const removedApprovals = current.proposalApprovals.filter((approval) => approval.ref.turnId === turn.turnId);
  return {
    turns: current.turns.filter((candidate) => candidate.turnId !== turn.turnId),
    items: current.items.filter((item) => item.turnId !== turn.turnId),
    queue: current.queue.filter((candidate) => candidate.queueItemId !== queueItem.queueItemId),
    changes: [
      ...removedItems.map((item): ProjectAgentChange => ({ kind: "item-removed", itemId: item.itemId })),
      ...removedApprovals.map(
        (approval): ProjectAgentChange => ({ kind: "proposal-removed", approvalId: approval.ref.approvalId }),
      ),
      { kind: "queue-removed", queueItemId: queueItem.queueItemId },
      { kind: "turn-removed", turnId: turn.turnId },
    ],
  };
}

function reduceMove(
  current: ProjectAgentHostState,
  queueItem: ProjectAgentQueueItem,
  direction: "up" | "down",
): ProjectAgentQueueMutationReduction {
  const queue = [...current.queue];
  const index = queue.findIndex((candidate) => candidate.queueItemId === queueItem.queueItemId);
  if (index < 0) fail("record_not_found");
  const step = direction === "up" ? -1 : 1;
  for (
    let candidateIndex = index + step;
    candidateIndex >= 0 && candidateIndex < queue.length;
    candidateIndex += step
  ) {
    const candidate = queue[candidateIndex]!;
    if (candidate.status === "queued") {
      queue[index] = candidate;
      queue[candidateIndex] = queueItem;
      return {
        turns: current.turns,
        items: current.items,
        queue,
        changes: [{ kind: "queue-reordered", queueItemIds: queue.map((item) => item.queueItemId) }],
      };
    }
    if (candidate.status === "proposed" || candidate.status === "running") fail("queue_order_violation");
  }
  fail("queue_order_violation");
}

function reducePause(
  current: ProjectAgentHostState,
  queueItem: ProjectAgentQueueItem,
  turn: ProjectAgentTurn,
  paused: boolean,
  occurredAt: string,
): ProjectAgentQueueMutationReduction {
  if (paused ? queueItem.paused === true : queueItem.paused !== true) fail("invalid_mutation");
  assertTimestampAtOrAfter(occurredAt, turn.updatedAt);
  assertTimestampAtOrAfter(occurredAt, queueItem.updatedAt);
  const updatedTurn = freezeProjectAgentIncremental({ ...turn, updatedAt: occurredAt }) as ProjectAgentTurn;
  const updatedQueue = freezeProjectAgentIncremental({
    ...queueItem,
    paused,
    updatedAt: occurredAt,
  }) as ProjectAgentQueueItem;
  return {
    turns: current.turns.map((candidate) => (candidate.turnId === turn.turnId ? updatedTurn : candidate)),
    items: current.items,
    queue: current.queue.map((candidate) =>
      candidate.queueItemId === queueItem.queueItemId ? updatedQueue : candidate,
    ),
    changes: [
      { kind: "turn-upserted", turn: updatedTurn },
      { kind: "queue-upserted", queueItem: updatedQueue },
    ],
  };
}

export function reduceProjectAgentQueueMutation(
  current: ProjectAgentHostState,
  mutation: QueueMutation,
): ProjectAgentQueueMutationReduction {
  assertQueueMutationEnvelope(mutation);
  const { queueItemId, occurredAt } = mutation.payload;
  const { queueItem, turn } = findQueueAndTurn(current, queueItemId);
  switch (mutation.type) {
    case "queue.delete":
      return reduceDelete(current, queueItem, turn);
    case "queue.move_up":
      return reduceMove(current, queueItem, "up");
    case "queue.move_down":
      return reduceMove(current, queueItem, "down");
    case "queue.pause":
      return reducePause(current, queueItem, turn, true, occurredAt);
    case "queue.resume":
      return reducePause(current, queueItem, turn, false, occurredAt);
  }
}
