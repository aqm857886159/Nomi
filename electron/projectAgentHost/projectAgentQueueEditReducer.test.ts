import { describe, expect, it } from "vitest";

import type {
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import { ProjectAgentReducerError, reduceProjectAgentMutation } from "./projectAgentReducer";
import { createInitialProjectAgentState } from "./projectAgentState";
import { stableProjectAgentJson } from "./projectAgentSnapshot";

const initialAt = "2026-08-28T00:00:00.000Z";
const editedAt = "2026-08-28T00:00:01.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;

function thread(): ProjectAgentThread {
  return { threadId: "thread-a", createdAt: initialAt, updatedAt: initialAt };
}

function turn(): ProjectAgentTurn {
  return {
    turnId: "turn-a",
    threadId: "thread-a",
    status: "queued",
    retryable: false,
    deviated: false,
    executionToken: "token-turn-a",
    model: { id: "model-a", version: "2026-08" },
    skillVersions: [{ id: "skill-a", version: 2 }],
    capabilityVersions: [{ id: "canvas.read", version: 1 }],
    contextRef: {
      binding: {
        project: binding,
        threadId: "thread-a",
        sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
      },
      recordId: "context-a",
      contextRevision: 7,
    },
    createdAt: initialAt,
    updatedAt: initialAt,
  };
}

function userItem(itemId = "user-a"): ProjectAgentUserItem {
  return {
    kind: "user",
    itemId,
    threadId: "thread-a",
    turnId: "turn-a",
    status: "done",
    retryable: false,
    deviated: false,
    text: "read the selected node",
    createdAt: initialAt,
    updatedAt: initialAt,
  };
}

function queueItem(): ProjectAgentQueueItem {
  return {
    queueItemId: "queue-a",
    threadId: "thread-a",
    turnId: "turn-a",
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target: { kind: "canvas", nodeIds: ["node-a"] },
    preconditions: { nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }] },
    contextRef: turn().contextRef,
    model: turn().model,
    skillVersions: turn().skillVersions,
    capabilityVersions: turn().capabilityVersions,
    policyRevision: 5,
    attachmentRefs: [{ assetId: "asset-a", contentHash: "asset-hash" }],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: initialAt,
    updatedAt: initialAt,
  };
}

function enqueue() {
  return reduceProjectAgentMutation(createInitialProjectAgentState(binding), {
    commandId: "enqueue-a",
    expectedRevision: 0,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: { thread: thread(), turn: turn(), userItem: userItem(), queueItem: queueItem() },
  });
}

function editMutation(overrides: Record<string, unknown> = {}): ProjectAgentMutation {
  return {
    commandId: "edit-a",
    expectedRevision: 1,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "queue.edit",
    payload: {
      queueItemId: "queue-a",
      userItemId: "user-a",
      text: "summarize the selected node",
      occurredAt: editedAt,
      ...overrides,
    },
  } as unknown as ProjectAgentMutation;
}

describe("ProjectAgentHost queued user text editing", () => {
  it("rejects null or string transition booleans without advancing state", () => {
    const queued = enqueue().state;
    for (const [field, value] of [
      ["retryable", null],
      ["deviated", null],
      ["retryable", "false"],
      ["deviated", "false"],
    ] as const) {
      expect(() =>
        reduceProjectAgentMutation(queued, {
          commandId: `bad-${field}-${String(value)}`,
          expectedRevision: 1,
          binding,
          sender: { kind: "renderer", senderId: "renderer-a" },
          type: "turn.transition",
          payload: { turnId: "turn-a", status: "stopped", updatedAt: editedAt, [field]: value },
        } as unknown as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
    }
    expect(queued.hostRevision).toBe(1);
    expect(queued.turns[0].status).toBe("queued");
  });

  it("atomically edits only queued semantic text and record timestamps", () => {
    const before = enqueue().state;
    const frozenQueueInputs = stableProjectAgentJson({
      binding: before.queue[0].binding,
      target: before.queue[0].target,
      preconditions: before.queue[0].preconditions,
      contextRef: before.queue[0].contextRef,
      model: before.queue[0].model,
      skillVersions: before.queue[0].skillVersions,
      capabilityVersions: before.queue[0].capabilityVersions,
      policyRevision: before.queue[0].policyRevision,
      attachmentRefs: before.queue[0].attachmentRefs,
      originSurface: before.queue[0].originSurface,
      enqueuedAt: before.queue[0].enqueuedAt,
    });

    const edited = reduceProjectAgentMutation(before, editMutation());

    expect(edited.state.items[0]).toMatchObject({ text: "summarize the selected node", updatedAt: editedAt });
    expect(edited.state.turns[0].updatedAt).toBe(editedAt);
    expect(edited.state.queue[0].updatedAt).toBe(editedAt);
    expect(
      stableProjectAgentJson({
        binding: edited.state.queue[0].binding,
        target: edited.state.queue[0].target,
        preconditions: edited.state.queue[0].preconditions,
        contextRef: edited.state.queue[0].contextRef,
        model: edited.state.queue[0].model,
        skillVersions: edited.state.queue[0].skillVersions,
        capabilityVersions: edited.state.queue[0].capabilityVersions,
        policyRevision: edited.state.queue[0].policyRevision,
        attachmentRefs: edited.state.queue[0].attachmentRefs,
        originSurface: edited.state.queue[0].originSurface,
        enqueuedAt: edited.state.queue[0].enqueuedAt,
      }),
    ).toBe(frozenQueueInputs);
    expect(edited.patch!.changes.map((change) => change.kind)).toEqual([
      "item-upserted",
      "turn-upserted",
      "queue-upserted",
    ]);
  });

  it("rejects non-renderer, blank, unchanged, stale, and mismatched edits", () => {
    const queued = enqueue().state;
    const candidates = [
      { ...editMutation(), sender: { kind: "internal", senderId: "host-a" } },
      editMutation({ text: "   " }),
      editMutation({ text: "read the selected node" }),
      editMutation({ occurredAt: "2026-08-27T23:59:59.000Z" }),
      editMutation({ queueItemId: "queue-missing" }),
      editMutation({ userItemId: "user-missing" }),
    ];

    for (const candidate of candidates) {
      expect(() => reduceProjectAgentMutation(queued, candidate as ProjectAgentMutation)).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }),
      );
    }

    const stopped = reduceProjectAgentMutation(queued, {
      commandId: "stop-a",
      expectedRevision: 1,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.transition",
      payload: { turnId: "turn-a", status: "stopped", updatedAt: editedAt },
    }).state;
    expect(() =>
      reduceProjectAgentMutation(stopped, {
        ...editMutation(),
        commandId: "edit-stopped",
        expectedRevision: 2,
      } as ProjectAgentMutation),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });

  it("forbids a second UserItem for one turn", () => {
    const queued = enqueue().state;
    expect(() =>
      reduceProjectAgentMutation(queued, {
        commandId: "second-user",
        expectedRevision: 1,
        binding,
        sender: { kind: "renderer", senderId: "renderer-a" },
        type: "item.put",
        payload: { item: userItem("user-b") },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });
});
