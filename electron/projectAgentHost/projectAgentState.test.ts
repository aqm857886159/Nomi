import { describe, expect, it } from "vitest";

import {
  PROJECT_AGENT_ITEM_KINDS,
  PROJECT_AGENT_STATUSES,
  type ProjectBinding,
  type ProjectAgentThread,
} from "../shared/projectAgentContracts";
import {
  appendTrustedProjectAgentHostState,
  createInitialProjectAgentState,
  projectAgentPartitionKey,
  snapshotProjectAgentHostState,
} from "./projectAgentState";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;

describe("ProjectAgentHost state contract", () => {
  it("owns one closed status vocabulary and the seven stable item variants", () => {
    expect(PROJECT_AGENT_STATUSES).toEqual([
      "drafting",
      "proposed",
      "declined",
      "queued",
      "running",
      "done",
      "failed",
      "stopped",
    ]);
    expect(PROJECT_AGENT_ITEM_KINDS).toEqual(["user", "assistant", "tool", "proposal", "task", "artifact", "failure"]);
  });

  it("partitions by immutable UUID and generation instead of mutable projectId", () => {
    expect(projectAgentPartitionKey(binding)).toBe("project-agent.11111111-1111-4111-8111-111111111111.g3");
    expect(projectAgentPartitionKey({ ...binding, projectId: "renamed" })).toBe(projectAgentPartitionKey(binding));
    expect(projectAgentPartitionKey({ ...binding, projectGeneration: 4 })).not.toBe(projectAgentPartitionKey(binding));
  });

  it("accepts only the canonical workspace UUID and positive generation", () => {
    expect(() => projectAgentPartitionKey({ ...binding, immutableProjectUuid: "uuid-project-a" })).toThrow(
      /invalid_project_binding/,
    );
    expect(() => projectAgentPartitionKey({ ...binding, projectGeneration: 0 })).toThrow(/invalid_project_binding/);
    expect(() => projectAgentPartitionKey({ ...binding, projectId: " project-a " })).toThrow(/invalid_project_binding/);
    expect(() =>
      projectAgentPartitionKey({
        ...binding,
        immutableProjectUuid: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      }),
    ).toThrow(/invalid_project_binding/);
  });

  it("creates an immutable JSON snapshot detached from caller-owned binding", () => {
    const mutableBinding: { -readonly [Key in keyof ProjectBinding]: ProjectBinding[Key] } = { ...binding };
    const state = createInitialProjectAgentState(mutableBinding);

    mutableBinding.projectId = "mutated";

    expect(state.binding).toEqual(binding);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.binding)).toBe(true);
    expect(Reflect.set(state.binding, "projectId", "mutated-again")).toBe(false);
    expect(() => createInitialProjectAgentState({ ...binding, area: "creation" } as typeof binding)).toThrow(
      /invalid_project_binding/,
    );
  });

  it("keeps creation and generation area identity out of a project thread", () => {
    const thread: ProjectAgentThread = {
      threadId: "thread-a",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };

    expect(thread).not.toHaveProperty("area");
    expect(thread).not.toHaveProperty("sessionKey");
  });

  it("rejects a trusted delta whose receipt describes a different stored record", () => {
    const previous = createInitialProjectAgentState(binding);
    const actual = Object.freeze({
      threadId: "thread-a",
      title: "actual title",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    const described = Object.freeze({ ...actual, title: "receipt title" });

    expect(() =>
      appendTrustedProjectAgentHostState(
        previous,
        {
          binding: previous.binding,
          activeThreadId: "thread-a",
          threads: Object.freeze([actual]),
          turns: previous.turns,
          items: previous.items,
          queue: previous.queue,
          proposalApprovals: previous.proposalApprovals,
        },
        Object.freeze({
          commandId: "thread-a-put",
          mutationHash: "a".repeat(64),
          appliedRevision: 1,
          patch: Object.freeze({
            binding: previous.binding,
            previousRevision: 0,
            hostRevision: 1,
            changes: Object.freeze([{ kind: "thread-upserted", thread: described }] as const),
          }),
        }),
      ),
    ).toThrow(/invalid_state/);
  });

  it("rejects hidden trusted additions and same-length replacements omitted from the patch", () => {
    const empty = createInitialProjectAgentState(binding);
    const threadA = Object.freeze({
      threadId: "thread-a",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    const hidden = Object.freeze({ ...threadA, threadId: "thread-hidden", title: "hidden" });
    expect(() =>
      appendTrustedProjectAgentHostState(
        empty,
        {
          binding: empty.binding,
          activeThreadId: "thread-a",
          threads: Object.freeze([threadA, hidden]),
          turns: empty.turns,
          items: empty.items,
          queue: empty.queue,
          proposalApprovals: empty.proposalApprovals,
        },
        Object.freeze({
          commandId: "hidden-add",
          mutationHash: "a".repeat(64),
          appliedRevision: 1,
          patch: Object.freeze({
            binding: empty.binding,
            previousRevision: 0,
            hostRevision: 1,
            changes: Object.freeze([
              { kind: "thread-upserted", thread: threadA },
              { kind: "active-thread-changed", activeThreadId: "thread-a" },
            ] as const),
          }),
        }),
      ),
    ).toThrow(/invalid_state/);

    const previous = snapshotProjectAgentHostState({
      ...empty,
      activeThreadId: "thread-a",
      threads: [threadA, hidden],
    });
    const replacedHidden = Object.freeze({ ...hidden, title: "silently replaced" });
    expect(() =>
      appendTrustedProjectAgentHostState(
        previous,
        {
          binding: previous.binding,
          activeThreadId: "thread-a",
          threads: Object.freeze([threadA, replacedHidden]),
          turns: previous.turns,
          items: previous.items,
          queue: previous.queue,
          proposalApprovals: previous.proposalApprovals,
        },
        Object.freeze({
          commandId: "hidden-replacement",
          mutationHash: "b".repeat(64),
          appliedRevision: 1,
          patch: Object.freeze({
            binding: previous.binding,
            previousRevision: 0,
            hostRevision: 1,
            changes: Object.freeze([{ kind: "thread-upserted", thread: threadA }] as const),
          }),
        }),
      ),
    ).toThrow(/invalid_state/);
  });

  it("rejects checksum-valid but structurally invalid durable snapshots", () => {
    const base = createInitialProjectAgentState(binding);
    const thread = {
      threadId: "thread-a",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const turn = {
      turnId: "turn-a",
      threadId: "thread-a",
      status: "queued",
      retryable: false,
      deviated: false,
      executionToken: "token-a",
      model: { id: "model-a", version: 1 },
      skillVersions: [],
      capabilityVersions: [],
      contextRef: {
        binding: {
          project: binding,
          threadId: "thread-a",
          sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
        },
        recordId: "context-a",
        contextRevision: 1,
      },
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const user = {
      kind: "user",
      itemId: "item-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      text: "hello",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const queueItem = {
      queueItemId: "queue-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "queued",
      retryable: false,
      deviated: false,
      binding,
      target: { kind: "canvas", nodeIds: [] },
      preconditions: {},
      contextRef: {
        binding: {
          project: binding,
          threadId: "thread-a",
          sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
        },
        recordId: "context-a",
        contextRevision: 1,
      },
      model: { id: "model-a", version: 1 },
      skillVersions: [],
      capabilityVersions: [],
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface-a", kind: "canvas" },
      enqueuedAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const validShape = {
      ...base,
      activeThreadId: "thread-a",
      threads: [thread],
      turns: [turn],
      items: [user],
      queue: [queueItem],
    };
    const tool = {
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
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const threadB = { ...thread, threadId: "thread-b" };
    const before = "2026-08-27T23:59:59.999Z";
    const exportTask = {
      kind: "task",
      itemId: "export-task",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      task: { kind: "export-job", jobId: "export-a" },
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };

    expect(snapshotProjectAgentHostState({ ...validShape, items: [user, exportTask] }).items).toContainEqual(exportTask);
    for (const target of [
      { kind: "asset", assetIds: [] },
      { kind: "export", jobId: "export-a" },
      { kind: "export", timelineRevision: "revision-a" },
    ]) {
      expect(snapshotProjectAgentHostState({
        ...validShape,
        queue: [{ ...queueItem, target }],
      }).queue[0]?.target).toEqual(target);
    }

    const malformed = [
      { ...validShape, items: [{ ...user, status: "invented-status" }] },
      { ...validShape, items: [user, { ...user }] },
      {
        ...validShape,
        queue: [
          {
            ...queueItem,
            binding: {
              ...binding,
              immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
      },
      {
        ...validShape,
        hostRevision: 1,
        commandLedgerHighWater: 1,
        recentAppliedCommands: [
          {
            commandId: "command-a",
            mutationHash: "a".repeat(64),
            appliedRevision: 1,
            patch: {
              binding: { ...binding, projectGeneration: 4 },
              previousRevision: 0,
              hostRevision: 1,
              changes: [],
            },
          },
        ],
      },
      {
        ...validShape,
        items: [
          {
            ...user,
            kind: "task",
            task: { kind: "production-run", runId: "run-a", status: "running" },
          },
        ],
      },
      {
        ...validShape,
        items: [{ ...exportTask, task: { ...exportTask.task, status: "running" } }],
      },
      { ...validShape, queue: [{ ...queueItem, target: { kind: "export" } }] },
      { ...validShape, queue: [{ ...queueItem, target: { kind: "export", jobId: "job-a", timelineRevision: "revision-a" } }] },
      {
        ...validShape,
        threads: [thread, threadB],
        items: [{ ...user, threadId: "thread-b" }],
      },
      {
        ...validShape,
        threads: [thread, threadB],
        queue: [{ ...queueItem, threadId: "thread-b" }],
      },
      {
        ...validShape,
        threads: [thread, threadB],
        proposalApprovals: [
          {
            lifecycle: "pending",
            ref: {
              approvalId: "approval-a",
              receiptProposalId: "receipt-approval-a",
              threadId: "thread-b",
              turnId: "turn-a",
              toolCallId: "tool-a",
              policyRevision: queueItem.policyRevision,
              inputHash: "input-hash",
              actionHash: "action-hash",
              target: queueItem.target,
              preconditions: queueItem.preconditions,
              expiresAt: "2026-08-29T00:00:00.000Z",
            },
          },
        ],
      },
      { ...validShape, items: [{ ...user, parentItemId: "missing-parent" }] },
      {
        ...validShape,
        items: [
          user,
          {
            kind: "assistant",
            itemId: "assistant-forged-before-start",
            threadId: "thread-a",
            turnId: "turn-a",
            status: "done",
            retryable: false,
            deviated: false,
            text: "forged",
            textRevision: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
      {
        ...validShape,
        turns: [turn, { ...turn, turnId: "turn-b" }],
        items: [user, { ...user, itemId: "item-b", turnId: "turn-b" }],
        queue: [
          queueItem,
          {
            ...queueItem,
            queueItemId: "queue-b",
            turnId: "turn-b",
          },
        ],
      },
      {
        ...validShape,
        turns: [{ ...turn, status: "running" }],
        queue: [{ ...queueItem, status: "running" }],
      },
      {
        ...validShape,
        turns: [{ ...turn, status: "done" }],
        queue: [{ ...queueItem, status: "done" }],
      },
      {
        ...validShape,
        turns: [{ ...turn, status: "stopped" }],
        queue: [{ ...queueItem, status: "stopped" }],
        items: [
          user,
          {
            kind: "assistant",
            itemId: "assistant-running-after-stop",
            threadId: "thread-a",
            turnId: "turn-a",
            status: "running",
            retryable: false,
            deviated: false,
            text: "partial",
            textRevision: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
      { ...validShape, threads: [{ ...thread, updatedAt: before }] },
      {
        ...validShape,
        turns: [{ ...turn, createdAt: thread.createdAt, updatedAt: before }],
        queue: [{ ...queueItem, enqueuedAt: before, updatedAt: before }],
      },
      { ...validShape, items: [{ ...user, updatedAt: before }] },
      {
        ...validShape,
        turns: [{ ...turn, createdAt: before, updatedAt: before }],
        queue: [{ ...queueItem, updatedAt: before }],
      },
      {
        ...validShape,
        queue: [
          {
            ...queueItem,
            contextRef: { ...queueItem.contextRef, recordId: "context-b" },
          },
        ],
      },
      { ...validShape, queue: [] },
      {
        ...validShape,
        turns: [{ ...turn, status: "proposed" }],
        queue: [{ ...queueItem, status: "proposed" }],
      },
      { ...validShape, threads: [{ ...thread, threadId: " thread-a " }] },
      {
        ...validShape,
        threads: [{ ...thread, provenance: { kind: "legacy", readOnly: true } }],
      },
      {
        ...validShape,
        queue: [
          {
            ...queueItem,
            binding: { ...binding, area: "generation" },
          },
        ],
      },
      {
        ...validShape,
        turns: [
          {
            ...turn,
            contextRef: {
              ...turn.contextRef,
              binding: { ...turn.contextRef.binding, legacyArea: "creation" },
            },
          },
        ],
      },
      {
        ...validShape,
        items: [
          user,
          {
            kind: "task",
            itemId: "task-running",
            threadId: "thread-a",
            turnId: "turn-a",
            status: "running",
            retryable: false,
            deviated: false,
            task: { kind: "production-run", runId: "run-a" },
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          },
        ],
      },
      {
        ...validShape,
        items: [
          user,
          {
            kind: "proposal",
            itemId: "human-extra-binding",
            threadId: "thread-a",
            turnId: "turn-a",
            status: "done",
            retryable: false,
            deviated: false,
            humanApproval: {
              challengeId: "challenge-a",
              handoffId: "handoff-a",
              binding: { ...binding, area: "creation" },
              runId: "run-a",
              gateId: "gate-a",
              contractHash: "contract-a",
            },
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          },
        ],
      },
      {
        ...validShape,
        items: [user, tool, { ...tool, itemId: "tool-b" }],
      },
      {
        ...validShape,
        items: [user, tool, { ...tool, itemId: "tool-c", toolCallId: "tool-call-c" }],
      },
    ];

    for (const [index, candidate] of malformed.entries()) {
      expect(() => snapshotProjectAgentHostState(candidate), `malformed candidate ${index}`).toThrow();
    }
  });
});
