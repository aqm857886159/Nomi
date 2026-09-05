import { describe, expect, it } from "vitest";

import type {
  ProjectAgentAssistantItem,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import { ProjectAgentReducerError, reduceProjectAgentMutation } from "./projectAgentReducer";
import { assertProjectAgentHostState, createInitialProjectAgentState } from "./projectAgentState";

const queuedAt = "2026-08-28T00:00:00.000Z";
const startedAt = "2026-08-28T00:00:01.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;

function thread(): ProjectAgentThread {
  return { threadId: "thread-a", createdAt: queuedAt, updatedAt: queuedAt };
}

function turn(turnId: string): ProjectAgentTurn {
  return {
    turnId,
    threadId: "thread-a",
    status: "queued",
    retryable: false,
    deviated: false,
    executionToken: `token-${turnId}`,
    model: { id: "model-a", version: "2026-08" },
    skillVersions: [{ id: "skill-a", version: 2 }],
    capabilityVersions: [{ id: "canvas.read", version: 1 }],
    contextRef: {
      binding: {
        project: binding,
        threadId: "thread-a",
        sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
      },
      recordId: `context-${turnId}`,
      contextRevision: 7,
    },
    createdAt: queuedAt,
    updatedAt: queuedAt,
  };
}

function userItem(turnId: string): ProjectAgentUserItem {
  return {
    kind: "user",
    itemId: `user-${turnId}`,
    threadId: "thread-a",
    turnId,
    status: "done",
    retryable: false,
    deviated: false,
    text: `request ${turnId}`,
    createdAt: queuedAt,
    updatedAt: queuedAt,
  };
}

function queueItem(turnId: string): ProjectAgentQueueItem {
  const sourceTurn = turn(turnId);
  return {
    queueItemId: `queue-${turnId}`,
    threadId: "thread-a",
    turnId,
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target: { kind: "canvas", nodeIds: ["node-a"] },
    preconditions: { nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }] },
    contextRef: sourceTurn.contextRef,
    model: sourceTurn.model,
    skillVersions: sourceTurn.skillVersions,
    capabilityVersions: sourceTurn.capabilityVersions,
    policyRevision: 5,
    attachmentRefs: [],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: queuedAt,
    updatedAt: queuedAt,
  };
}

function assistantItem(turnId: string): ProjectAgentAssistantItem {
  return {
    kind: "assistant",
    itemId: `assistant-${turnId}`,
    threadId: "thread-a",
    turnId,
    status: "running",
    retryable: false,
    deviated: false,
    text: "",
    textRevision: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
  } as ProjectAgentAssistantItem;
}

function enqueue(stateRevision: number, turnId: string, state = createInitialProjectAgentState(binding)) {
  return reduceProjectAgentMutation(state, {
    commandId: `enqueue-${turnId}`,
    expectedRevision: stateRevision,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: { thread: thread(), turn: turn(turnId), userItem: userItem(turnId), queueItem: queueItem(turnId) },
  });
}

function startMutation(turnId: string, expectedRevision: number): ProjectAgentMutation {
  return {
    commandId: `start-${turnId}`,
    expectedRevision,
    binding,
    sender: { kind: "internal", senderId: "scheduler-a" },
    type: "turn.start",
    payload: {
      turnId,
      queueItemId: `queue-${turnId}`,
      assistantItem: assistantItem(turnId),
      occurredAt: startedAt,
    },
  } as unknown as ProjectAgentMutation;
}

function startedState() {
  const queued = enqueue(0, "turn-a").state;
  return reduceProjectAgentMutation(queued, startMutation("turn-a", 1)).state;
}

function appendMutation(
  expectedRevision: number,
  expectedTextRevision: number,
  delta: string,
  overrides: Record<string, unknown> = {},
): ProjectAgentMutation {
  return {
    commandId: `append-${expectedRevision}-${expectedTextRevision}`,
    expectedRevision,
    binding,
    sender: { kind: "embedded-agent", senderId: "agent-a" },
    type: "assistant.append",
    payload: {
      turnId: "turn-a",
      itemId: "assistant-turn-a",
      executionToken: "token-turn-a",
      expectedTextRevision,
      delta,
      occurredAt: "2026-08-28T00:00:02.000Z",
      ...overrides,
    },
  } as unknown as ProjectAgentMutation;
}

function asyncMutation(
  expectedRevision: number,
  turnStatus: "running" | "done" | "failed" | "stopped",
  assistantFinal?: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ProjectAgentMutation {
  return {
    commandId: `async-${turnStatus}-${expectedRevision}`,
    expectedRevision,
    binding,
    sender: { kind: "internal", senderId: "executor-a" },
    type: "async.result",
    payload: {
      asyncToken: "token-turn-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-turn-a",
      target: { kind: "canvas", nodeIds: ["node-a"] },
      preconditions: { nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }] },
      expectedRevision,
      items: [],
      turnStatus,
      ...(assistantFinal === undefined ? {} : { assistantFinal }),
      receivedAt: "2026-08-28T00:00:03.000Z",
      ...overrides,
    },
  } as unknown as ProjectAgentMutation;
}

describe("ProjectAgentHost assistant turn start", () => {
  it("atomically starts the FIFO head and creates one empty revision-zero assistant", () => {
    const queued = enqueue(0, "turn-a").state;
    const started = reduceProjectAgentMutation(queued, startMutation("turn-a", 1));

    expect(started.state.turns[0]).toMatchObject({ status: "running", updatedAt: startedAt });
    expect(started.state.queue[0]).toMatchObject({ status: "running", updatedAt: startedAt });
    expect(started.state.items[1]).toMatchObject({
      kind: "assistant",
      text: "",
      textRevision: 0,
      status: "running",
    });
    expect(started.patch!.changes.map((change) => change.kind)).toEqual([
      "item-upserted",
      "turn-upserted",
      "queue-upserted",
    ]);
  });

  it("rejects the old generic running transition bypass", () => {
    const queued = enqueue(0, "turn-a").state;
    expect(() =>
      reduceProjectAgentMutation(queued, {
        commandId: "legacy-start",
        expectedRevision: 1,
        binding,
        sender: { kind: "internal", senderId: "scheduler-a" },
        type: "turn.transition",
        payload: { turnId: "turn-a", status: "running", updatedAt: startedAt },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });

  it("rejects a later queue entry while the exact FIFO head is queued or running", () => {
    const first = enqueue(0, "turn-a").state;
    const twoQueued = enqueue(1, "turn-b", first).state;
    expect(() => reduceProjectAgentMutation(twoQueued, startMutation("turn-b", 2))).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "queue_order_violation" }),
    );

    const firstRunning = reduceProjectAgentMutation(twoQueued, startMutation("turn-a", 2)).state;
    expect(() => reduceProjectAgentMutation(firstRunning, startMutation("turn-b", 3))).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }),
    );
  });

  it("rejects malformed, mismatched, non-internal, duplicate, and stale starts", () => {
    const queued = enqueue(0, "turn-a").state;
    const base = startMutation("turn-a", 1) as unknown as Record<string, unknown>;
    const payload = (base.payload ?? {}) as Record<string, unknown>;
    const candidates = [
      { ...base, sender: { kind: "renderer", senderId: "renderer-a" } },
      { ...base, commandId: "wrong-queue", payload: { ...payload, queueItemId: "queue-missing" } },
      {
        ...base,
        commandId: "wrong-turn",
        payload: { ...payload, assistantItem: { ...assistantItem("turn-a"), turnId: "turn-b" } },
      },
      {
        ...base,
        commandId: "nonempty-assistant",
        payload: { ...payload, assistantItem: { ...assistantItem("turn-a"), text: "already generated" } },
      },
      {
        ...base,
        commandId: "wrong-revision",
        payload: { ...payload, assistantItem: { ...assistantItem("turn-a"), textRevision: 1 } },
      },
      { ...base, commandId: "stale-time", payload: { ...payload, occurredAt: "2026-08-27T23:59:59.000Z" } },
    ];
    for (const candidate of candidates) {
      expect(() => reduceProjectAgentMutation(queued, candidate as unknown as ProjectAgentMutation)).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }),
      );
    }

    const started = reduceProjectAgentMutation(queued, startMutation("turn-a", 1)).state;
    expect(() =>
      reduceProjectAgentMutation(started, {
        ...startMutation("turn-a", 2),
        commandId: "start-again",
      } as ProjectAgentMutation),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });

  it("atomically stops a running turn, releases FIFO, and rejects its late async result", () => {
    const queuedA = enqueue(0, "turn-a");
    const queuedB = enqueue(1, "turn-b", queuedA.state);
    const runningA = reduceProjectAgentMutation(queuedB.state, startMutation("turn-a", 2));
    const stoppedA = reduceProjectAgentMutation(runningA.state, {
      commandId: "stop-running-turn-a",
      expectedRevision: 3,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.transition",
      payload: {
        turnId: "turn-a",
        status: "stopped",
        updatedAt: "2026-08-28T00:00:02.000Z",
      },
    });

    expect(stoppedA.state.turns.find((value) => value.turnId === "turn-a")?.status).toBe("stopped");
    expect(stoppedA.state.queue.find((value) => value.turnId === "turn-a")?.status).toBe("stopped");
    expect(stoppedA.state.items.find((value) => value.itemId === "assistant-turn-a")?.status).toBe("stopped");

    const runningB = reduceProjectAgentMutation(stoppedA.state, startMutation("turn-b", 4));
    expect(runningB.state.turns.find((value) => value.turnId === "turn-b")?.status).toBe("running");
    expect(() => reduceProjectAgentMutation(runningB.state, asyncMutation(5, "done"))).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }),
    );
  });
});

describe("ProjectAgentHost assistant streaming append", () => {
  it("appends in place under host and text revision CAS", () => {
    const started = startedState();
    const first = reduceProjectAgentMutation(started, appendMutation(2, 0, "Hello"));
    const second = reduceProjectAgentMutation(
      first.state,
      appendMutation(3, 1, " world", { occurredAt: "2026-08-28T00:00:03.000Z" }),
    );

    expect(first.state.items.find((item) => item.kind === "assistant")).toMatchObject({
      text: "Hello",
      textRevision: 1,
      status: "running",
      updatedAt: "2026-08-28T00:00:02.000Z",
    });
    expect(second.state.items.find((item) => item.kind === "assistant")).toMatchObject({
      text: "Hello world",
      textRevision: 2,
      status: "running",
    });
    expect(first.patch!.changes.map((change) => change.kind)).toEqual(["item-upserted"]);
    expect(first.state.turns[0]).toBe(started.turns[0]);
    expect(first.state.queue[0]).toBe(started.queue[0]);
  });

  it("rejects stale text revisions, old tokens, wrong links, renderer sends, bad deltas, and time reversal", () => {
    const started = startedState();
    const base = appendMutation(2, 0, "Hello") as unknown as Record<string, unknown>;
    const payload = base.payload as Record<string, unknown>;
    const candidates = [
      [appendMutation(2, 1, "stale"), "async_result_stale"],
      [appendMutation(2, 0, "old token", { executionToken: "token-old" }), "async_result_stale"],
      [appendMutation(2, 0, "wrong item", { itemId: "assistant-missing" }), "record_not_found"],
      [appendMutation(2, 0, "wrong turn", { turnId: "turn-missing" }), "record_not_found"],
      [
        { ...base, commandId: "renderer-append", sender: { kind: "renderer", senderId: "renderer-a" } },
        "invalid_mutation",
      ],
      [appendMutation(2, 0, ""), "invalid_mutation"],
      [appendMutation(2, 0, "x".repeat(16_385)), "invalid_mutation"],
      [appendMutation(2, 0, "time reversal", { occurredAt: queuedAt }), "async_result_stale"],
      [{ ...base, commandId: "extra-key", payload: { ...payload, hiddenToken: "smuggled" } }, "invalid_mutation"],
    ] as const;
    for (const [candidate, code] of candidates) {
      expect(() => reduceProjectAgentMutation(started, candidate as ProjectAgentMutation)).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code }),
      );
    }
  });

  it("reserves assistant status and creation for specialized atomic commands", () => {
    const started = startedState();
    expect(() =>
      reduceProjectAgentMutation(started, {
        commandId: "generic-assistant-finish",
        expectedRevision: 2,
        binding,
        sender: { kind: "internal", senderId: "host-a" },
        type: "item.transition",
        payload: { itemId: "assistant-turn-a", status: "done", updatedAt: startedAt },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));

    expect(() =>
      reduceProjectAgentMutation(started, {
        commandId: "second-assistant",
        expectedRevision: 2,
        binding,
        sender: { kind: "embedded-agent", senderId: "agent-a" },
        type: "item.put",
        payload: { item: { ...assistantItem("turn-a"), itemId: "assistant-second" } },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });
});

describe("ProjectAgentHost assistant async finalization", () => {
  it("terminalizes the started assistant with proposal expiry or pending user abort", () => {
    const approval = {
      ref: {
        approvalId: "approval-a",
        receiptProposalId: "receipt-approval-a",
        threadId: "thread-a",
        turnId: "turn-a",
        toolCallId: "tool-a",
        policyRevision: 5,
        inputHash: "input-a",
        actionHash: "action-a",
        target: { kind: "canvas", nodeIds: ["node-a"] },
        preconditions: { nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }] },
        expiresAt: "2026-08-29T00:00:00.000Z",
      },
      lifecycle: "pending",
    } as const;
    const proposed = reduceProjectAgentMutation(startedState(), {
      commandId: "proposal-for-assistant-terminal",
      expectedRevision: 2,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "proposal.put",
      payload: {
        approval,
        item: {
          kind: "proposal",
          itemId: "proposal-a",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "proposed",
          retryable: false,
          deviated: false,
          approval: approval.ref,
          createdAt: startedAt,
          updatedAt: startedAt,
        },
        occurredAt: startedAt,
      },
    });
    const expired = reduceProjectAgentMutation(proposed.state, {
      commandId: "expire-with-assistant",
      expectedRevision: 3,
      binding,
      sender: { kind: "internal", senderId: "authority" },
      type: "proposal.transition",
      payload: {
        approvalId: "approval-a",
        lifecycle: "expired",
        occurredAt: "2026-08-29T00:00:00.000Z",
      },
    });
    expect(expired.state.items.find((item) => item.itemId === "assistant-turn-a")).toMatchObject({
      status: "stopped",
      text: "",
      textRevision: 0,
    });
    expect(expired.patch!.changes).toContainEqual(
      expect.objectContaining({
        kind: "item-upserted",
        item: expect.objectContaining({ itemId: "assistant-turn-a" }),
      }),
    );

    const declined = reduceProjectAgentMutation(proposed.state, {
      commandId: "decline-with-assistant",
      expectedRevision: 3,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.transition",
      payload: { turnId: "turn-a", status: "declined", updatedAt: startedAt },
    });
    expect(declined.state.items.find((item) => item.itemId === "assistant-turn-a")).toMatchObject({
      status: "stopped",
      text: "",
      textRevision: 0,
    });
  });

  it("stops a claimed proposal card while preserving its settled approval history", () => {
    const approval = {
      ref: {
        approvalId: "approval-claimed",
        receiptProposalId: "receipt-approval-claimed",
        threadId: "thread-a",
        turnId: "turn-a",
        toolCallId: "tool-claimed",
        policyRevision: 5,
        inputHash: "input-claimed",
        actionHash: "action-claimed",
        target: { kind: "canvas", nodeIds: ["node-a"] },
        preconditions: { nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }] },
        expiresAt: "2026-08-29T00:00:00.000Z",
      },
      lifecycle: "pending",
    } as const;
    const proposed = reduceProjectAgentMutation(startedState(), {
      commandId: "proposal-before-claimed-stop",
      expectedRevision: 2,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "proposal.put",
      payload: {
        approval,
        item: {
          kind: "proposal",
          itemId: "proposal-claimed",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "proposed",
          retryable: false,
          deviated: false,
          approval: approval.ref,
          createdAt: startedAt,
          updatedAt: startedAt,
        },
        occurredAt: startedAt,
      },
    });
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-before-stop",
      expectedRevision: 3,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: {
        approvalId: "approval-claimed",
        lifecycle: "claimed",
        occurredAt: "2026-08-28T00:00:02.000Z",
      },
    });
    const stopped = reduceProjectAgentMutation(claimed.state, {
      commandId: "stop-claimed-proposal",
      expectedRevision: 4,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.transition",
      payload: {
        turnId: "turn-a",
        status: "stopped",
        updatedAt: "2026-08-28T00:00:03.000Z",
      },
    });

    expect(stopped.state.turns[0]?.status).toBe("stopped");
    expect(stopped.state.queue[0]?.status).toBe("stopped");
    expect(stopped.state.items.find((value) => value.itemId === "assistant-turn-a")?.status).toBe("stopped");
    expect(stopped.state.items.find((value) => value.itemId === "proposal-claimed")?.status).toBe("stopped");
    expect(stopped.state.proposalApprovals).toEqual([
      expect.objectContaining({
        lifecycle: "claimed",
        ref: expect.objectContaining({ approvalId: "approval-claimed" }),
      }),
    ]);
  });

  it("requires and atomically applies the exact assistant final for a terminal result", () => {
    const appended = reduceProjectAgentMutation(startedState(), appendMutation(2, 0, "Hello"));
    expect(() =>
      reduceProjectAgentMutation(appended.state, {
        commandId: "generic-turn-finish",
        expectedRevision: 3,
        binding,
        sender: { kind: "internal", senderId: "host-a" },
        type: "turn.transition",
        payload: { turnId: "turn-a", status: "done", updatedAt: "2026-08-28T00:00:03.000Z" },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
    expect(() => reduceProjectAgentMutation(appended.state, asyncMutation(3, "done"))).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }),
    );

    const finalized = reduceProjectAgentMutation(
      appended.state,
      asyncMutation(3, "done", {
        itemId: "assistant-turn-a",
        executionToken: "token-turn-a",
        expectedTextRevision: 1,
        text: "Hello!",
      }),
    );
    expect(finalized.state.items.find((item) => item.kind === "assistant")).toMatchObject({
      text: "Hello!",
      textRevision: 2,
      status: "done",
      updatedAt: "2026-08-28T00:00:03.000Z",
    });
    expect(finalized.state.turns[0]).toMatchObject({ status: "done", updatedAt: "2026-08-28T00:00:03.000Z" });
    expect(finalized.state.queue[0]).toMatchObject({ status: "done", updatedAt: "2026-08-28T00:00:03.000Z" });
    expect(finalized.patch!.changes.map((change) => change.kind)).toEqual([
      "item-upserted",
      "turn-upserted",
      "queue-upserted",
    ]);
  });

  it("persists validated terminal model usage in the Host state and snapshot contract", () => {
    const usage = { promptTokens: 5, completionTokens: 3, cachedPromptTokens: 1, totalTokens: 8 };
    const finalized = reduceProjectAgentMutation(
      startedState(),
      asyncMutation(2, "done", {
        itemId: "assistant-turn-a",
        executionToken: "token-turn-a",
        expectedTextRevision: 0,
        text: "done",
      }, { usage }),
    );

    expect(finalized.state.turns[0]).toMatchObject({ status: "done", usage });
    expect(() => assertProjectAgentHostState(finalized.state)).not.toThrow();
  });

  it("rejects malformed terminal model usage before changing the Host state", () => {
    const started = startedState();
    const validFinal = {
      itemId: "assistant-turn-a",
      executionToken: "token-turn-a",
      expectedTextRevision: 0,
      text: "done",
    };
    for (const usage of [
      null,
      { promptTokens: 5, completionTokens: 3, cachedPromptTokens: 1, totalTokens: -1 },
      { promptTokens: 5, completionTokens: 3, cachedPromptTokens: 1, totalTokens: 8, extra: true },
    ]) {
      expect(() => reduceProjectAgentMutation(started, asyncMutation(2, "done", validFinal, { usage })))
        .toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }));
    }
  });

  it("does not advance textRevision when terminal full text is unchanged", () => {
    const appended = reduceProjectAgentMutation(startedState(), appendMutation(2, 0, "Hello"));
    const finalized = reduceProjectAgentMutation(
      appended.state,
      asyncMutation(3, "failed", {
        itemId: "assistant-turn-a",
        executionToken: "token-turn-a",
        expectedTextRevision: 1,
        text: "Hello",
      }),
    );
    expect(finalized.state.items.find((item) => item.kind === "assistant")).toMatchObject({
      text: "Hello",
      textRevision: 1,
      status: "failed",
    });
  });

  it("allows running continuation without final and forbids a premature final", () => {
    const started = startedState();
    const continued = reduceProjectAgentMutation(started, asyncMutation(2, "running"));
    expect(continued.state.items.find((item) => item.kind === "assistant")).toMatchObject({
      status: "running",
      textRevision: 0,
    });
    expect(() =>
      reduceProjectAgentMutation(
        started,
        asyncMutation(2, "running", {
          itemId: "assistant-turn-a",
          executionToken: "token-turn-a",
          expectedTextRevision: 0,
          text: "premature",
        }),
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
  });

  it("rejects finalization with an old token, stale text revision, wrong item, or extra key", () => {
    const started = startedState();
    const validFinal = {
      itemId: "assistant-turn-a",
      executionToken: "token-turn-a",
      expectedTextRevision: 0,
      text: "done",
    };
    for (const [commandId, assistantFinal] of [
      ["old-token", { ...validFinal, executionToken: "token-old" }],
      ["stale-text", { ...validFinal, expectedTextRevision: 1 }],
      ["wrong-item", { ...validFinal, itemId: "assistant-missing" }],
      ["extra-key", { ...validFinal, status: "done" }],
    ] as const) {
      expect(() =>
        reduceProjectAgentMutation(started, {
          ...asyncMutation(2, "done", assistantFinal),
          commandId,
        } as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: expect.any(String) }));
    }
  });
});
