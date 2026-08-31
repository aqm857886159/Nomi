import type {
  ProjectAgentAssistantItem,
  ProjectAgentChange,
  ProjectAgentHostState,
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
import { isProjectAgentQueueBlockingStatus } from "./projectAgentStatusSemantics";

type TurnStartMutation = Extract<ProjectAgentMutation, { type: "turn.start" }>;

type TurnStartReduction = Readonly<{
  turns: readonly ProjectAgentTurn[];
  items: ProjectAgentHostState["items"];
  queue: readonly ProjectAgentQueueItem[];
  changes: readonly ProjectAgentChange[];
}>;

function fail(code: "invalid_mutation" | "record_exists" | "record_not_found" | "queue_order_violation"): never {
  throw new ProjectAgentReducerError(code);
}

export function reduceProjectAgentTurnStart(
  current: ProjectAgentHostState,
  mutation: TurnStartMutation,
): TurnStartReduction {
  assertExactMutationKeys(mutation.payload, ["turnId", "queueItemId", "assistantItem", "occurredAt"]);
  const { turnId, queueItemId, assistantItem, occurredAt } = mutation.payload;
  assertCanonicalMutationTimestamp(occurredAt);
  if (
    mutation.sender.kind !== "internal" ||
    !isCanonicalProjectAgentId(turnId) ||
    !isCanonicalProjectAgentId(queueItemId) ||
    !assistantItem ||
    typeof assistantItem !== "object"
  ) {
    fail("invalid_mutation");
  }
  const turn = current.turns.find((candidate) => candidate.turnId === turnId);
  const queueItem = current.queue.find((candidate) => candidate.queueItemId === queueItemId);
  if (!turn || !queueItem) fail("record_not_found");
  if (current.turns.some((candidate) => candidate.status === "running")) {
    throw new ProjectAgentReducerError("running_turn_exists");
  }
  const head = current.queue.find(
    (candidate) => isProjectAgentQueueBlockingStatus(candidate.status) && candidate.paused !== true,
  );
  if (!head || head.queueItemId !== queueItemId) fail("queue_order_violation");
  if (
    turn.status !== "queued" ||
    queueItem.status !== "queued" ||
    queueItem.paused === true ||
    queueItem.turnId !== turn.turnId ||
    queueItem.threadId !== turn.threadId ||
    assistantItem.kind !== "assistant" ||
    assistantItem.threadId !== turn.threadId ||
    assistantItem.turnId !== turn.turnId ||
    assistantItem.text !== "" ||
    assistantItem.textRevision !== 0 ||
    assistantItem.status !== "running" ||
    assistantItem.retryable ||
    assistantItem.deviated ||
    assistantItem.createdAt !== occurredAt ||
    assistantItem.updatedAt !== occurredAt ||
    new Date(occurredAt).getTime() < new Date(turn.updatedAt).getTime() ||
    new Date(occurredAt).getTime() < new Date(queueItem.updatedAt).getTime()
  ) {
    fail("invalid_mutation");
  }
  if (
    current.items.some(
      (item) => item.itemId === assistantItem.itemId || (item.kind === "assistant" && item.turnId === turn.turnId),
    )
  ) {
    fail("record_exists");
  }
  const updatedTurn = freezeProjectAgentIncremental({
    ...turn,
    status: "running",
    updatedAt: occurredAt,
  }) as ProjectAgentTurn;
  const updatedQueue = freezeProjectAgentIncremental({
    ...queueItem,
    status: "running",
    updatedAt: occurredAt,
  }) as ProjectAgentQueueItem;
  const frozenAssistant = freezeProjectAgentIncremental(assistantItem) as ProjectAgentAssistantItem;
  return {
    turns: current.turns.map((candidate) => (candidate.turnId === turn.turnId ? updatedTurn : candidate)),
    items: [...current.items, frozenAssistant],
    queue: current.queue.map((candidate) =>
      candidate.queueItemId === queueItem.queueItemId ? updatedQueue : candidate,
    ),
    changes: [
      { kind: "item-upserted", item: frozenAssistant },
      { kind: "turn-upserted", turn: updatedTurn },
      { kind: "queue-upserted", queueItem: updatedQueue },
    ],
  };
}
