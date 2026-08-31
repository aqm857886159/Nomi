import type { ProjectAgentChange, ProjectAgentHostState } from "../shared/projectAgentContracts";
import { ProjectAgentStateError } from "./projectAgentStateError";

function invalid(): never {
  throw new ProjectAgentStateError("invalid_state");
}

function assertCollectionDelta<T extends object>(
  previous: readonly T[],
  next: readonly T[],
  upserts: readonly T[],
  removedIds: readonly string[],
  readId: (value: T) => string,
  options: Readonly<{ allowReorder?: boolean }> = {},
): void {
  const previousById = new Map(previous.map((value) => [readId(value), value]));
  const nextById = new Map(next.map((value) => [readId(value), value]));
  const upsertById = new Map(upserts.map((value) => [readId(value), value]));
  const removed = new Set(removedIds);
  if (
    previousById.size !== previous.length ||
    nextById.size !== next.length ||
    upsertById.size !== upserts.length ||
    removed.size !== removedIds.length
  ) {
    invalid();
  }
  for (const id of removed) {
    if (!previousById.has(id) || nextById.has(id) || upsertById.has(id)) invalid();
  }
  for (const id of upsertById.keys()) {
    if (!nextById.has(id) || removed.has(id)) invalid();
  }
  const expectedIds = previous.map(readId).filter((id) => !removed.has(id));
  for (const value of upserts) {
    const id = readId(value);
    if (!previousById.has(id)) expectedIds.push(id);
  }
  if (expectedIds.length !== next.length) invalid();
  if (options.allowReorder) {
    const expectedSet = new Set(expectedIds);
    if (expectedSet.size !== next.length || next.some((value) => !expectedSet.has(readId(value)))) invalid();
  } else if (expectedIds.some((id, index) => readId(next[index]!) !== id)) {
    invalid();
  }
  for (const value of next) {
    const id = readId(value);
    if (!upsertById.has(id) && previousById.get(id) !== value) invalid();
  }
}

export function assertTrustedProjectAgentDeltaCoverage(
  previous: ProjectAgentHostState,
  next: Omit<ProjectAgentHostState, "hostRevision" | "commandLedgerHighWater" | "recentAppliedCommands">,
  changes: readonly ProjectAgentChange[],
): void {
  const threads = changes.flatMap((change) => (change.kind === "thread-upserted" ? [change.thread] : []));
  const removedThreads = changes.flatMap((change) => (change.kind === "thread-removed" ? [change.threadId] : []));
  const turns = changes.flatMap((change) => (change.kind === "turn-upserted" ? [change.turn] : []));
  const removedTurns = changes.flatMap((change) => (change.kind === "turn-removed" ? [change.turnId] : []));
  const items = changes.flatMap((change) => (change.kind === "item-upserted" ? [change.item] : []));
  const removedItems = changes.flatMap((change) => (change.kind === "item-removed" ? [change.itemId] : []));
  const queue = changes.flatMap((change) => (change.kind === "queue-upserted" ? [change.queueItem] : []));
  const removedQueue = changes.flatMap((change) => (change.kind === "queue-removed" ? [change.queueItemId] : []));
  const queueReorders = changes.flatMap((change) => (change.kind === "queue-reordered" ? [change.queueItemIds] : []));
  const proposals = changes.flatMap((change) => (change.kind === "proposal-upserted" ? [change.approval] : []));
  const removedProposals = changes.flatMap((change) => (change.kind === "proposal-removed" ? [change.approvalId] : []));
  assertCollectionDelta(previous.threads, next.threads, threads, removedThreads, (value) => value.threadId);
  assertCollectionDelta(previous.turns, next.turns, turns, removedTurns, (value) => value.turnId);
  assertCollectionDelta(previous.items, next.items, items, removedItems, (value) => value.itemId);
  if (queueReorders.length > 1) invalid();
  if (queueReorders.length === 1) {
    const ids = queueReorders[0]!;
    if (
      ids.length !== next.queue.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => next.queue[index]?.queueItemId !== id)
    ) {
      invalid();
    }
  }
  assertCollectionDelta(previous.queue, next.queue, queue, removedQueue, (value) => value.queueItemId, {
    allowReorder: queueReorders.length === 1,
  });
  assertCollectionDelta(
    previous.proposalApprovals,
    next.proposalApprovals,
    proposals,
    removedProposals,
    (value) => value.ref.approvalId,
  );
}
