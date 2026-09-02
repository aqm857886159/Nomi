import { describe, expect, it } from "vitest";

import type {
  ProjectAgentAssistantItem,
  ProjectAgentAsyncResultEnvelope,
  ProjectAgentItem,
  ProjectAgentMutation,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
} from "../shared/projectAgentContracts";
import {
  ProjectAgentReducerError,
  createProjectAgentSerialReducer,
  reduceProjectAgentMutation,
} from "./projectAgentReducer";
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "./projectAgentState";

const now = "2026-08-28T00:00:00.000Z";
const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;
const target = { kind: "canvas", nodeIds: ["node-a"] } as const;
const preconditions = {
  nodes: [{ nodeId: "node-a", revision: 2, contentHash: "node-hash" }],
} as const;

function thread(): ProjectAgentThread {
  return { threadId: "thread-a", createdAt: now, updatedAt: now };
}

function turn(turnId = "turn-a"): ProjectAgentTurn {
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
      recordId: "context-a",
      contextRevision: 7,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function userItem(turnId = "turn-a"): ProjectAgentUserItem {
  return {
    kind: "user",
    itemId: `user-${turnId}`,
    threadId: "thread-a",
    turnId,
    status: "done",
    retryable: false,
    deviated: false,
    text: "read the selected node",
    createdAt: now,
    updatedAt: now,
  };
}

function queueItem(turnId = "turn-a"): ProjectAgentQueueItem {
  return {
    queueItemId: `queue-${turnId}`,
    threadId: "thread-a",
    turnId,
    status: "queued",
    retryable: false,
    deviated: false,
    binding,
    target,
    preconditions,
    contextRef: {
      binding: {
        project: binding,
        threadId: "thread-a",
        sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
      },
      recordId: "context-a",
      contextRevision: 7,
    },
    model: { id: "model-a", version: "2026-08" },
    skillVersions: [{ id: "skill-a", version: 2 }],
    capabilityVersions: [{ id: "canvas.read", version: 1 }],
    policyRevision: 5,
    attachmentRefs: [{ assetId: "asset-a", contentHash: "asset-hash" }],
    originSurface: { surfaceId: "surface-a", kind: "canvas" },
    enqueuedAt: now,
    updatedAt: now,
  };
}

type TurnEnqueueMutation = Extract<ProjectAgentMutation, { type: "turn.enqueue" }>;

function enqueueMutation(commandId = "command-enqueue", turnId = "turn-a"): TurnEnqueueMutation {
  return {
    commandId,
    expectedRevision: 0,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: thread(),
      turn: turn(turnId),
      userItem: userItem(turnId),
      queueItem: queueItem(turnId),
    },
  };
}

function assistantItem(turnId = "turn-a"): ProjectAgentAssistantItem {
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
    createdAt: now,
    updatedAt: now,
  };
}

function startMutation(commandId: string, turnId: string, expectedRevision: number): ProjectAgentMutation {
  return {
    commandId,
    expectedRevision,
    binding,
    sender: { kind: "internal", senderId: "scheduler" },
    type: "turn.start",
    payload: {
      turnId,
      queueItemId: `queue-${turnId}`,
      assistantItem: assistantItem(turnId),
      occurredAt: now,
    },
  };
}

describe("ProjectAgentHost reducer identity and exactly-once boundary", () => {
  it("deletes an archived canonical thread with all linked records", () => {
    const archived = { ...thread(), threadId: "archived-canonical-thread" };
    const current = { ...thread(), threadId: "active-canonical-thread" };
    const linkedContextRef = {
      ...turn().contextRef,
      binding: { ...turn().contextRef.binding, threadId: archived.threadId },
    };
    const linkedTurn = {
      ...turn(),
      threadId: archived.threadId,
      turnId: "archived-turn",
      contextRef: linkedContextRef,
      status: "done" as const,
    };
    const linkedUser = {
      ...userItem(),
      threadId: archived.threadId,
      turnId: linkedTurn.turnId,
      itemId: "archived-user",
    };
    const linkedAssistant = {
      ...assistantItem(),
      threadId: archived.threadId,
      turnId: linkedTurn.turnId,
      itemId: "archived-assistant",
      status: "done" as const,
    };
    const linkedQueue = {
      ...queueItem(),
      status: "done" as const,
      threadId: archived.threadId,
      turnId: linkedTurn.turnId,
      queueItemId: "archived-queue",
      contextRef: linkedContextRef,
    };
    const seeded = snapshotProjectAgentHostState({
      binding,
      hostRevision: 0,
      commandLedgerHighWater: 0,
      activeThreadId: current.threadId,
      threads: [current, archived],
      turns: [linkedTurn],
      items: [linkedUser, linkedAssistant],
      queue: [linkedQueue],
      proposalApprovals: [],
      recentAppliedCommands: [],
    });

    const removed = reduceProjectAgentMutation(seeded, {
      commandId: "archived-canonical-thread-remove",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "thread.remove",
      payload: { threadId: archived.threadId, occurredAt: now },
    });

    expect(removed.state.threads.map((value) => value.threadId)).toEqual([current.threadId]);
    expect(removed.state.turns).toEqual([]);
    expect(removed.state.items).toEqual([]);
    expect(removed.state.queue).toEqual([]);
    expect(removed.state.activeThreadId).toBe(current.threadId);
  });

  it("does not delete the active canonical thread", () => {
    const active = thread();
    const seeded = snapshotProjectAgentHostState({
      ...createInitialProjectAgentState(binding),
      activeThreadId: active.threadId,
      threads: [active],
    });
    expect(() =>
      reduceProjectAgentMutation(seeded, {
        commandId: "active-canonical-thread-remove",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: "renderer-a" },
        type: "thread.remove",
        payload: { threadId: active.threadId, occurredAt: now },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "thread_read_only" }));
  });

  it("rejects the same projectId with another UUID or generation", () => {
    const state = createInitialProjectAgentState(binding);

    for (const foreignBinding of [
      { ...binding, immutableProjectUuid: "22222222-2222-4222-8222-222222222222" },
      { ...binding, projectGeneration: 4 },
    ]) {
      expect(() =>
        reduceProjectAgentMutation(state, {
          ...enqueueMutation(),
          binding: foreignBinding,
        }),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "project_binding_mismatch" }));
    }
  });

  it("returns the durable first result for a repeated command without bumping revision", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const replay = reduceProjectAgentMutation(first.state, enqueueMutation());

    expect(first.state.hostRevision).toBe(1);
    expect(replay.state).toBe(first.state);
    expect(replay.patch).toEqual(first.patch);
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.replayed).toBe(true);
    expect(replay.snapshotRequired).toBe(false);
    expect(replay.state.recentAppliedCommands).toHaveLength(1);
  });

  it("canonicalizes object key order when recognizing an exact retry", () => {
    const original = enqueueMutation();
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), original);
    const reordered = {
      payload: {
        queueItem: original.payload.queueItem,
        userItem: original.payload.userItem,
        turn: original.payload.turn,
        thread: original.payload.thread,
      },
      type: original.type,
      sender: { senderId: original.sender.senderId, kind: original.sender.kind },
      binding: {
        projectGeneration: original.binding.projectGeneration,
        immutableProjectUuid: original.binding.immutableProjectUuid,
        projectId: original.binding.projectId,
      },
      expectedRevision: original.expectedRevision,
      commandId: original.commandId,
    } as ProjectAgentMutation;

    const replay = reduceProjectAgentMutation(first.state, reordered);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.mutationHash).toBe(first.receipt.mutationHash);
  });

  it("rejects commandId reuse with changed input", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const changed = {
      ...enqueueMutation(),
      payload: { ...enqueueMutation().payload, userItem: { ...userItem(), text: "changed" } },
    } as ProjectAgentMutation;

    expect(() => reduceProjectAgentMutation(first.state, changed)).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "command_id_conflict" }),
    );
  });

  it("fails closed for unknown commands and unexpected envelope or payload fields", () => {
    const state = createInitialProjectAgentState(binding);
    const base = enqueueMutation();
    const candidates = [
      { ...base, type: "unknown.command", payload: {} },
      { ...base, unexpectedAuthority: "smuggled" },
      { ...base, payload: { ...base.payload, unexpectedAuthority: "smuggled" } },
    ];

    for (const candidate of candidates) {
      expect(() => reduceProjectAgentMutation(state, candidate as unknown as ProjectAgentMutation)).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }),
      );
    }
    expect(state.hostRevision).toBe(0);
    expect(state.recentAppliedCommands).toEqual([]);
  });

  it("enforces expectedRevision CAS and emits a full-binding monotonic patch", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());

    expect(first.patch).toMatchObject({
      binding,
      previousRevision: 0,
      hostRevision: 1,
    });
    expect(() =>
      reduceProjectAgentMutation(first.state, {
        ...enqueueMutation("command-stale", "turn-b"),
        expectedRevision: 0,
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "revision_conflict" }));
  });

  it("snapshots caller payloads so later mutation cannot bypass CAS", () => {
    const mutable = enqueueMutation() as unknown as {
      payload: { userItem: { text: string }; queueItem: { attachmentRefs: { assetId: string }[] } };
    };
    const first = reduceProjectAgentMutation(
      createInitialProjectAgentState(binding),
      mutable as unknown as ProjectAgentMutation,
    );

    mutable.payload.userItem.text = "mutated after reduction";
    mutable.payload.queueItem.attachmentRefs[0]!.assetId = "mutated-asset";

    expect(first.state.items[0]).toMatchObject({ text: "read the selected node" });
    expect(first.state.queue[0]?.attachmentRefs[0]?.assetId).toBe("asset-a");
    expect(Object.isFrozen(first.state.queue[0]?.attachmentRefs)).toBe(true);
  });

  it("rejects area identity smuggled into a thread", () => {
    const mutation = enqueueMutation() as unknown as {
      payload: { thread: Record<string, unknown> };
    };
    mutation.payload.thread.area = "generation";

    expect(() =>
      reduceProjectAgentMutation(createInitialProjectAgentState(binding), mutation as unknown as ProjectAgentMutation),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "area_identity_forbidden" }));
  });

  it("preserves thread creation history and monotonic update time", () => {
    const createdAt = "2026-08-27T00:00:00.000Z";
    const firstMutation: ProjectAgentMutation = {
      commandId: "thread-first",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "thread.put",
      payload: {
        thread: { threadId: "thread-a", createdAt, updatedAt: now },
        makeActive: true,
      },
    };
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), firstMutation);
    const candidates: ProjectAgentMutation[] = [
      {
        ...firstMutation,
        commandId: "rewrite-created-at",
        expectedRevision: 1,
        payload: {
          thread: {
            threadId: "thread-a",
            createdAt: "2026-08-26T00:00:00.000Z",
            updatedAt: "2026-08-28T00:01:00.000Z",
          },
        },
      },
      {
        ...firstMutation,
        commandId: "move-updated-at-backward",
        expectedRevision: 1,
        payload: {
          thread: {
            threadId: "thread-a",
            createdAt,
            updatedAt: "2026-08-27T23:59:59.999Z",
          },
        },
      },
      {
        ...enqueueMutation("enqueue-rewrite-thread"),
        expectedRevision: 1,
      },
    ];

    for (const mutation of candidates) {
      expect(() => reduceProjectAgentMutation(first.state, mutation)).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }),
      );
    }
    expect(first.state.threads[0]).toEqual(firstMutation.payload.thread);
  });

  it("requires exact frozen execution inputs across each turn and queue mirror", () => {
    const base = enqueueMutation();
    const candidates = [
      {
        ...base.payload.queueItem,
        contextRef: { ...base.payload.queueItem.contextRef, recordId: "context-b" },
      },
      { ...base.payload.queueItem, model: { id: "model-b", version: "2026-08" } },
      {
        ...base.payload.queueItem,
        skillVersions: [{ id: "skill-a", version: 3 }],
      },
      { ...base.payload.queueItem, retryable: true },
      { ...base.payload.queueItem, deviated: true },
    ];

    for (const [index, queueItem] of candidates.entries()) {
      expect(() =>
        reduceProjectAgentMutation(createInitialProjectAgentState(binding), {
          ...base,
          commandId: `mismatched-queue-${index}`,
          payload: { ...base.payload, queueItem },
        } as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));
    }
  });
});

describe("ProjectAgentHost turn serialization and async re-entry", () => {
  it("recovers an orphaned execution and its failure evidence in one idempotent reduction", () => {
    for (const orphanStatus of ["queued", "running", "proposed"] as const) {
      let seeded = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
      if (orphanStatus !== "queued") {
        seeded = reduceProjectAgentMutation(
          seeded.state,
          startMutation(`command-start-recovery-${orphanStatus}`, "turn-a", seeded.state.hostRevision),
        );
      }
      if (orphanStatus === "proposed") {
        const approval = {
          ref: {
            approvalId: "approval-recovery",
            receiptProposalId: "receipt-recovery",
            threadId: "thread-a",
            turnId: "turn-a",
            toolCallId: "tool-recovery",
            policyRevision: 5,
            inputHash: "input-recovery",
            actionHash: "action-recovery",
            target,
            preconditions,
            expiresAt: "2026-08-29T00:00:00.000Z",
          },
          lifecycle: "pending",
        } as const;
        seeded = reduceProjectAgentMutation(seeded.state, {
          commandId: "command-proposal-recovery",
          expectedRevision: seeded.state.hostRevision,
          binding,
          sender: { kind: "internal", senderId: "executor" },
          type: "proposal.put",
          payload: {
            approval,
            item: {
              itemId: "proposal-recovery",
              threadId: "thread-a",
              turnId: "turn-a",
              kind: "proposal",
              approval: approval.ref,
              status: "proposed",
              retryable: false,
              deviated: false,
              createdAt: now,
              updatedAt: now,
            },
            occurredAt: now,
          },
        });
      }
      const recovery = {
        commandId: `command-recover-${orphanStatus}`,
        expectedRevision: seeded.state.hostRevision,
        binding,
        sender: { kind: "internal" as const, senderId: "execution-recovery" },
        type: "execution.recover" as const,
        payload: {
          turnId: "turn-a",
          failure: {
            itemId: "failure-recovery-turn-a",
            threadId: "thread-a",
            turnId: "turn-a",
            kind: "failure" as const,
            code: "execution_recovery_required",
            message: "The previous Agent process ended before this turn completed.",
            status: "failed" as const,
            retryable: true,
            deviated: false,
            createdAt: "2026-08-28T00:00:01.000Z",
            updatedAt: "2026-08-28T00:00:01.000Z",
          },
          recoveredAt: "2026-08-28T00:00:01.000Z",
        },
      } as ProjectAgentMutation;

      const recovered = reduceProjectAgentMutation(seeded.state, recovery);
      expect(recovered.state.hostRevision).toBe(seeded.state.hostRevision + 1);
      expect(recovered.state.turns[0]).toMatchObject({ status: "failed", retryable: true });
      expect(recovered.state.queue[0]).toMatchObject({ status: "failed", retryable: true });
      expect(recovered.state.items.filter((item) => item.kind === "failure")).toHaveLength(1);
      expect(recovered.patch?.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "turn-upserted", turn: expect.objectContaining({ status: "failed" }) }),
          expect.objectContaining({ kind: "queue-upserted", queueItem: expect.objectContaining({ status: "failed" }) }),
          expect.objectContaining({ kind: "item-upserted", item: expect.objectContaining({ kind: "failure" }) }),
        ]),
      );
      expect(
        recovered.state.items.filter(
          (item) => item.turnId === "turn-a" && (item.kind === "assistant" || item.kind === "proposal"),
        ),
      ).toEqual(
        expect.arrayContaining(
          recovered.state.items
            .filter((item) => item.turnId === "turn-a" && (item.kind === "assistant" || item.kind === "proposal"))
            .map((item) => expect.objectContaining({ itemId: item.itemId, status: "failed" })),
        ),
      );
      expect(recovered.state.proposalApprovals.filter((approval) => approval.lifecycle === "pending")).toEqual([]);

      const replayed = reduceProjectAgentMutation(recovered.state, recovery);
      expect(replayed.replayed).toBe(true);
      expect(replayed.state.hostRevision).toBe(recovered.state.hostRevision);
      expect(replayed.state.items.filter((item) => item.kind === "failure")).toHaveLength(1);
      expect(() =>
        reduceProjectAgentMutation(seeded.state, {
          ...recovery,
          commandId: `renderer-recover-${orphanStatus}`,
          sender: { kind: "renderer", senderId: "renderer-a" },
        }),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
    }
  });

  it("serializes concurrent dispatch per project, so only one same-revision command wins", async () => {
    const reducer = createProjectAgentSerialReducer(createInitialProjectAgentState(binding));
    const first = reducer.dispatch(enqueueMutation("command-a", "turn-a"));
    const second = reducer.dispatch(enqueueMutation("command-b", "turn-b"));

    const results = await Promise.allSettled([first, second]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(reducer.getSnapshot().hostRevision).toBe(1);
  });

  it("allows only the FIFO head to become the project's single running turn", () => {
    const first = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const second = reduceProjectAgentMutation(first.state, {
      ...enqueueMutation("command-enqueue-b", "turn-b"),
      expectedRevision: 1,
    });

    expect(() => reduceProjectAgentMutation(second.state, startMutation("command-start-b", "turn-b", 2))).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "queue_order_violation" }),
    );

    const running = reduceProjectAgentMutation(second.state, startMutation("command-start-a", "turn-a", 2));
    expect(running.state.turns.find((item) => item.turnId === "turn-a")?.status).toBe("running");

    expect(() =>
      reduceProjectAgentMutation(running.state, startMutation("command-start-b-later", "turn-b", 3)),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "running_turn_exists" }));
  });

  it("publishes tool results only through the revalidated async result path", () => {
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const running = reduceProjectAgentMutation(queued.state, startMutation("command-start-tool", "turn-a", 1));
    const resultItem: ProjectAgentItem = {
      kind: "tool",
      itemId: "tool-result-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      toolCallId: "tool-call-result-a",
      invocationId: "invocation-result-a",
      capability: { id: "canvas.read", version: 1 },
      resultRef: "result-a",
      createdAt: now,
      updatedAt: now,
    };

    expect(() =>
      reduceProjectAgentMutation(running.state, {
        commandId: "generic-tool-result-put",
        expectedRevision: running.state.hostRevision,
        binding,
        sender: { kind: "embedded-agent", senderId: "agent" },
        type: "item.put",
        payload: { item: resultItem },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
    expect(running.state.hostRevision).toBe(2);
    expect(running.state.items.some((item) => item.itemId === resultItem.itemId)).toBe(false);

    const applied = reduceProjectAgentMutation(running.state, {
      commandId: "validated-tool-result",
      expectedRevision: running.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: {
        asyncToken: "token-turn-a",
        binding,
        threadId: "thread-a",
        turnId: "turn-a",
        queueItemId: "queue-turn-a",
        target,
        preconditions,
        expectedRevision: running.state.hostRevision,
        items: [resultItem],
        turnStatus: "running",
        receivedAt: now,
      },
    });
    expect(applied.state.items).toContainEqual(expect.objectContaining({ itemId: resultItem.itemId }));
  });

  it("rejects renderer-authored async results even when the token and revision match", () => {
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const running = reduceProjectAgentMutation(
      queued.state,
      startMutation("command-start-renderer-result", "turn-a", 1),
    );
    expect(() =>
      reduceProjectAgentMutation(running.state, {
        commandId: "renderer-forged-async-result",
        expectedRevision: running.state.hostRevision,
        binding,
        sender: { kind: "renderer", senderId: "renderer-a" },
        type: "async.result",
        payload: {
          asyncToken: "token-turn-a",
          binding,
          threadId: "thread-a",
          turnId: "turn-a",
          queueItemId: "queue-turn-a",
          target,
          preconditions,
          expectedRevision: running.state.hostRevision,
          items: [],
          turnStatus: "running",
          receivedAt: now,
        },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
  });

  it("revalidates async binding, token, target, preconditions and revision before publication", () => {
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const running = reduceProjectAgentMutation(queued.state, startMutation("command-start-a", "turn-a", 1));
    const resultItem: ProjectAgentItem = {
      kind: "tool",
      itemId: "tool-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      toolCallId: "tool-call-a",
      invocationId: "invocation-a",
      capability: { id: "canvas.read", version: 1 },
      resultRef: "result-a",
      createdAt: now,
      updatedAt: now,
    };
    const envelope: ProjectAgentAsyncResultEnvelope = {
      asyncToken: "token-turn-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-turn-a",
      target,
      preconditions,
      expectedRevision: 2,
      items: [resultItem],
      turnStatus: "done",
      assistantFinal: {
        itemId: "assistant-turn-a",
        executionToken: "token-turn-a",
        expectedTextRevision: 0,
        text: "completed",
      },
      receivedAt: now,
    };
    const mutation: ProjectAgentMutation = {
      commandId: "command-async-a",
      expectedRevision: 2,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: envelope,
    };

    for (const changed of [
      { ...envelope, asyncToken: "late-token" },
      { ...envelope, target: { kind: "canvas" as const, nodeIds: ["node-b"] } },
      { ...envelope, preconditions: { nodes: [] } },
    ]) {
      expect(() => reduceProjectAgentMutation(running.state, { ...mutation, payload: changed })).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }),
      );
    }

    expect(() =>
      reduceProjectAgentMutation(running.state, {
        ...mutation,
        commandId: "async-extra-binding-field",
        payload: {
          ...envelope,
          binding: { ...binding, legacyArea: "creation" },
        },
      } as unknown as ProjectAgentMutation),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));

    const applied = reduceProjectAgentMutation(running.state, mutation);
    expect(applied.state.items).toContainEqual(expect.objectContaining({ itemId: "tool-a" }));
    expect(applied.state.turns[0]?.status).toBe("done");
    expect(applied.state.queue[0]?.status).toBe("done");
  });

  it("uses the explicit async outcome retryability while terminalizing the turn and queue", () => {
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const running = reduceProjectAgentMutation(queued.state, startMutation("command-start-failed", "turn-a", 1));
    const failed = reduceProjectAgentMutation(running.state, {
      commandId: "command-async-failed",
      expectedRevision: running.state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "token-turn-a" },
      type: "async.result",
      payload: {
        asyncToken: "token-turn-a",
        binding,
        threadId: "thread-a",
        turnId: "turn-a",
        queueItemId: "queue-turn-a",
        target,
        preconditions,
        expectedRevision: running.state.hostRevision,
        items: [],
        turnStatus: "failed",
        retryable: false,
        assistantFinal: {
          itemId: "assistant-turn-a",
          executionToken: "token-turn-a",
          expectedTextRevision: 0,
          text: "",
        },
        receivedAt: now,
      },
    });

    expect(failed.state.turns[0]).toMatchObject({ status: "failed", retryable: false });
    expect(failed.state.queue[0]).toMatchObject({ status: "failed", retryable: false });
  });

  it("does not resurrect declined, done, failed, or stopped records", () => {
    for (const terminal of ["declined", "done", "failed", "stopped"] as const) {
      let current = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
      if (terminal === "done") {
        current = reduceProjectAgentMutation(current.state, startMutation("command-start-before-done", "turn-a", 1));
      }
      const terminalResult =
        terminal === "done"
          ? reduceProjectAgentMutation(current.state, {
              commandId: "command-done",
              expectedRevision: current.state.hostRevision,
              binding,
              sender: { kind: "internal", senderId: "executor" },
              type: "async.result",
              payload: {
                asyncToken: "token-turn-a",
                binding,
                threadId: "thread-a",
                turnId: "turn-a",
                queueItemId: "queue-turn-a",
                target,
                preconditions,
                expectedRevision: current.state.hostRevision,
                items: [],
                turnStatus: "done",
                assistantFinal: {
                  itemId: "assistant-turn-a",
                  executionToken: "token-turn-a",
                  expectedTextRevision: 0,
                  text: "done",
                },
                receivedAt: now,
              },
            })
          : reduceProjectAgentMutation(current.state, {
              commandId: `command-${terminal}`,
              expectedRevision: current.state.hostRevision,
              binding,
              sender: { kind: "internal", senderId: "scheduler" },
              type: "turn.transition",
              payload: { turnId: "turn-a", status: terminal, updatedAt: now },
            });

      expect(() =>
        reduceProjectAgentMutation(terminalResult.state, {
          commandId: `command-resurrect-${terminal}`,
          expectedRevision: terminalResult.state.hostRevision,
          binding,
          sender: { kind: "internal", senderId: "scheduler" },
          type: "turn.transition",
          payload: { turnId: "turn-a", status: "running", updatedAt: now },
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({
          code: "status_transition_invalid",
        }),
      );
    }
  });

  it("blocks FIFO while pending, then releases it after expiry or user decline", () => {
    const queuedA = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const queuedB = reduceProjectAgentMutation(queuedA.state, {
      ...enqueueMutation("command-enqueue-b", "turn-b"),
      expectedRevision: 1,
    });
    const runningA = reduceProjectAgentMutation(queuedB.state, startMutation("command-start-a", "turn-a", 2));
    const approval = {
      ref: {
        approvalId: "approval-a",
        receiptProposalId: "receipt-approval-a",
        threadId: "thread-a",
        turnId: "turn-a",
        toolCallId: "tool-call-a",
        policyRevision: 5,
        inputHash: "input-hash",
        actionHash: "action-hash",
        target,
        preconditions,
        expiresAt: "2026-08-29T00:00:00.000Z",
      },
      lifecycle: "pending",
    } as const;
    const proposalItem = {
      kind: "proposal",
      itemId: "proposal-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "proposed",
      retryable: false,
      deviated: false,
      approval: approval.ref,
      createdAt: now,
      updatedAt: now,
    } as const;
    const proposed = reduceProjectAgentMutation(runningA.state, {
      commandId: "command-proposal",
      expectedRevision: 3,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "proposal.put",
      payload: { approval, item: proposalItem, occurredAt: now },
    });
    expect(proposed.state.turns.find((turn) => turn.turnId === "turn-a")?.status).toBe("proposed");
    expect(proposed.state.queue.find((item) => item.turnId === "turn-a")?.status).toBe("proposed");
    expect(() =>
      reduceProjectAgentMutation(proposed.state, startMutation("command-start-b-while-pending", "turn-b", 4)),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "queue_order_violation" }));
    expect(() =>
      reduceProjectAgentMutation(proposed.state, {
        commandId: "command-bypass-claim",
        expectedRevision: 4,
        binding,
        sender: { kind: "internal", senderId: "scheduler" },
        type: "turn.transition",
        payload: { turnId: "turn-a", status: "running", updatedAt: now },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({
        code: "proposal_transition_invalid",
      }),
    );
    expect(proposed.state.proposalApprovals[0]?.lifecycle).toBe("pending");

    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "command-claim",
      expectedRevision: 4,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });

    expect(claimed.state.proposalApprovals[0]).toMatchObject({
      lifecycle: "claimed",
      claimedAt: now,
    });
    expect(() =>
      reduceProjectAgentMutation(claimed.state, {
        commandId: "command-expire-after-claim",
        expectedRevision: 5,
        binding,
        sender: { kind: "internal", senderId: "authority" },
        type: "proposal.transition",
        payload: { approvalId: "approval-a", lifecycle: "expired", occurredAt: now },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({
        code: "proposal_transition_invalid",
      }),
    );

    const expired = reduceProjectAgentMutation(proposed.state, {
      commandId: "command-expire",
      expectedRevision: 4,
      binding,
      sender: { kind: "internal", senderId: "authority" },
      type: "proposal.transition",
      payload: {
        approvalId: "approval-a",
        lifecycle: "expired",
        occurredAt: "2026-08-29T00:00:00.000Z",
      },
    });
    expect(expired.state.proposalApprovals[0]).toMatchObject({
      lifecycle: "expired",
      expiredAt: "2026-08-29T00:00:00.000Z",
    });
    const afterExpiry = reduceProjectAgentMutation(
      expired.state,
      startMutation("command-start-b-after-expiry", "turn-b", 5),
    );
    expect(afterExpiry.state.turns.find((turn) => turn.turnId === "turn-b")?.status).toBe("running");

    const declined = reduceProjectAgentMutation(proposed.state, {
      commandId: "command-decline",
      expectedRevision: 4,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "turn.transition",
      payload: { turnId: "turn-a", status: "declined", updatedAt: now },
    });
    expect(declined.state.proposalApprovals).toEqual([]);
    const afterDecline = reduceProjectAgentMutation(
      declined.state,
      startMutation("command-start-b-after-decline", "turn-b", 5),
    );
    expect(afterDecline.state.turns.find((turn) => turn.turnId === "turn-b")?.status).toBe("running");
  });

  it("binds a deferred batch canvas admission before claiming its proposal even with a stale selection", () => {
    const base = enqueueMutation();
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), {
      ...base,
      payload: {
        ...base.payload,
        queueItem: {
          ...base.payload.queueItem,
          // The active canvas selection is captured on the queue request, but
          // a create batch has no stable target until its proposal is verified.
          target: { kind: "canvas", nodeIds: ["node-selected"] },
          preconditions: {},
        },
      },
    });
    const running = reduceProjectAgentMutation(queued.state, startMutation("start-deferred-canvas", "turn-a", 1));
    const deferredTarget = { kind: "canvas", nodeIds: ["node-created"] } as const;
    const deferredPreconditions = { edges: [{ relationHash: "sha256-empty-canvas" }] } as const;
    const approval = {
      ref: {
        approvalId: "approval-deferred-canvas",
        receiptProposalId: "receipt-deferred-canvas",
        threadId: "thread-a",
        turnId: "turn-a",
        toolCallId: "create-canvas",
        policyRevision: 5,
        inputHash: "input-hash",
        actionHash: "action-hash",
        target: deferredTarget,
        preconditions: deferredPreconditions,
        expiresAt: "2026-08-28T00:10:00.000Z",
      },
      lifecycle: "pending",
    } as const;
    const item = {
      kind: "proposal" as const,
      itemId: "proposal-deferred-canvas",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "proposed" as const,
      retryable: false,
      deviated: false,
      approval: approval.ref,
      createdAt: now,
      updatedAt: now,
    };
    const proposed = reduceProjectAgentMutation(running.state, {
      commandId: "put-deferred-canvas",
      expectedRevision: 2,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "proposal.put",
      payload: { approval, item, occurredAt: now },
    });
    expect(proposed.state.queue[0]).toMatchObject({
      status: "proposed",
      target: deferredTarget,
      preconditions: deferredPreconditions,
    });
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-deferred-canvas",
      expectedRevision: 3,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "proposal.transition",
      payload: { approvalId: approval.ref.approvalId, lifecycle: "claimed", occurredAt: now },
    });
    expect(claimed.state.proposalApprovals[0]?.lifecycle).toBe("claimed");
    expect(claimed.state.queue[0]).toMatchObject({ status: "running", target: deferredTarget });
  });

  it("stores only TaskRef and display-only HumanApprovalRef, never foreign truth", () => {
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueueMutation());
    const taskItem = {
      kind: "task",
      itemId: "task-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      task: { kind: "production-run", runId: "run-a" },
      createdAt: now,
      updatedAt: now,
    } as const;
    const withTask = reduceProjectAgentMutation(queued.state, {
      commandId: "command-task",
      expectedRevision: 1,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: taskItem },
    });
    const humanApproval = {
      challengeId: "challenge-a",
      handoffId: "handoff-a",
      binding,
      runId: "run-a",
      gateId: "gate-a",
      contractHash: "contract-hash",
    } as const;
    const withHumanDisplay = reduceProjectAgentMutation(withTask.state, {
      commandId: "command-human-display",
      expectedRevision: 2,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: {
        item: {
          kind: "proposal",
          itemId: "human-approval-a",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "done",
          retryable: false,
          deviated: false,
          humanApproval,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    expect(withHumanDisplay.state.items.find((item) => item.kind === "task")).toMatchObject({
      task: { kind: "production-run", runId: "run-a" },
    });
    expect(withHumanDisplay.state.items.find((item) => item.itemId === "human-approval-a")).toMatchObject({
      humanApproval,
    });

    for (const foreignItem of [
      { ...taskItem, itemId: "task-with-run-status", task: { ...taskItem.task, status: "running" } },
      {
        kind: "proposal" as const,
        itemId: "human-with-receipt",
        threadId: "thread-a",
        turnId: "turn-a",
        status: "proposed" as const,
        retryable: false,
        deviated: false,
        humanApproval: { ...humanApproval, approved: true, receiptId: "receipt-a" },
        createdAt: now,
        updatedAt: now,
      },
    ]) {
      expect(() =>
        reduceProjectAgentMutation(withHumanDisplay.state, {
          commandId: `command-foreign-${foreignItem.itemId}`,
          expectedRevision: 3,
          binding,
          sender: { kind: "internal", senderId: "host" },
          type: "item.put",
          payload: { item: foreignItem as ProjectAgentItem },
        }),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "foreign_domain_state" }));
    }
  });
});
