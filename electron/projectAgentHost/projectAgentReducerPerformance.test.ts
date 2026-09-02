import { describe, expect, it } from "vitest";

import type { ProjectAgentMutation } from "../shared/projectAgentContracts";
import * as reducerModule from "./projectAgentReducer";
import { ProjectAgentReducerError, reduceProjectAgentMutation } from "./projectAgentReducer";
import {
  __projectAgentFullValidationCountForTests,
  createInitialProjectAgentState,
  snapshotProjectAgentHostState,
} from "./projectAgentState";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;
const createdAt = "2026-08-28T00:00:00.000Z";

type ThreadPutMutation = Extract<ProjectAgentMutation, { type: "thread.put" }>;

function threadMutation(index: number): ThreadPutMutation {
  return {
    commandId: `thread-update-${index}`,
    expectedRevision: index,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "thread.put",
    payload: {
      thread: {
        threadId: "thread-a",
        title: `Title ${index}`,
        createdAt,
        updatedAt: new Date(Date.parse(createdAt) + index).toISOString(),
      },
      makeActive: true,
    },
  };
}

function enqueueMutation(index: number): ProjectAgentMutation {
  const turnId = `turn-${index}`;
  const timestamp = new Date(Date.parse(createdAt) + index).toISOString();
  const contextRef = {
    binding: {
      project: binding,
      threadId: "thread-a",
      sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
    },
    recordId: "context-a",
    contextRevision: 7,
  } as const;
  return {
    commandId: `enqueue-${index}`,
    expectedRevision: index,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: { threadId: "thread-a", createdAt, updatedAt: timestamp },
      turn: {
        turnId,
        threadId: "thread-a",
        status: "queued",
        retryable: false,
        deviated: false,
        executionToken: `token-${index}`,
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        contextRef,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      userItem: {
        kind: "user",
        itemId: `user-${index}`,
        threadId: "thread-a",
        turnId,
        status: "done",
        retryable: false,
        deviated: false,
        text: `queued request ${index}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      queueItem: {
        queueItemId: `queue-${index}`,
        threadId: "thread-a",
        turnId,
        status: "queued",
        retryable: false,
        deviated: false,
        binding,
        target: { kind: "canvas", nodeIds: ["node-a"] },
        preconditions: { nodes: [{ nodeId: "node-a", contentHash: "node-hash" }] },
        contextRef,
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        policyRevision: 1,
        attachmentRefs: [],
        originSurface: { surfaceId: "surface-a", kind: "canvas" },
        enqueuedAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
}

describe("ProjectAgent reducer bounded idempotency history", () => {
  it("keeps a fixed recent receipt window without revalidating the whole trusted state", () => {
    let state = createInitialProjectAgentState(binding);
    const validationCount = __projectAgentFullValidationCountForTests();
    let firstReceipt: ReturnType<typeof reduceProjectAgentMutation>["receipt"] | undefined;

    for (let index = 0; index < 1_000; index += 1) {
      const result = reduceProjectAgentMutation(state, threadMutation(index));
      if (index === 0) firstReceipt = result.receipt;
      state = result.state;
    }

    const bounded = state as typeof state & {
      commandLedgerHighWater: number;
      recentAppliedCommands: readonly { appliedRevision: number }[];
    };
    expect(bounded.commandLedgerHighWater).toBe(1_000);
    expect(bounded.recentAppliedCommands).toHaveLength(64);
    expect(bounded.recentAppliedCommands[0]?.appliedRevision).toBe(937);
    expect(bounded.recentAppliedCommands.at(-1)?.appliedRevision).toBe(1_000);
    expect(__projectAgentFullValidationCountForTests()).toBe(validationCount);
    expect(JSON.stringify(state).length).toBeLessThan(100_000);

    const recent = reduceProjectAgentMutation(state, threadMutation(999));
    expect(recent).toMatchObject({ replayed: true, snapshotRequired: false });
    if (recent.snapshotRequired) throw new Error("recent receipt unexpectedly compacted");
    expect(recent.patch).toEqual(recent.receipt.patch);

    const compactReplay = (
      reducerModule as typeof reducerModule & {
        replayProjectAgentCompactCommand: (
          snapshot: typeof state,
          mutation: ProjectAgentMutation,
          receipt: { commandId: string; mutationHash: string; appliedRevision: number },
        ) => ReturnType<typeof reduceProjectAgentMutation>;
      }
    ).replayProjectAgentCompactCommand;
    expect(compactReplay).toBeTypeOf("function");
    const compactReceipt = {
      commandId: firstReceipt!.commandId,
      mutationHash: firstReceipt!.mutationHash,
      appliedRevision: firstReceipt!.appliedRevision,
    };
    const old = compactReplay(state, threadMutation(0), compactReceipt);
    expect(old).toMatchObject({
      replayed: true,
      snapshotRequired: true,
      patch: null,
      receipt: compactReceipt,
    });
    expect(old.state).toBe(state);
    expect(() =>
      compactReplay(
        state,
        {
          ...threadMutation(0),
          payload: {
            ...threadMutation(0).payload,
            thread: { ...threadMutation(0).payload.thread, title: "changed" },
          },
        } as ProjectAgentMutation,
        compactReceipt,
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "command_id_conflict" }));
  });

  it("keeps queued-turn invariant validation out of the cubic growth path", () => {
    let state = createInitialProjectAgentState(binding);
    const validationsBefore = __projectAgentFullValidationCountForTests();
    for (let index = 0; index < 1_000; index += 1) {
      state = reduceProjectAgentMutation(state, enqueueMutation(index)).state;
    }
    expect(state.turns).toHaveLength(1_000);
    expect(state.queue).toHaveLength(1_000);
    // The cubic path is full-state revalidation per enqueue, so count it rather than time it.
    // 1,000 trusted appends must not trigger a single full validation, and that holds at any
    // machine speed. This was an 8s wall-clock budget until 2026-09-03, when it failed at 11.1s
    // under parallel load with no algorithmic change - it was measuring the machine, not the
    // algorithm. The sibling test above already used this counter.
    expect(__projectAgentFullValidationCountForTests()).toBe(validationsBefore);

    // Positive control: a zero delta only means something if the counter can move. Handing the
    // same state back as untrusted data must cost exactly one full validation.
    snapshotProjectAgentHostState(JSON.parse(JSON.stringify(state)) as unknown);
    expect(__projectAgentFullValidationCountForTests()).toBe(validationsBefore + 1);
  });
});
