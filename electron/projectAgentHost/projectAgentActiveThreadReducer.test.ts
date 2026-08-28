import { describe, expect, it } from "vitest";

import type {
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import { ProjectAgentReducerError, reduceProjectAgentMutation } from "./projectAgentReducer";
import { appendTrustedProjectAgentHostState, createInitialProjectAgentState } from "./projectAgentState";

const now = "2026-08-28T00:00:00.000Z";
const later = "2026-08-28T00:00:01.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;

function thread(threadId: string, updatedAt = now): ProjectAgentThread {
  return { threadId, createdAt: now, updatedAt };
}

function putThread(threadId: string, expectedRevision: number, makeActive = false, updatedAt = now) {
  return {
    commandId: `put-${threadId}-${expectedRevision}`,
    expectedRevision,
    binding,
    sender: { kind: "renderer" as const, senderId: "renderer-a" },
    type: "thread.put" as const,
    payload: { thread: thread(threadId, updatedAt), makeActive },
  };
}

function turn(threadId: string): ProjectAgentTurn {
  return {
    turnId: `turn-${threadId}`,
    threadId,
    status: "queued",
    retryable: false,
    deviated: false,
    executionToken: `token-${threadId}`,
    model: { id: "model-a", version: 1 },
    skillVersions: [],
    capabilityVersions: [],
    contextRef: {
      binding: {
        project: binding,
        threadId,
        sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
      },
      recordId: `context-${threadId}`,
      contextRevision: 1,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function userItem(threadId: string): ProjectAgentUserItem {
  return {
    kind: "user",
    itemId: `user-${threadId}`,
    threadId,
    turnId: `turn-${threadId}`,
    status: "done",
    retryable: false,
    deviated: false,
    text: "hello",
    createdAt: now,
    updatedAt: now,
  };
}

function queueItem(threadId: string): ProjectAgentQueueItem {
  const sourceTurn = turn(threadId);
  return {
    queueItemId: `queue-${threadId}`,
    threadId,
    turnId: sourceTurn.turnId,
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target: { kind: "canvas", nodeIds: [] },
    preconditions: {},
    contextRef: sourceTurn.contextRef,
    model: sourceTurn.model,
    skillVersions: sourceTurn.skillVersions,
    capabilityVersions: sourceTurn.capabilityVersions,
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: now,
    updatedAt: now,
  };
}

describe("ProjectAgentHost explicit active thread changes", () => {
  it("rejects non-boolean makeActive wire values without advancing state", () => {
    const state = createInitialProjectAgentState(binding);
    for (const makeActive of ["false", null]) {
      expect(() =>
        reduceProjectAgentMutation(state, {
          ...putThread("thread-a", 0),
          commandId: `bad-make-active-${String(makeActive)}`,
          payload: { thread: thread("thread-a"), makeActive },
        } as unknown as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
    }
    expect(state.hostRevision).toBe(0);
    expect(state.threads).toEqual([]);
  });

  it("emits active-thread-changed only when thread.put really changes the active thread", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), putThread("thread-a", 0));
    expect(first.state.activeThreadId).toBe("thread-a");
    expect(first.patch!.changes.map((change) => change.kind)).toEqual(["thread-upserted", "active-thread-changed"]);

    const updated = reduceProjectAgentMutation(first.state, putThread("thread-a", 1, false, later));
    expect(updated.patch!.changes.map((change) => change.kind)).toEqual(["thread-upserted"]);

    const second = reduceProjectAgentMutation(updated.state, putThread("thread-b", 2, true));
    expect(second.patch!.changes.at(-1)).toEqual({ kind: "active-thread-changed", activeThreadId: "thread-b" });
  });

  it("activates an exact existing thread without rewriting its content", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), putThread("thread-a", 0));
    const second = reduceProjectAgentMutation(first.state, putThread("thread-b", 1));
    const beforeThreads = second.state.threads;
    const activated = reduceProjectAgentMutation(second.state, {
      commandId: "activate-b",
      expectedRevision: 2,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "thread.activate",
      payload: { threadId: "thread-b", occurredAt: later },
    } as unknown as ProjectAgentMutation);

    expect(activated.state.activeThreadId).toBe("thread-b");
    expect(activated.state.threads).toBe(beforeThreads);
    expect(activated.patch!.changes).toEqual([{ kind: "active-thread-changed", activeThreadId: "thread-b" }]);
    for (const [mutation, code] of [
      [
        {
          commandId: "activate-missing",
          expectedRevision: 3,
          binding,
          sender: { kind: "renderer", senderId: "renderer-a" },
          type: "thread.activate",
          payload: { threadId: "thread-missing", occurredAt: later },
        },
        "record_not_found",
      ],
      [
        {
          commandId: "activate-same",
          expectedRevision: 3,
          binding,
          sender: { kind: "renderer", senderId: "renderer-a" },
          type: "thread.activate",
          payload: { threadId: "thread-b", occurredAt: later },
        },
        "invalid_mutation",
      ],
    ] as const) {
      expect(() =>
        reduceProjectAgentMutation(activated.state, mutation as unknown as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code }));
    }
  });

  it("emits active-thread-changed when turn.enqueue selects another thread", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), putThread("thread-a", 0));
    const enqueued = reduceProjectAgentMutation(first.state, {
      commandId: "enqueue-thread-b",
      expectedRevision: 1,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.enqueue",
      payload: {
        thread: thread("thread-b"),
        turn: turn("thread-b"),
        userItem: userItem("thread-b"),
        queueItem: queueItem("thread-b"),
      },
    });
    expect(enqueued.patch!.changes.at(-1)).toEqual({
      kind: "active-thread-changed",
      activeThreadId: "thread-b",
    });
  });

  it("rejects a trusted active change that disagrees with the stored activeThreadId", () => {
    const previous = createInitialProjectAgentState(binding);
    const storedThread = Object.freeze(thread("thread-a"));
    expect(() =>
      appendTrustedProjectAgentHostState(
        previous,
        {
          binding: previous.binding,
          activeThreadId: "thread-a",
          threads: Object.freeze([storedThread]),
          turns: previous.turns,
          items: previous.items,
          queue: previous.queue,
          proposalApprovals: previous.proposalApprovals,
        },
        Object.freeze({
          commandId: "tampered-active",
          mutationHash: "a".repeat(64),
          appliedRevision: 1,
          patch: Object.freeze({
            binding: previous.binding,
            previousRevision: 0,
            hostRevision: 1,
            changes: Object.freeze([
              { kind: "thread-upserted", thread: storedThread },
              { kind: "active-thread-changed", activeThreadId: null },
            ] as const),
          }),
        }),
      ),
    ).toThrow(/invalid_state/);
  });
});
