import type {
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import { assertCanonicalMutationTimestamp, assertExactMutationKeys } from "./projectAgentMutationValidation";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";

type QueueEditMutation = Extract<ProjectAgentMutation, { type: "queue.edit" }>;

type QueueEditReduction = Readonly<{
  turns: readonly ProjectAgentTurn[];
  items: ProjectAgentHostState["items"];
  queue: readonly ProjectAgentQueueItem[];
  changes: readonly ProjectAgentChange[];
}>;

function invalid(code: "invalid_mutation" | "record_not_found"): never {
  throw new ProjectAgentReducerError(code);
}

function atOrAfter(candidate: string, current: string): boolean {
  return new Date(candidate).getTime() >= new Date(current).getTime();
}

export function reduceProjectAgentQueueEdit(
  current: ProjectAgentHostState,
  mutation: QueueEditMutation,
): QueueEditReduction {
  assertExactMutationKeys(mutation.payload, ["queueItemId", "userItemId", "text", "occurredAt"]);
  const { queueItemId, userItemId, text, occurredAt } = mutation.payload;
  assertCanonicalMutationTimestamp(occurredAt);
  if (mutation.sender.kind !== "renderer" || typeof text !== "string" || !text.trim()) {
    invalid("invalid_mutation");
  }

  const queueItem = current.queue.find((candidate) => candidate.queueItemId === queueItemId);
  const userItem = current.items.find((candidate) => candidate.itemId === userItemId);
  if (!queueItem || !userItem) invalid("record_not_found");
  const turn = current.turns.find((candidate) => candidate.turnId === queueItem.turnId);
  if (!turn) invalid("record_not_found");
  if (
    userItem.kind !== "user" ||
    userItem.threadId !== queueItem.threadId ||
    userItem.turnId !== queueItem.turnId ||
    turn.threadId !== queueItem.threadId ||
    turn.status !== "queued" ||
    queueItem.status !== "queued" ||
    userItem.text === text ||
    !atOrAfter(occurredAt, userItem.updatedAt) ||
    !atOrAfter(occurredAt, turn.updatedAt) ||
    !atOrAfter(occurredAt, queueItem.updatedAt)
  ) {
    invalid("invalid_mutation");
  }

  const updatedUser = freezeProjectAgentIncremental({
    ...userItem,
    text,
    updatedAt: occurredAt,
  }) as ProjectAgentUserItem;
  const updatedTurn = freezeProjectAgentIncremental({ ...turn, updatedAt: occurredAt }) as ProjectAgentTurn;
  const updatedQueue = freezeProjectAgentIncremental({ ...queueItem, updatedAt: occurredAt }) as ProjectAgentQueueItem;
  return {
    items: current.items.map((item) => (item.itemId === updatedUser.itemId ? updatedUser : item)),
    turns: current.turns.map((candidate) => (candidate.turnId === updatedTurn.turnId ? updatedTurn : candidate)),
    queue: current.queue.map((candidate) =>
      candidate.queueItemId === updatedQueue.queueItemId ? updatedQueue : candidate,
    ),
    changes: [
      { kind: "item-upserted", item: updatedUser },
      { kind: "turn-upserted", turn: updatedTurn },
      { kind: "queue-upserted", queueItem: updatedQueue },
    ],
  };
}
