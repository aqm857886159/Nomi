import { describe, expect, it } from "vitest";

import type {
  ProjectAgentAsyncResultEnvelope,
  ProjectAgentAppliedCommand,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentMutation,
  ProjectAgentProposalApproval,
  ProjectAgentProposalItem,
  ProposalApprovalRef,
} from "../shared/projectAgentContracts";
import {
  ProjectAgentReducerError,
  createProjectAgentSerialReducer,
  reduceProjectAgentMutation,
} from "./projectAgentReducer";
import {
  appendTrustedProjectAgentHostState,
  createInitialProjectAgentState,
  snapshotProjectAgentHostState,
} from "./projectAgentState";

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
const contextRef = {
  binding: {
    project: binding,
    threadId: "thread-a",
    sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
  },
  recordId: "context-a",
  contextRevision: 7,
} as const;

type ApprovalProposalItem = Extract<ProjectAgentProposalItem, { approval: ProposalApprovalRef }>;

function enqueue(): ProjectAgentMutation {
  return {
    commandId: "enqueue-a",
    expectedRevision: 0,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: { threadId: "thread-a", createdAt: now, updatedAt: now },
      turn: {
        turnId: "turn-a",
        threadId: "thread-a",
        status: "queued",
        retryable: false,
        deviated: false,
        executionToken: "token-a",
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        contextRef,
        createdAt: now,
        updatedAt: now,
      },
      userItem: {
        kind: "user",
        itemId: "user-a",
        threadId: "thread-a",
        turnId: "turn-a",
        status: "done",
        retryable: false,
        deviated: false,
        text: "inspect the frozen target",
        createdAt: now,
        updatedAt: now,
      },
      queueItem: {
        queueItemId: "queue-a",
        threadId: "thread-a",
        turnId: "turn-a",
        status: "queued",
        retryable: false,
        deviated: false,
        binding,
        target,
        preconditions,
        contextRef,
        model: { id: "model-a", version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }],
        policyRevision: 5,
        attachmentRefs: [],
        originSurface: { surfaceId: "surface-a", kind: "canvas" },
        enqueuedAt: now,
        updatedAt: now,
      },
    },
  };
}

function runningState(): ProjectAgentHostState {
  const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueue());
  return reduceProjectAgentMutation(queued.state, {
    commandId: "start-a",
    expectedRevision: 1,
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
        createdAt: now,
        updatedAt: now,
      },
      occurredAt: now,
    },
  }).state;
}

function proposal(
  approvalId: string,
  itemId: string,
): {
  approval: ProjectAgentProposalApproval;
  item: ApprovalProposalItem;
} {
  const ref = {
    approvalId,
    receiptProposalId: `receipt-${approvalId}`,
    threadId: "thread-a",
    turnId: "turn-a",
    toolCallId: `tool-${approvalId}`,
    policyRevision: 1,
    inputHash: `input-${approvalId}`,
    actionHash: `action-${approvalId}`,
    target,
    preconditions,
    expiresAt: "2026-08-29T00:00:00.000Z",
  } as const;
  return {
    approval: { ref, lifecycle: "pending" },
    item: {
      kind: "proposal",
      itemId,
      threadId: "thread-a",
      turnId: "turn-a",
      status: "proposed",
      retryable: false,
      deviated: false,
      approval: ref,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function putProposal(state: ProjectAgentHostState, value: ReturnType<typeof proposal>, commandId: string) {
  return reduceProjectAgentMutation(state, {
    commandId,
    expectedRevision: state.hostRevision,
    binding,
    sender: { kind: "embedded-agent", senderId: "agent" },
    type: "proposal.put",
    payload: { ...value, occurredAt: now },
  });
}

describe("ProjectAgent proposal reducer boundary", () => {
  it("durably preserves the exact capability invocation identity", () => {
    const value = proposal("approval-durable", "proposal-durable");
    const proposed = putProposal(runningState(), value, "put-durable");
    const restarted = snapshotProjectAgentHostState(JSON.parse(JSON.stringify(proposed.state)) as ProjectAgentHostState);

    expect(restarted.proposalApprovals[0]?.ref).toEqual(value.approval.ref);
    expect(restarted.items.find((item) => item.itemId === "proposal-durable")).toMatchObject({
      kind: "proposal",
      approval: value.approval.ref,
    });

    for (const field of ["receiptProposalId", "policyRevision", "inputHash"] as const) {
      const incompleteRef = { ...value.approval.ref } as Record<string, unknown>;
      delete incompleteRef[field];
      expect(() =>
        putProposal(
          runningState(),
          {
            approval: { ...value.approval, ref: incompleteRef as ProposalApprovalRef },
            item: { ...value.item, approval: incompleteRef as ProposalApprovalRef },
          },
          `put-missing-${field}`,
        ),
      ).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({
          code: expect.stringMatching(/^(invalid_mutation|proposal_transition_invalid)$/),
        }),
      );

      expect(() =>
        snapshotProjectAgentHostState({
          ...proposed.state,
          proposalApprovals: [{ ...value.approval, ref: incompleteRef as ProposalApprovalRef }],
          items: proposed.state.items.map((item) =>
            item.itemId === value.item.itemId
              ? ({ ...value.item, approval: incompleteRef as ProposalApprovalRef } as ProjectAgentProposalItem)
              : item,
          ),
        }),
      ).toThrow(/invalid_state/);
    }
  });

  it("atomically requires one matching visible card for the frozen queue target", () => {
    const state = runningState();
    const valid = proposal("approval-a", "proposal-a");
    const foreignRef = {
      ...valid.approval.ref,
      target: { kind: "canvas" as const, nodeIds: ["node-b"] },
    };
    const candidates: Array<{ payload: unknown; code: ProjectAgentReducerError["code"] }> = [
      {
        payload: { approval: valid.approval, occurredAt: now },
        code: "invalid_mutation",
      },
      {
        payload: {
          approval: valid.approval,
          item: {
            ...valid.item,
            approval: { ...valid.item.approval, actionHash: "different-action" },
          },
          occurredAt: now,
        },
        code: "proposal_transition_invalid",
      },
      {
        payload: {
          approval: { ...valid.approval, ref: foreignRef },
          item: { ...valid.item, approval: foreignRef },
          occurredAt: now,
        },
        code: "proposal_transition_invalid",
      },
      {
        payload: {
          approval: {
            ...valid.approval,
            ref: { ...valid.approval.ref, expiresAt: "not-a-date" },
          },
          item: {
            ...valid.item,
            approval: { ...valid.item.approval, expiresAt: "not-a-date" },
          },
          occurredAt: now,
        },
        code: "invalid_mutation",
      },
    ];

    for (const [index, candidate] of candidates.entries()) {
      expect(() =>
        reduceProjectAgentMutation(state, {
          commandId: `invalid-proposal-${index}`,
          expectedRevision: state.hostRevision,
          binding,
          sender: { kind: "embedded-agent", senderId: "agent" },
          type: "proposal.put",
          payload: candidate.payload,
        } as ProjectAgentMutation),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: candidate.code }));
    }
    expect(state.items.some((item) => item.kind === "proposal")).toBe(false);
    expect(state.proposalApprovals).toEqual([]);
  });

  it("settles only the exact approval card and can continue the same running turn", () => {
    const first = proposal("approval-a", "proposal-a");
    const proposedA = putProposal(runningState(), first, "put-a");
    const claimedA = reduceProjectAgentMutation(proposedA.state, {
      commandId: "claim-a",
      expectedRevision: proposedA.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });
    const continuationItem: ProjectAgentItem = {
      kind: "tool",
      itemId: "tool-result-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      toolCallId: "tool-approval-a",
      invocationId: "invocation-a",
      capability: { id: "canvas.read", version: 1 },
      resultRef: "result-a",
      createdAt: now,
      updatedAt: now,
    };
    const envelope: ProjectAgentAsyncResultEnvelope = {
      asyncToken: "token-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-a",
      target,
      preconditions,
      expectedRevision: claimedA.state.hostRevision,
      items: [continuationItem],
      turnStatus: "running",
      proposalApprovalId: "approval-a",
      proposalStatus: "done",
      receivedAt: now,
    };
    const continued = reduceProjectAgentMutation(claimedA.state, {
      commandId: "continue-after-a",
      expectedRevision: claimedA.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: envelope,
    });

    expect(continued.state.turns[0]?.status).toBe("running");
    expect(continued.state.queue[0]?.status).toBe("running");
    expect(continued.state.items.find((item) => item.itemId === "proposal-a")?.status).toBe("done");

    const second = proposal("approval-b", "proposal-b");
    const proposedB = putProposal(continued.state, second, "put-b");
    const expiredB = reduceProjectAgentMutation(proposedB.state, {
      commandId: "expire-b",
      expectedRevision: proposedB.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "authority" },
      type: "proposal.transition",
      payload: {
        approvalId: "approval-b",
        lifecycle: "expired",
        occurredAt: "2026-08-29T00:00:00.000Z",
      },
    });

    expect(expiredB.state.items.find((item) => item.itemId === "proposal-a")?.status).toBe("done");
    expect(expiredB.state.items.find((item) => item.itemId === "proposal-b")?.status).toBe("stopped");
  });

  it("atomically settles every running proposal from the multi-approval envelope", () => {
    const first = proposal("approval-a", "proposal-a");
    const proposedA = putProposal(runningState(), first, "put-a");
    const claimedA = reduceProjectAgentMutation(proposedA.state, {
      commandId: "claim-a",
      expectedRevision: proposedA.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });
    const second = proposal("approval-b", "proposal-b");
    const proposedB = putProposal(claimedA.state, second, "put-b");
    const claimedB = reduceProjectAgentMutation(proposedB.state, {
      commandId: "claim-b",
      expectedRevision: proposedB.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-b" },
      type: "proposal.transition",
      payload: { approvalId: "approval-b", lifecycle: "claimed", occurredAt: now },
    });
    const assistant = claimedB.state.items.find(
      (item) => item.kind === "assistant" && item.turnId === "turn-a",
    );
    const turn = claimedB.state.turns.find((item) => item.turnId === "turn-a");
    if (assistant?.kind !== "assistant" || turn === undefined) {
      throw new Error("expected the running turn and assistant fixture");
    }
    const base: ProjectAgentAsyncResultEnvelope = {
      asyncToken: "token-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-a",
      target,
      preconditions,
      expectedRevision: claimedB.state.hostRevision,
      items: [],
      turnStatus: "failed",
      retryable: false,
      assistantFinal: {
        itemId: assistant.itemId,
        executionToken: turn.executionToken,
        expectedTextRevision: assistant.textRevision,
        text: assistant.text,
      },
      receivedAt: now,
    };

    expect(() => reduceProjectAgentMutation(claimedB.state, {
      commandId: "settle-partial",
      expectedRevision: claimedB.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: {
        ...base,
        proposalSettlements: [{ approvalId: "approval-a", status: "done" }],
      },
    })).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }));
    expect(claimedB.state.items.filter((item) => item.kind === "proposal").every((item) => item.status === "running")).toBe(true);

    const settled = reduceProjectAgentMutation(claimedB.state, {
      commandId: "settle-all",
      expectedRevision: claimedB.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: {
        ...base,
        proposalSettlements: [
          { approvalId: "approval-a", status: "done" },
          { approvalId: "approval-b", status: "failed" },
        ],
      },
    });
    expect(settled.state.items.find((item) => item.itemId === "proposal-a")).toMatchObject({
      status: "done",
      retryable: false,
    });
    expect(settled.state.items.find((item) => item.itemId === "proposal-b")).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(settled.state.turns[0]).toMatchObject({ status: "failed", retryable: false });
  });

  it("rejects an approval record that carries both lifecycle timestamps", () => {
    const proposed = putProposal(
      runningState(),
      proposal("approval-closed-set", "proposal-closed-set"),
      "put-closed-set",
    );
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-closed-set",
      expectedRevision: proposed.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-closed-set", lifecycle: "claimed", occurredAt: now },
    });
    const approval = claimed.state.proposalApprovals[0]!;

    expect(() =>
      snapshotProjectAgentHostState({
        ...claimed.state,
        proposalApprovals: [{ ...approval, expiredAt: "2026-08-28T00:00:01.000Z" }],
      }),
    ).toThrow(/invalid_state/);
  });

  it("rejects an approval lifecycle timestamp outside the owning turn timeline", () => {
    const proposed = putProposal(
      runningState(),
      proposal("approval-time-order", "proposal-time-order"),
      "put-time-order",
    );
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-time-order",
      expectedRevision: proposed.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-time-order", lifecycle: "claimed", occurredAt: now },
    });
    const approval = claimed.state.proposalApprovals[0]!;

    expect(() =>
      snapshotProjectAgentHostState({
        ...claimed.state,
        proposalApprovals: [{ ...approval, claimedAt: "2026-08-28T00:00:01.000Z" }],
      }),
    ).toThrow(/invalid_state/);
  });

  it("rejects a new approval that reuses a settled tool call or receipt identity", () => {
    const first = proposal("approval-a", "proposal-a");
    const proposed = putProposal(runningState(), first, "put-a");
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-a",
      expectedRevision: proposed.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });
    const continued = reduceProjectAgentMutation(claimed.state, {
      commandId: "settle-a",
      expectedRevision: claimed.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: {
        asyncToken: "token-a",
        binding,
        threadId: "thread-a",
        turnId: "turn-a",
        queueItemId: "queue-a",
        target,
        preconditions,
        expectedRevision: claimed.state.hostRevision,
        items: [],
        turnStatus: "running",
        proposalApprovalId: "approval-a",
        proposalStatus: "done",
        receivedAt: now,
      },
    });
    const second = proposal("approval-b", "proposal-b");
    const reusedRef = { ...second.approval.ref, toolCallId: first.approval.ref.toolCallId };
    const reusedItem: ProjectAgentProposalItem = { ...second.item, approval: reusedRef };
    expect(() =>
      putProposal(
        continued.state,
        {
          approval: { ...second.approval, ref: reusedRef },
          item: reusedItem,
        },
        "put-b",
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));

    const reusedReceiptRef = {
      ...second.approval.ref,
      receiptProposalId: first.approval.ref.receiptProposalId,
    };
    expect(() =>
      putProposal(
        continued.state,
        {
          approval: { ...second.approval, ref: reusedReceiptRef },
          item: { ...second.item, approval: reusedReceiptRef },
        },
        "put-reused-receipt",
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));
  });

  it("rejects a durable state whose settled approvals reuse a tool call identity", () => {
    const first = proposal("approval-a", "proposal-a");
    const proposed = putProposal(runningState(), first, "put-a");
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-a",
      expectedRevision: proposed.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });
    const continued = reduceProjectAgentMutation(claimed.state, {
      commandId: "settle-a",
      expectedRevision: claimed.state.hostRevision,
      binding,
      sender: { kind: "internal", senderId: "executor" },
      type: "async.result",
      payload: {
        asyncToken: "token-a",
        binding,
        threadId: "thread-a",
        turnId: "turn-a",
        queueItemId: "queue-a",
        target,
        preconditions,
        expectedRevision: claimed.state.hostRevision,
        items: [],
        turnStatus: "running",
        proposalApprovalId: "approval-a",
        proposalStatus: "done",
        receivedAt: now,
      },
    });
    const second = proposal("approval-b", "proposal-b");
    const reusedRef = { ...second.approval.ref, toolCallId: first.approval.ref.toolCallId };
    const duplicateItem = { ...second.item, approval: reusedRef, status: "done" } as ProjectAgentProposalItem;
    const duplicateApproval = { ref: reusedRef, lifecycle: "claimed", claimedAt: now } as ProjectAgentProposalApproval;

    expect(() =>
      snapshotProjectAgentHostState({
        ...continued.state,
        items: [...continued.state.items, duplicateItem],
        proposalApprovals: [...continued.state.proposalApprovals, duplicateApproval],
      }),
    ).toThrowError(/invalid_state/);
  });

  it("reserves receipt proposal identity after the active approval record is removed", () => {
    const base = runningState();
    const historical = proposal("approval-history", "proposal-history");
    const withHistory = snapshotProjectAgentHostState({
      ...base,
      items: [...base.items, { ...historical.item, status: "declined" }],
    });
    expect(withHistory.proposalApprovals).toEqual([]);

    const next = proposal("approval-next", "proposal-next");
    const reusedReceiptRef = {
      ...next.approval.ref,
      receiptProposalId: historical.approval.ref.receiptProposalId,
    };
    expect(() =>
      putProposal(
        withHistory,
        {
          approval: { ...next.approval, ref: reusedReceiptRef },
          item: { ...next.item, approval: reusedReceiptRef },
        },
        "put-reused-historical-receipt",
      ),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));
  });

  it("rejects restart state with duplicate receipt identity across terminal proposal cards", () => {
    const base = runningState();
    const first = proposal("approval-history-a", "proposal-history-a");
    const second = proposal("approval-history-b", "proposal-history-b");
    const duplicateReceipt = {
      ...second.item,
      status: "done" as const,
      approval: {
        ...second.item.approval,
        receiptProposalId: first.item.approval.receiptProposalId,
      },
    };

    expect(() =>
      snapshotProjectAgentHostState({
        ...base,
        items: [...base.items, { ...first.item, status: "done" }, duplicateReceipt],
      }),
    ).toThrow(/invalid_state/);

    const firstTerminal = Object.freeze({ ...first.item, status: "done" as const });
    const duplicateTerminal = Object.freeze(duplicateReceipt);
    const next = {
      ...base,
      items: [...base.items, firstTerminal, duplicateTerminal],
    };
    const receipt: ProjectAgentAppliedCommand = {
      commandId: "duplicate-terminal-receipt-trusted",
      mutationHash: "c".repeat(64),
      appliedRevision: base.hostRevision + 1,
      patch: {
        binding,
        previousRevision: base.hostRevision,
        hostRevision: base.hostRevision + 1,
        changes: [
          { kind: "item-upserted", item: firstTerminal },
          { kind: "item-upserted", item: duplicateTerminal },
        ],
      },
    };
    expect(() => appendTrustedProjectAgentHostState(base, next, receipt)).toThrow(/invalid_state/);
  });

  it("rejects duplicate semantic TaskRef cards", () => {
    const state = runningState();
    const task = { kind: "production-run", runId: "run-a", jobId: "job-a" } as const;
    const first = reduceProjectAgentMutation(state, {
      commandId: "task-a",
      expectedRevision: state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: {
        item: {
          kind: "task",
          itemId: "task-a",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "done",
          retryable: false,
          deviated: false,
          task,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    expect(() =>
      reduceProjectAgentMutation(first.state, {
        commandId: "task-duplicate",
        expectedRevision: first.state.hostRevision,
        binding,
        sender: { kind: "embedded-agent", senderId: "agent" },
        type: "item.put",
        payload: {
          item: {
            ...first.state.items.find((item) => item.itemId === "task-a")!,
            itemId: "task-b",
          } as ProjectAgentItem,
        },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));
  });

  it("rejects duplicate semantic ArtifactRef cards at ingress, snapshot, and trusted delta boundaries", () => {
    const state = runningState();
    const artifact = {
      kind: "artifact" as const,
      itemId: "artifact-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done" as const,
      retryable: false,
      deviated: false,
      artifact: {
        runId: "run-a",
        artifactId: "artifact-a",
        version: 1,
        contentHash: "hash-a",
        resultId: "result-a",
      },
      createdAt: now,
      updatedAt: now,
    };
    const first = reduceProjectAgentMutation(state, {
      commandId: "artifact-a",
      expectedRevision: state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: artifact },
    });
    const duplicate = { ...artifact, itemId: "artifact-b", artifact: { ...artifact.artifact, resultId: "result-b" } };

    expect(() =>
      reduceProjectAgentMutation(first.state, {
        commandId: "artifact-b-ingress",
        expectedRevision: first.state.hostRevision,
        binding,
        sender: { kind: "embedded-agent", senderId: "agent" },
        type: "item.put",
        payload: { item: duplicate },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));

    expect(() => snapshotProjectAgentHostState({ ...first.state, items: [...first.state.items, duplicate] })).toThrow(
      /invalid_state/,
    );

    const next = { ...first.state, items: [...first.state.items, duplicate] };
    const receipt: ProjectAgentAppliedCommand = {
      commandId: "artifact-b-trusted",
      mutationHash: "b".repeat(64),
      appliedRevision: first.state.hostRevision + 1,
      patch: {
        binding,
        previousRevision: first.state.hostRevision,
        hostRevision: first.state.hostRevision + 1,
        changes: [{ kind: "item-upserted", item: duplicate }],
      },
    };
    expect(() => appendTrustedProjectAgentHostState(first.state, next, receipt)).toThrow(/invalid_state/);
  });

  it("reserves proposed and claimed execution for atomic proposal commands", () => {
    const running = runningState();
    expect(() =>
      reduceProjectAgentMutation(running, {
        commandId: "generic-propose",
        expectedRevision: running.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "scheduler" },
        type: "turn.transition",
        payload: { turnId: "turn-a", status: "proposed", updatedAt: now },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({
        code: "proposal_transition_invalid",
      }),
    );

    const proposed = putProposal(running, proposal("approval-a", "proposal-a"), "put-a");
    const claimed = reduceProjectAgentMutation(proposed.state, {
      commandId: "claim-a",
      expectedRevision: proposed.state.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: "renderer-a" },
      type: "proposal.transition",
      payload: { approvalId: "approval-a", lifecycle: "claimed", occurredAt: now },
    });
    for (const mutation of [
      {
        commandId: "generic-finish-claimed",
        expectedRevision: claimed.state.hostRevision,
        binding,
        sender: { kind: "internal" as const, senderId: "scheduler" },
        type: "turn.transition" as const,
        payload: { turnId: "turn-a", status: "done" as const, updatedAt: now },
      },
      {
        commandId: "generic-finish-proposal-card",
        expectedRevision: claimed.state.hostRevision,
        binding,
        sender: { kind: "internal" as const, senderId: "scheduler" },
        type: "item.transition" as const,
        payload: { itemId: "proposal-a", status: "done" as const, updatedAt: now },
      },
    ]) {
      expect(() => reduceProjectAgentMutation(claimed.state, mutation)).toThrow();
    }
    expect(claimed.state.items.find((item) => item.itemId === "proposal-a")?.status).toBe("running");
  });

  it("rejects proposal events that run backward or cross the expiry boundary", () => {
    const later = "2026-08-28T00:01:00.000Z";
    const queued = reduceProjectAgentMutation(createInitialProjectAgentState(binding), enqueue());
    const running = reduceProjectAgentMutation(queued.state, {
      commandId: "start-later",
      expectedRevision: queued.state.hostRevision,
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
          createdAt: later,
          updatedAt: later,
        },
        occurredAt: later,
      },
    });
    const value = proposal("approval-a", "proposal-a");
    expect(() =>
      reduceProjectAgentMutation(running.state, {
        commandId: "stale-proposal",
        expectedRevision: running.state.hostRevision,
        binding,
        sender: { kind: "embedded-agent", senderId: "agent" },
        type: "proposal.put",
        payload: { ...value, occurredAt: now },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectAgentReducerError>>({
        code: "proposal_transition_invalid",
      }),
    );

    const proposed = putProposal(runningState(), value, "put-a");
    for (const [commandId, lifecycle, occurredAt] of [
      ["late-claim", "claimed", "2026-08-29T00:00:00.000Z"],
      ["early-expire", "expired", now],
    ] as const) {
      expect(() =>
        reduceProjectAgentMutation(proposed.state, {
          commandId,
          expectedRevision: proposed.state.hostRevision,
          binding,
          sender: { kind: "internal", senderId: "authority" },
          type: "proposal.transition",
          payload: { approvalId: "approval-a", lifecycle, occurredAt },
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ProjectAgentReducerError>>({
          code: "proposal_transition_invalid",
        }),
      );
    }
  });

  it("keeps TaskRef and HumanApprovalRef cards fixed as local completed records", () => {
    const state = runningState();
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
    const task = reduceProjectAgentMutation(state, {
      commandId: "put-task",
      expectedRevision: state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: taskItem },
    });
    const humanItem = {
      kind: "proposal",
      itemId: "human-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      humanApproval: {
        challengeId: "challenge-a",
        handoffId: "handoff-a",
        binding,
        runId: "run-a",
        gateId: "gate-a",
        contractHash: "contract-a",
      },
      createdAt: now,
      updatedAt: now,
    } as const;
    const human = reduceProjectAgentMutation(task.state, {
      commandId: "put-human",
      expectedRevision: task.state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: humanItem },
    });

    const invalidForeignItems: readonly unknown[] = [
      { ...taskItem, itemId: "task-running", status: "running" as const },
      { ...taskItem, itemId: "task-failed", status: "failed" as const },
      { ...humanItem, itemId: "human-proposed", status: "proposed" as const },
    ];
    for (const [index, item] of invalidForeignItems.entries()) {
      expect(() =>
        reduceProjectAgentMutation(human.state, {
          commandId: `invalid-foreign-item-${index}`,
          expectedRevision: human.state.hostRevision,
          binding,
          sender: { kind: "internal", senderId: "host" },
          type: "item.put",
          payload: { item: item as ProjectAgentItem },
        }),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "foreign_domain_state" }));
    }
    for (const itemId of ["task-a", "human-a"]) {
      expect(() =>
        reduceProjectAgentMutation(human.state, {
          commandId: `transition-${itemId}`,
          expectedRevision: human.state.hostRevision,
          binding,
          sender: { kind: "internal", senderId: "host" },
          type: "item.transition",
          payload: { itemId, status: "running", updatedAt: now },
        }),
      ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "foreign_domain_state" }));
    }
    const durableTurn = human.state.turns[0]!;
    const durableQueue = human.state.queue[0]!;
    expect(Object.isFrozen(durableTurn)).toBe(true);
    expect(Object.isFrozen(durableTurn.contextRef)).toBe(true);
    expect(Object.isFrozen(durableQueue)).toBe(true);
    expect(Object.isFrozen(durableQueue.target)).toBe(true);
    expect(Object.isFrozen(human.state.recentAppliedCommands.at(-1)?.patch)).toBe(true);
    expect(Reflect.set(durableTurn, "status", "done")).toBe(false);
    expect(human.state.turns[0]?.status).toBe("running");
    const afterMutationAttempt = reduceProjectAgentMutation(human.state, {
      commandId: "valid-after-mutation-attempt",
      expectedRevision: human.state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: {
        item: {
          kind: "artifact",
          itemId: "artifact-after-mutation-attempt",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "done",
          retryable: false,
          deviated: false,
          artifact: {
            runId: "run-after-mutation-attempt",
            artifactId: "artifact-after-mutation-attempt",
            version: 1,
            contentHash: "artifact-hash",
          },
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    expect(afterMutationAttempt.state.turns[0]?.status).toBe("running");
  });

  it("rejects async proposal and semantic-ref bypasses", () => {
    const state = runningState();
    const value = proposal("approval-a", "proposal-a");
    const base: ProjectAgentAsyncResultEnvelope = {
      asyncToken: "token-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-a",
      target,
      preconditions,
      expectedRevision: state.hostRevision,
      items: [],
      turnStatus: "running",
      receivedAt: now,
    };
    expect(() =>
      reduceProjectAgentMutation(state, {
        commandId: "async-hidden-proposal",
        expectedRevision: state.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "executor" },
        type: "async.result",
        payload: { ...base, items: [value.item] },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "invalid_mutation" }));
    expect(() =>
      reduceProjectAgentMutation(state, {
        commandId: "async-orphan-proposed",
        expectedRevision: state.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "executor" },
        type: "async.result",
        payload: { ...base, turnStatus: "proposed" },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }));
    expect(() =>
      reduceProjectAgentMutation(state, {
        commandId: "async-settlement-without-approval",
        expectedRevision: state.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "executor" },
        type: "async.result",
        payload: { ...base, proposalStatus: "done" },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "async_result_stale" }));

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
    const withTask = reduceProjectAgentMutation(state, {
      commandId: "put-task-before-async",
      expectedRevision: state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: taskItem },
    });
    expect(() =>
      reduceProjectAgentMutation(withTask.state, {
        commandId: "async-duplicate-task",
        expectedRevision: withTask.state.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "executor" },
        type: "async.result",
        payload: {
          ...base,
          expectedRevision: withTask.state.hostRevision,
          items: [{ ...taskItem, itemId: "task-b" }],
        },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));

    const humanItem = {
      kind: "proposal",
      itemId: "human-a",
      threadId: "thread-a",
      turnId: "turn-a",
      status: "done",
      retryable: false,
      deviated: false,
      humanApproval: {
        challengeId: "challenge-a",
        handoffId: "handoff-a",
        binding,
        runId: "run-a",
        gateId: "gate-a",
        contractHash: "contract-a",
      },
      createdAt: now,
      updatedAt: now,
    } as const;
    const withHuman = reduceProjectAgentMutation(withTask.state, {
      commandId: "put-human-before-async",
      expectedRevision: withTask.state.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: { item: humanItem },
    });
    expect(() =>
      reduceProjectAgentMutation(withHuman.state, {
        commandId: "async-duplicate-human",
        expectedRevision: withHuman.state.hostRevision,
        binding,
        sender: { kind: "internal", senderId: "executor" },
        type: "async.result",
        payload: {
          ...base,
          expectedRevision: withHuman.state.hostRevision,
          items: [{ ...humanItem, itemId: "human-b" }],
        },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProjectAgentReducerError>>({ code: "record_exists" }));
  });

  it("normalizes malformed payloads and keeps the serial tail usable", async () => {
    const initial = runningState();
    const serial = createProjectAgentSerialReducer(initial);
    const baseAsync = {
      asyncToken: "token-a",
      binding,
      threadId: "thread-a",
      turnId: "turn-a",
      queueItemId: "queue-a",
      target,
      preconditions,
      expectedRevision: initial.hostRevision,
      items: null,
      turnStatus: "running",
      receivedAt: now,
    };
    const malformed = [
      { ...enqueue(), commandId: "null-thread", type: "thread.put", payload: null },
      { ...enqueue(), commandId: "null-item", type: "item.put", payload: { item: null } },
      { ...enqueue(), commandId: "null-async-items", type: "async.result", payload: baseAsync },
    ] as unknown as ProjectAgentMutation[];
    for (const mutation of malformed) {
      await expect(serial.dispatch({ ...mutation, expectedRevision: initial.hostRevision })).rejects.toMatchObject({
        code: "invalid_mutation",
      });
    }

    const valid = await serial.dispatch({
      commandId: "valid-after-malformed",
      expectedRevision: initial.hostRevision,
      binding,
      sender: { kind: "embedded-agent", senderId: "agent" },
      type: "item.put",
      payload: {
        item: {
          kind: "artifact",
          itemId: "artifact-after-malformed",
          threadId: "thread-a",
          turnId: "turn-a",
          status: "done",
          retryable: false,
          deviated: false,
          artifact: {
            runId: "run-after-malformed",
            artifactId: "artifact-after-malformed",
            version: 1,
            contentHash: "artifact-hash",
          },
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    expect(valid.state.hostRevision).toBe(initial.hostRevision + 1);
  });
});
