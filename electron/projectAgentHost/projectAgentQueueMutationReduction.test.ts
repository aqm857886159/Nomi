import { describe, expect, it } from "vitest";

import type {
  ProjectAgentAssistantItem,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import { reduceProjectAgentMutation } from "./projectAgentReducer";
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "./projectAgentState";
import { createProjectAgentProjectionStore } from "../../src/workbench/ai/projectAgentProjectionStore";

const initialAt = "2026-08-28T00:00:00.000Z";
const nextAt = "2026-08-28T00:00:01.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;

function context(threadId: string) {
  return {
    binding: {
      project: binding,
      threadId,
      sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}` as const,
    },
    contextRevision: 0,
    recordId: `context-${threadId}`,
  };
}

function records(
  turnId: string,
  queueItemId: string,
): {
  thread: ProjectAgentThread;
  turn: ProjectAgentTurn;
  userItem: ProjectAgentUserItem;
  queueItem: ProjectAgentQueueItem;
} {
  const threadId = "thread-a";
  const contextRef = context(threadId);
  const model = { id: "model-a", version: 1 } as const;
  const turn: ProjectAgentTurn = {
    turnId,
    threadId,
    status: "queued",
    retryable: false,
    deviated: false,
    executionToken: `execution-${turnId}`,
    model,
    skillVersions: [],
    capabilityVersions: [{ id: "generation.plan", version: 1 }],
    contextRef,
    createdAt: initialAt,
    updatedAt: initialAt,
  };
  const userItem: ProjectAgentUserItem = {
    kind: "user",
    itemId: `user-${turnId}`,
    threadId,
    turnId,
    text: `task ${turnId}`,
    status: "done",
    retryable: false,
    deviated: false,
    createdAt: initialAt,
    updatedAt: initialAt,
  };
  const queueItem: ProjectAgentQueueItem = {
    queueItemId,
    threadId,
    turnId,
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target: { kind: "canvas", nodeIds: ["node-a"] },
    preconditions: {},
    contextRef,
    model,
    skillVersions: [],
    capabilityVersions: [{ id: "generation.plan", version: 1 }],
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: initialAt,
    updatedAt: initialAt,
  };
  return {
    thread: { threadId, createdAt: initialAt, updatedAt: initialAt },
    turn,
    userItem,
    queueItem,
  };
}

function enqueue(
  state: ReturnType<typeof createInitialProjectAgentState>,
  turnId: string,
  queueItemId: string,
  commandId: string,
) {
  const value = records(turnId, queueItemId);
  return reduceProjectAgentMutation(state, {
    commandId,
    expectedRevision: state.hostRevision,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: value,
  }).state;
}

function queueMutation(
  state: ReturnType<typeof createInitialProjectAgentState>,
  type: Extract<ProjectAgentMutation["type"], `queue.${string}`>,
  queueItemId: string,
  commandId: string,
  occurredAt = nextAt,
): ProjectAgentMutation {
  return {
    commandId,
    expectedRevision: state.hostRevision,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type,
    payload: { queueItemId, occurredAt },
  } as ProjectAgentMutation;
}

describe("ProjectAgentHost queue mutation seam", () => {
  it("pauses without changing Turn status, blocks start, then resumes", () => {
    const queued = enqueue(createInitialProjectAgentState(binding), "turn-a", "queue-a", "enqueue-a");
    const paused = reduceProjectAgentMutation(queued, queueMutation(queued, "queue.pause", "queue-a", "pause-a")).state;
    expect(paused.turns[0]).toMatchObject({ status: "queued", updatedAt: nextAt });
    expect(paused.queue[0]).toMatchObject({ status: "queued", paused: true, updatedAt: nextAt });
    expect(() =>
      reduceProjectAgentMutation(paused, {
        commandId: "start-paused",
        expectedRevision: paused.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "scheduler" },
        type: "turn.start",
        payload: {
          turnId: "turn-a",
          queueItemId: "queue-a",
          assistantItem: {
            kind: "assistant",
            itemId: "assistant-a",
            threadId: "thread-a",
            turnId: "turn-a",
            status: "running",
            retryable: false,
            deviated: false,
            text: "",
            textRevision: 0,
            createdAt: nextAt,
            updatedAt: nextAt,
          } satisfies ProjectAgentAssistantItem,
          occurredAt: nextAt,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "queue_order_violation" }));
    const resumed = reduceProjectAgentMutation(
      paused,
      queueMutation(paused, "queue.resume", "queue-a", "resume-a", "2026-08-28T00:00:02.000Z"),
    ).state;
    expect(resumed.queue[0]).toMatchObject({ status: "queued", paused: false });
  });

  it("moves queued items with one canonical reorder change", () => {
    let state = createInitialProjectAgentState(binding);
    state = enqueue(state, "turn-a", "queue-a", "enqueue-a");
    state = enqueue(state, "turn-b", "queue-b", "enqueue-b");
    const moved = reduceProjectAgentMutation(state, queueMutation(state, "queue.move_up", "queue-b", "move-up"));
    expect(moved.state.queue.map((item) => item.queueItemId)).toEqual(["queue-b", "queue-a"]);
    expect(moved.patch?.changes).toEqual([{ kind: "queue-reordered", queueItemIds: ["queue-b", "queue-a"] }]);
    const projection = createProjectAgentProjectionStore();
    projection.install("subscription-a", 1, state);
    expect(projection.applyPatch(moved.patch!)).toBe(true);
    expect(projection.getState().snapshot?.queue.map((item) => item.queueItemId)).toEqual(["queue-b", "queue-a"]);
    const movedDown = reduceProjectAgentMutation(
      moved.state,
      queueMutation(moved.state, "queue.move_down", "queue-b", "move-down", "2026-08-28T00:00:02.000Z"),
    );
    expect(movedDown.state.queue.map((item) => item.queueItemId)).toEqual(["queue-a", "queue-b"]);
  });

  it("deletes the queued turn and all linked Host records atomically", () => {
    const queued = enqueue(createInitialProjectAgentState(binding), "turn-a", "queue-a", "enqueue-a");
    const deleted = reduceProjectAgentMutation(queued, queueMutation(queued, "queue.delete", "queue-a", "delete-a"));
    expect(deleted.state.turns).toHaveLength(0);
    expect(deleted.state.queue).toHaveLength(0);
    expect(deleted.state.items).toHaveLength(0);
    expect(deleted.patch?.changes.map((change) => change.kind)).toEqual([
      "item-removed",
      "queue-removed",
      "turn-removed",
    ]);
  });

  it("keeps active turns on the stop path instead of deleting them", () => {
    const queued = enqueue(createInitialProjectAgentState(binding), "turn-a", "queue-a", "enqueue-a");
    const running = reduceProjectAgentMutation(queued, {
      commandId: "start-a",
      expectedRevision: queued.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "scheduler" },
      type: "turn.start",
      payload: {
        turnId: "turn-a",
        queueItemId: "queue-a",
        assistantItem: {
          kind: "assistant",
          itemId: "assistant-a",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "running",
          retryable: false,
          deviated: false,
          text: "",
          textRevision: 0,
          createdAt: nextAt,
          updatedAt: nextAt,
        },
        occurredAt: nextAt,
      },
    }).state;
    expect(() =>
      reduceProjectAgentMutation(
        running,
        queueMutation(running, "queue.delete", "queue-a", "delete-running", "2026-08-28T00:00:02.000Z"),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_mutation" }));
  });

  it("keeps the approval policy axes mirrored and accepts legacy omitted fields", () => {
    const queued = enqueue(createInitialProjectAgentState(binding), "turn-a", "queue-a", "enqueue-a");
    expect(() => snapshotProjectAgentHostState(queued)).not.toThrow();
    expect(() =>
      snapshotProjectAgentHostState({
        ...queued,
        queue: [
          {
            ...queued.queue[0]!,
            approvalPolicy: { mode: "step", spend: "confirm" },
          },
        ],
      }),
    ).toThrow(/invalid_state/);
    expect(() =>
      snapshotProjectAgentHostState({
        ...queued,
        turns: [{ ...queued.turns[0]!, approvalPolicy: { mode: "unsafe", spend: "confirm" } }],
      }),
    ).toThrow(/invalid_state/);
  });

  it("does not move a queued item across an active proposed/running item", () => {
    let state = createInitialProjectAgentState(binding);
    state = enqueue(state, "turn-a", "queue-a", "enqueue-a");
    state = enqueue(state, "turn-b", "queue-b", "enqueue-b");
    const running = reduceProjectAgentMutation(state, {
      commandId: "start-a",
      expectedRevision: state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "scheduler" },
      type: "turn.start",
      payload: {
        turnId: "turn-a",
        queueItemId: "queue-a",
        assistantItem: {
          kind: "assistant",
          itemId: "assistant-a",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "running",
          retryable: false,
          deviated: false,
          text: "",
          textRevision: 0,
          createdAt: nextAt,
          updatedAt: nextAt,
        },
        occurredAt: nextAt,
      },
    }).state;
    expect(() =>
      reduceProjectAgentMutation(
        running,
        queueMutation(running, "queue.move_up", "queue-b", "move-boundary", "2026-08-28T00:00:02.000Z"),
      ),
    ).toThrowError(expect.objectContaining({ code: "queue_order_violation" }));
  });
});
