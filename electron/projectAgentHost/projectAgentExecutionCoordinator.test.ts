import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectBinding,
  ProposalApprovalRef,
} from "../shared/projectAgentContracts";
import type {
  AgentChatCapability,
  AgentChatRequest,
  AgentChatResponse,
  AgentChatToolDecision,
} from "../harness/agentChatContracts";
import type { RuntimeToolCall } from "../harness/runtime/runtimePort";
import { createProjectAgentContextBinding } from "./projectAgentContextBinding";
import {
  createProjectAgentExecutionCoordinator,
  ProjectAgentSubscriptionError,
} from "./projectAgentExecutionCoordinator";
import { createProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import type {
  PiDocumentWriteTransportAdapter,
  PreparedDocumentWrite,
} from "../capabilityCore/documentWriteTransportAdapters";
import type {
  CanvasWriteApprovalAuthority,
  PiCanvasWriteTransportAdapter,
  PreparedCanvasWrite,
} from "../capabilityCore/canvasWriteTransportAdapters";
import type {
  PiTimelineWriteTransportAdapter,
  PreparedTimelineWrite,
  TimelineWriteApprovalAuthority,
} from "../capabilityCore/timelineTransportAdapters";
import type {
  PiPhase4SurfaceTransportAdapter,
  PreparedExportWrite,
} from "../capabilityCore/phase4SurfaceTransportAdapters";
import type {
  PiSkillWriteTransportAdapter,
  PreparedSkillWrite,
} from "../capabilityCore/skillWriteTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import type { PiProductionRunTransportAdapter } from "../capabilityCore/productionRunTransportAdapters";
import type { PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import type {
  ProjectAgentCommittedProposalRecord,
  ProjectAgentProposalReceiptView,
} from "../shared/projectAgentProposalReceipt";
import type { ProjectAgentProposalReceiptWriter } from "./projectAgentExecutionCoordinatorTypes";
import {
  createProjectAgentProposalReceiptService,
  projectAgentProposalReceiptPath,
} from "./projectAgentProposalReceiptStore";

function skillWriteAdapter(): PiSkillWriteTransportAdapter & {
  prepare: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(async (
    call: RuntimeToolCall,
    context: Readonly<{ target: TargetRef; preconditions: PreconditionSet }>,
    _signal: AbortSignal,
  ): Promise<PreparedSkillWrite | null> => {
    if (call.toolName !== "author_skill") return null;
    return Object.freeze({
      call,
      args: { operation: "author_skill", ...(call.args as Record<string, unknown>) } as PreparedSkillWrite["args"],
      pkg: {
        version: "nomi-skill-v1",
        exportedAt: 1,
        dirName: "test-skill",
        files: { "SKILL.md": "body", "skill.json": "{}" },
      },
      invocation: {
        target: context.target,
        preconditions: context.preconditions,
        policyRevision: 1,
        inputHash: "a".repeat(64),
        actionHash: "b".repeat(64),
      },
    } as PreparedSkillWrite);
  });
  const execute = vi.fn(async (_prepared: PreparedSkillWrite, approval: { receiptProposalId: string }) => ({
    ok: true as const,
    result: { applied: true, skillName: "test.skill", dirName: "test-skill", packageVersion: "nomi-skill-v1", contentHash: "c".repeat(64), created: true },
    proposalId: approval.receiptProposalId,
    silent: true as const,
  }));
  const dispose = vi.fn();
  return { prepare, execute, dispose } as unknown as PiSkillWriteTransportAdapter & {
    prepare: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function skillReadAdapter(): PiSkillReadTransportAdapter & {
  tryExecute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const tryExecute = vi.fn(async (call: RuntimeToolCall) => call.toolName === "load_skill"
    ? {
        ok: true as const,
        silent: true as const,
        result: {
          loaded: true,
          name: "brand.promo",
          directoryName: "brand-promo",
          description: "Brand workflow",
          body: "Use the brand workflow.",
          origin: "user" as const,
          packageVersion: "nomi-skill-v1",
          contentHash: "a".repeat(64),
        },
      }
    : null);
  const dispose = vi.fn();
  return { tryExecute, dispose } as unknown as PiSkillReadTransportAdapter & {
    tryExecute: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

type ExecutionInput = Parameters<ReturnType<typeof createProjectAgentExecutionCoordinator>["enqueue"]>[1];

function executionInput(
  id: string,
  expectedRevision: number,
  projectBinding: ProjectBinding = binding,
  options: Readonly<{ threadId?: string; prompt?: string; capability?: AgentChatCapability }> = {},
): ExecutionInput {
  const occurredAt = "2026-08-28T00:00:00.000Z";
  const thread = {
    threadId: options.threadId ?? `thread-${id}`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const contextRef = {
    binding: createProjectAgentContextBinding(projectBinding, thread.threadId),
    contextRevision: 0,
    recordId: `context-${id}`,
  } as const;
  const turn = {
    turnId: `turn-${id}`,
    threadId: thread.threadId,
    executionToken: `token-${id}`,
    model: { id: "model", version: 1 },
    skillVersions: [],
    capabilityVersions: [{ id: "creation-chat", version: 1 }],
    contextRef,
    status: "queued" as const,
    retryable: false,
    deviated: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const userItem = {
    itemId: `user-${id}`,
    threadId: thread.threadId,
    turnId: turn.turnId,
    kind: "user" as const,
    text: id,
    status: "done" as const,
    retryable: false,
    deviated: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const queueItem = {
    queueItemId: `queue-${id}`,
    threadId: thread.threadId,
    turnId: turn.turnId,
    binding: projectBinding,
    target: { kind: "document" as const, documentId: `document-${id}`, anchor: { kind: "whole-document" as const } },
    preconditions: {},
    contextRef,
    model: turn.model,
    skillVersions: [],
    capabilityVersions: turn.capabilityVersions,
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: { surfaceId: `surface-${id}`, kind: "document" as const },
    enqueuedAt: occurredAt,
    status: "queued" as const,
    retryable: false,
    deviated: false,
    updatedAt: occurredAt,
  };
  return {
    mutation: {
      commandId: `enqueue-${id}`,
      expectedRevision,
      binding: projectBinding,
      sender: { kind: "renderer" as const, senderId: `renderer-${id}` },
      type: "turn.enqueue" as const,
      payload: { thread, turn, userItem, queueItem },
    },
    request: {
      prompt: options.prompt ?? id,
      capability: options.capability ?? "creation-chat",
      history: { kind: "ephemeral" as const },
      projectId: projectBinding.projectId,
    },
  };
}

function documentWriteAdapter(
  options: Readonly<{
    prepareError?: string;
    result?: AgentChatToolDecision;
  }> = {},
): PiDocumentWriteTransportAdapter & {
  prepare: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(
    async (
      call: RuntimeToolCall,
      input: Readonly<{ documentId: string; target: TargetRef; preconditions: PreconditionSet }>,
      _signal: AbortSignal,
    ): Promise<PreparedDocumentWrite | null> => {
      if (options.prepareError) {
        throw Object.assign(new Error(options.prepareError), { code: options.prepareError });
      }
      const inputHash = createHash("sha256").update(JSON.stringify(call.args)).digest("hex");
      const actionHash = createHash("sha256")
        .update(
          JSON.stringify({ call: call.toolName, inputHash, target: input.target, preconditions: input.preconditions }),
        )
        .digest("hex");
      const invocation = {
        target: input.target,
        preconditions: input.preconditions,
        policyRevision: 1,
        inputHash,
        actionHash,
      } as unknown as PreparedDocumentWrite["invocation"];
      return Object.freeze({ call, invocation });
    },
  );
  const execute = vi.fn(
    async (_prepared: PreparedDocumentWrite, _signal: AbortSignal): Promise<AgentChatToolDecision> =>
      options.result ?? {
        ok: true,
        result: { applied: true, revision: 2, contentHash: "fnv1a-next" },
        silent: true,
      },
  );
  const dispose = vi.fn();
  return { prepare, execute, dispose } as unknown as PiDocumentWriteTransportAdapter & {
    prepare: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function documentWriteResponse(call: RuntimeToolCall, decision: AgentChatToolDecision): AgentChatResponse {
  return {
    id: `result-${call.toolCallId}`,
    status: "finished",
    text: "done",
    finishReason: "stop",
    artifacts: [],
    toolCalls: [
      {
        ...call,
        status: decision.ok ? "ok" : "denied",
        ...(decision.ok && decision.result !== undefined ? { result: decision.result } : {}),
        decision,
      },
    ],
    usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
  };
}

function canvasWriteAdapter(
  options: Readonly<{
    prepareError?: string;
    prepareErrors?: readonly (string | undefined)[];
    result?: AgentChatToolDecision;
    executeError?: string;
  }> = {},
): PiCanvasWriteTransportAdapter & {
  prepare: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  let prepareCallCount = 0;
  const prepare = vi.fn(async (call: RuntimeToolCall, _signal: AbortSignal): Promise<PreparedCanvasWrite | null> => {
    if (call.toolName !== "set_node_prompt" && call.toolName !== "create_canvas_nodes") return null;
    const prepareError = options.prepareErrors?.[prepareCallCount++] ?? options.prepareError;
    if (prepareError) {
      throw Object.assign(new Error(prepareError), { code: prepareError });
    }
    const invocation = {
      input: call.toolName === "create_canvas_nodes"
        ? { operation: "create_canvas_nodes", ...(call.args as Record<string, unknown>) }
        : { operation: "set_node_prompt", nodeId: "node-real", prompt: "new prompt" },
      target: { kind: "canvas", nodeIds: ["node-real"] },
      preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
      policyRevision: 1,
      inputHash: "input-hash",
      actionHash: "action-hash",
    } as unknown as PreparedCanvasWrite["invocation"];
    return Object.freeze({ call, invocation });
  });
  const execute = vi.fn(
    async (
      _prepared: PreparedCanvasWrite,
      approval: CanvasWriteApprovalAuthority,
      _signal: AbortSignal,
    ): Promise<AgentChatToolDecision> => {
      if (options.executeError) throw new Error(options.executeError);
      return (
        options.result ?? {
          ok: true,
          result: { applied: true, proposalId: approval.receiptProposalId },
          silent: true,
        }
      );
    },
  );
  const dispose = vi.fn();
  return { prepare, execute, dispose } as unknown as PiCanvasWriteTransportAdapter & {
    prepare: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function timelineWriteAdapter(): PiTimelineWriteTransportAdapter & {
  prepare: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(async (call: RuntimeToolCall): Promise<PreparedTimelineWrite | null> => {
    if (call.toolName !== "apply_edit_plan" && call.toolName !== "undo_timeline_edit") return null;
    const invocation = {
      input: { operation: "apply_edit_plan" },
      target: { kind: "timeline", clipIds: ["clip-a"] },
      preconditions: { timeline: { revision: "deadbeef" } },
      policyRevision: 1,
      inputHash: "timeline-input-hash",
      actionHash: "timeline-action-hash",
    } as unknown as PreparedTimelineWrite["invocation"];
    return Object.freeze({ call, invocation });
  });
  const execute = vi.fn(async (
    _prepared: PreparedTimelineWrite,
    _approval: TimelineWriteApprovalAuthority,
  ): Promise<AgentChatToolDecision> => ({
    ok: true,
    result: { operation: "apply_edit_plan", ok: true, revision: "cafebabe", applied: true },
    silent: true,
  }));
  const dispose = vi.fn();
  return { prepare, execute, dispose } as unknown as PiTimelineWriteTransportAdapter & {
    prepare: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function committedCanvasReceipt(
  projectBinding: ProjectBinding,
  approval: CanvasWriteApprovalAuthority,
): ProjectAgentProposalReceiptView {
  return Object.freeze({
    binding: projectBinding,
    revision: 2,
    lifecycle: "committed" as const,
    proposalId: approval.receiptProposalId,
    operationId: "commit-canvas-proposal",
    proposal: Object.freeze({
      proposalId: approval.receiptProposalId,
      hostApprovalId: approval.approvalId,
      hostActionHash: approval.actionHash,
      summary: "Updated node prompt",
      stepLabels: Object.freeze(["Update prompt"]),
      compensation: Object.freeze([]),
      watchNodes: Object.freeze([]),
      reconciliationOk: true,
    }),
  });
}

function canvasExecutionInput(
  id: string,
  expectedRevision: number,
  projectBinding: ProjectBinding = binding,
): ExecutionInput {
  const base = executionInput(id, expectedRevision, projectBinding);
  return {
    ...base,
    mutation: {
      ...base.mutation,
      payload: {
        ...base.mutation.payload,
        queueItem: {
          ...base.mutation.payload.queueItem,
          target: { kind: "canvas", nodeIds: ["node-real"] },
          preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
          originSurface: { surfaceId: "canvas-surface", kind: "canvas" },
        },
      },
    },
  };
}

async function seedClaimedCanvasExecution(
  recoveryRoot: string,
  projectBinding: ProjectBinding,
  id: string,
): Promise<Readonly<{ approval: ProposalApprovalRef }>> {
  const host = createProjectAgentRepositoryRouter({ rootDir: recoveryRoot }).attach(projectBinding);
  const input = canvasExecutionInput(id, 0, projectBinding);
  let state = (await host.dispatch(input.mutation)).state;
  state = (
    await host.dispatch({
      commandId: `start-${id}`,
      expectedRevision: state.hostRevision,
      binding: projectBinding,
      sender: { kind: "internal", senderId: "test" },
      type: "turn.start",
      payload: {
        turnId: input.mutation.payload.turn.turnId,
        queueItemId: input.mutation.payload.queueItem.queueItemId,
        assistantItem: {
          itemId: `assistant-${id}`,
          threadId: input.mutation.payload.thread.threadId,
          turnId: input.mutation.payload.turn.turnId,
          kind: "assistant",
          text: "",
          textRevision: 0,
          status: "running",
          retryable: false,
          deviated: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
        occurredAt: "2026-08-28T00:00:00.000Z",
      },
    })
  ).state;
  const approval: ProposalApprovalRef = Object.freeze({
    approvalId: `approval-${id}`,
    receiptProposalId: `receipt-${id}`,
    threadId: input.mutation.payload.thread.threadId,
    turnId: input.mutation.payload.turn.turnId,
    toolCallId: `tool-${id}`,
    policyRevision: input.mutation.payload.queueItem.policyRevision,
    inputHash: "b".repeat(64),
    actionHash: "a".repeat(64),
    target: input.mutation.payload.queueItem.target,
    preconditions: input.mutation.payload.queueItem.preconditions,
    expiresAt: "2026-08-29T00:00:00.000Z",
  });
  state = (
    await host.dispatch({
      commandId: `proposal-${id}`,
      expectedRevision: state.hostRevision,
      binding: projectBinding,
      sender: { kind: "internal", senderId: "test" },
      type: "proposal.put",
      payload: {
        approval: { ref: approval, lifecycle: "pending" },
        item: {
          itemId: `proposal-${id}`,
          threadId: approval.threadId,
          turnId: approval.turnId,
          kind: "proposal",
          approval,
          status: "proposed",
          retryable: false,
          deviated: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
        occurredAt: "2026-08-28T00:00:00.000Z",
      },
    })
  ).state;
  await host.dispatch({
    commandId: `claim-${id}`,
    expectedRevision: state.hostRevision,
    binding: projectBinding,
    sender: { kind: "internal", senderId: "test" },
    type: "proposal.transition",
    payload: {
      approvalId: approval.approvalId,
      lifecycle: "claimed",
      occurredAt: "2026-08-28T00:00:00.000Z",
    },
  });
  return Object.freeze({ approval });
}

async function seedSecondClaimedCanvasApproval(
  recoveryRoot: string,
  projectBinding: ProjectBinding,
  first: ProposalApprovalRef,
): Promise<ProposalApprovalRef> {
  const host = createProjectAgentRepositoryRouter({ rootDir: recoveryRoot }).attach(projectBinding);
  let state = host.getSnapshot(projectBinding);
  const approval: ProposalApprovalRef = Object.freeze({
    ...first,
    approvalId: `${first.approvalId}-second`,
    receiptProposalId: `${first.receiptProposalId}-second`,
    toolCallId: `${first.toolCallId}-second`,
    inputHash: "d".repeat(64),
    actionHash: "c".repeat(64),
  });
  state = (
    await host.dispatch({
      commandId: `proposal-${approval.approvalId}`,
      expectedRevision: state.hostRevision,
      binding: projectBinding,
      sender: { kind: "internal", senderId: "test" },
      type: "proposal.put",
      payload: {
        approval: { ref: approval, lifecycle: "pending" },
        item: {
          itemId: `proposal-${approval.approvalId}`,
          threadId: approval.threadId,
          turnId: approval.turnId,
          kind: "proposal",
          approval,
          status: "proposed",
          retryable: false,
          deviated: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
        occurredAt: "2026-08-28T00:00:00.000Z",
      },
    })
  ).state;
  await host.dispatch({
    commandId: `claim-${approval.approvalId}`,
    expectedRevision: state.hostRevision,
    binding: projectBinding,
    sender: { kind: "internal", senderId: "test" },
    type: "proposal.transition",
    payload: {
      approvalId: approval.approvalId,
      lifecycle: "claimed",
      occurredAt: "2026-08-28T00:00:00.000Z",
    },
  });
  return approval;
}

function canvasWriteResponse(call: RuntimeToolCall, decision: AgentChatToolDecision): AgentChatResponse {
  return {
    id: `result-${call.toolCallId}`,
    status: "finished",
    text: "done",
    finishReason: "stop",
    artifacts: [],
    toolCalls: [{ ...call, status: decision.ok ? "ok" : "denied", decision }],
    usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
  };
}

let root = "";

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgentExecutionCoordinator", () => {
  it("uses the Host turn work mode when freezing the runtime request", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-work-mode-freeze-"));
    const router = createProjectAgentRepositoryRouter({ rootDir: root });
    let observedRequest: AgentChatRequest | undefined;
    const coordinator = createProjectAgentExecutionCoordinator(router, () => "subscription-work-mode-freeze", {
      runAgent: async (request) => {
        observedRequest = request;
        return {
          id: "result-work-mode-freeze",
          status: "finished",
          text: "done",
          finishReason: "stop",
          artifacts: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
        } satisfies AgentChatResponse;
      },
    });
    const opened = await coordinator.open(binding);
    const base = executionInput("work-mode-freeze", 0);
    const input: ExecutionInput = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          turn: { ...base.mutation.payload.turn, workMode: "editSelection" },
          queueItem: { ...base.mutation.payload.queueItem, workMode: "editSelection" },
        },
      },
      request: {
        ...base.request,
        workMode: "agent",
        approvalPolicy: { mode: "project", spend: "within-budget" },
      } as AgentChatRequest,
    };

    await coordinator.enqueue(opened.subscriptionId, input);
    await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(observedRequest?.workMode).toBe("editSelection");
    expect((observedRequest as AgentChatRequest & { approvalPolicy?: unknown }).approvalPolicy).toBeUndefined();
  });

  it("denies an Ask-mode write before it reaches the document adapter", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-ask-read-only-"));
    const documentAdapter = documentWriteAdapter();
    let observedDecision: AgentChatToolDecision | undefined;
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-ask-read-only",
      {
        runAgent: async (_request, hooks) => {
          const call = { toolCallId: "tool-ask-write", toolName: "append_to_end", args: { content: "x" } };
          observedDecision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, observedDecision);
        },
      },
    );
    const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
    const base = executionInput("ask-read-only", 0);
    const input: ExecutionInput = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          turn: { ...base.mutation.payload.turn, workMode: "ask" },
          queueItem: { ...base.mutation.payload.queueItem, workMode: "ask" },
        },
      },
      request: { ...base.request, workMode: "agent" } as AgentChatRequest,
    };

    await coordinator.enqueue(opened.subscriptionId, input);
    await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(observedDecision).toMatchObject({ ok: false, denied: true, message: expect.stringContaining("Ask") });
    expect(documentAdapter.prepare).not.toHaveBeenCalled();
    expect(documentAdapter.execute).not.toHaveBeenCalled();
  });

  it("persists terminal model usage on the Host turn and restores it after reopening", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-usage-ledger-"));
    const usage = { promptTokens: 17, completionTokens: 5, cachedPromptTokens: 3, totalTokens: 22 } as const;
    const createCoordinator = () => createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-usage-ledger",
      {
        runAgent: async () => ({
          id: "usage-result",
          status: "finished",
          text: "done",
          finishReason: "stop",
          artifacts: [],
          toolCalls: [],
          usage,
        }),
      },
    );
    const input = executionInput("usage-ledger", 0);
    const first = createCoordinator();
    const opened = await first.open(input.mutation.binding);
    await first.enqueue(opened.subscriptionId, input);
    await first.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(first.snapshot(opened.subscriptionId).turns[0]?.usage).toEqual(usage);
    first.release(opened.subscriptionId);

    const reopened = createCoordinator();
    const restored = await reopened.open(input.mutation.binding);
    expect(reopened.snapshot(restored.subscriptionId).turns[0]?.usage).toEqual(usage);
    reopened.release(restored.subscriptionId);
  });

  it("reuses one approval for reversible edits while preserving a receipt per write", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-safe-auto-"));
    const documentAdapter = documentWriteAdapter();
    const calls = [
      { toolCallId: "tool-safe-1", toolName: "append_to_end", args: { content: "first" } },
      { toolCallId: "tool-safe-2", toolName: "append_to_end", args: { content: "second" } },
    ];
    const decisions: AgentChatToolDecision[] = [];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-safe-auto",
      {
        runAgent: async (_request, hooks) => {
          for (const call of calls) decisions.push(await hooks.awaitToolConfirmation(call, hooks.abortSignal!));
          return {
            id: "result-safe-auto",
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: calls.map((call, index) => ({ ...call, status: decisions[index]?.ok ? "ok" as const : "denied" as const, decision: decisions[index]! })),
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
    let toolEvents = 0;
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      toolEvents += 1;
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, { ok: true, result: { approved: true } });
    });
    const base = executionInput("safe-auto", 0);
    const input: ExecutionInput = {
      ...base,
      mutation: { ...base.mutation, payload: {
        ...base.mutation.payload,
        turn: { ...base.mutation.payload.turn, approvalPolicy: { mode: "safe-auto", spend: "confirm" } },
        queueItem: { ...base.mutation.payload.queueItem, approvalPolicy: { mode: "safe-auto", spend: "confirm" } },
      } },
    };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(toolEvents).toBe(1);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ ok: true });
    expect(decisions[1]).toMatchObject({ ok: true, silent: true });
    expect(documentAdapter.execute).toHaveBeenCalledTimes(2);
    expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(2);
    coordinator.release(opened.subscriptionId);
  });

  it("reserves the first frozen request while a same-turn enqueue is still dispatching", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-request-reservation-"));
    const backingRouter = createProjectAgentRepositoryRouter({ rootDir: root });
    const backingHost = backingRouter.attach(binding);
    let releaseDispatch!: () => void;
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    let dispatchEntered!: () => void;
    const firstDispatchEntered = new Promise<void>((resolve) => {
      dispatchEntered = resolve;
    });
    let enqueueDispatchCount = 0;
    const host = {
      ...backingHost,
      dispatch: (mutation: ProjectAgentMutation) => {
        if (mutation.type !== "turn.enqueue") return backingHost.dispatch(mutation);
        enqueueDispatchCount += 1;
        if (enqueueDispatchCount === 1) dispatchEntered();
        return dispatchGate.then(() => backingHost.dispatch(mutation));
      },
    };
    const router = {
      attach: () => host,
      repositoryFor: backingRouter.repositoryFor,
      partitionCount: backingRouter.partitionCount,
    } as unknown as Parameters<typeof createProjectAgentExecutionCoordinator>[0];
    const executedPrompts: string[] = [];
    const coordinator = createProjectAgentExecutionCoordinator(router, () => "subscription-request-reservation", {
      runAgent: async (request) => {
        executedPrompts.push(request.prompt);
        return {
          id: "result-request-reservation",
          status: "finished",
          text: "done",
          finishReason: "stop",
          artifacts: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
        } satisfies AgentChatResponse;
      },
    });
    const opened = await coordinator.open(binding);
    const firstInput = executionInput("request-reservation", 0);
    const firstEnqueue = coordinator.enqueue(opened.subscriptionId, firstInput);
    await firstDispatchEntered;

    const conflictingRequest = expect(
      coordinator.enqueue(opened.subscriptionId, {
        mutation: firstInput.mutation,
        request: { ...firstInput.request, prompt: "replacement-request" },
      }),
    ).rejects.toThrow(ProjectAgentSubscriptionError);
    const exactReplay = coordinator.enqueue(opened.subscriptionId, firstInput);

    releaseDispatch();
    await conflictingRequest;
    const reductions = await Promise.all([firstEnqueue, exactReplay]);
    expect(reductions.map((reduction) => reduction.replayed).sort()).toEqual([false, true]);
    await coordinator.waitForTurn(opened.subscriptionId, firstInput.mutation.payload.turn.turnId);
    expect(executedPrompts).toEqual(["request-reservation"]);
    expect(enqueueDispatchCount).toBe(2);
  });

  it("replays pre-live notifications once in order before switching the subscription live", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-pre-live-buffer-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-pre-live",
    );
    const opened = await coordinator.open(binding);
    expect(opened.snapshot.hostRevision).toBe(0);
    const putThread = (id: string, expectedRevision: number): ProjectAgentMutation => ({
      commandId: `put-${id}`,
      expectedRevision,
      binding,
      sender: { kind: "renderer", senderId: opened.subscriptionId },
      type: "thread.put",
      payload: {
        thread: {
          threadId: id,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    });
    await coordinator.dispatch(opened.subscriptionId, putThread("thread-buffer-a", 0));
    await coordinator.dispatch(opened.subscriptionId, putThread("thread-buffer-b", 1));

    const revisions: number[] = [];
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "patch") revisions.push(event.patch.hostRevision);
    });
    expect(revisions).toEqual([1, 2]);

    await coordinator.dispatch(opened.subscriptionId, putThread("thread-buffer-live", 2));
    expect(revisions).toEqual([1, 2, 3]);
  });

  it("keeps different ProjectBinding partitions strictly isolated", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-binding-isolation-"));
    const subscriptionIds = ["subscription-binding-a", "subscription-binding-b"];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => subscriptionIds.shift()!,
    );
    const otherBinding = {
      projectId: "project-b",
      immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
      projectGeneration: 1,
    } as const;
    const first = await coordinator.open(binding);
    const second = await coordinator.open(otherBinding);
    const secondEvents: ProjectAgentExecutionEvent[] = [];
    coordinator.subscribe(second.subscriptionId, (event) => secondEvents.push(event));

    await coordinator.dispatch(first.subscriptionId, {
      commandId: "put-binding-a-thread",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: first.subscriptionId },
      type: "thread.put",
      payload: {
        thread: {
          threadId: "thread-binding-a",
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    });

    expect(coordinator.snapshot(first.subscriptionId).hostRevision).toBe(1);
    expect(coordinator.snapshot(second.subscriptionId).hostRevision).toBe(0);
    expect(secondEvents).toEqual([]);
  });

  it("shares one binding FIFO and monotonic fanout across live subscriptions", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-partition-"));
    const subscriptionIds = ["subscription-partition-a", "subscription-partition-b"];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const calls: string[] = [];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => subscriptionIds.shift()!,
      {
        runAgent: async (request) => {
          calls.push(request.prompt);
          if (request.prompt === "partition-a") {
            firstStarted();
            await firstBlocked;
          }
          return {
            id: `result-${request.prompt}`,
            status: "finished",
            text: request.prompt,
            finishReason: "stop",
            artifacts: [],
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const first = await coordinator.open(binding);
    const second = await coordinator.open(binding);
    const firstEvents: ProjectAgentExecutionEvent[] = [];
    const secondEvents: ProjectAgentExecutionEvent[] = [];
    coordinator.subscribe(first.subscriptionId, (event) => firstEvents.push(event));
    coordinator.subscribe(second.subscriptionId, (event) => secondEvents.push(event));

    const firstInput = executionInput("partition-a", 0);
    await coordinator.enqueue(first.subscriptionId, firstInput);
    await firstStart;
    const secondInput = executionInput("partition-b", coordinator.snapshot(second.subscriptionId).hostRevision);
    await coordinator.enqueue(second.subscriptionId, secondInput);
    expect(calls).toEqual(["partition-a"]);

    coordinator.release(first.subscriptionId);
    releaseFirst();
    await coordinator.waitForTurn(second.subscriptionId, firstInput.mutation.payload.turn.turnId);
    await coordinator.waitForTurn(second.subscriptionId, secondInput.mutation.payload.turn.turnId);

    expect(calls).toEqual(["partition-a", "partition-b"]);
    expect(secondEvents.filter((event) => event.type === "execution-result").map((event) => event.turnId)).toEqual([
      "turn-partition-a",
      "turn-partition-b",
    ]);
    expect(
      firstEvents.every((event) => event.subscriptionId === first.subscriptionId && event.subscriptionEpoch === 1),
    ).toBe(true);
    expect(
      secondEvents.every((event) => event.subscriptionId === second.subscriptionId && event.subscriptionEpoch === 2),
    ).toBe(true);
    const firstPatchRevisions = firstEvents
      .filter((event) => event.type === "patch")
      .map((event) => event.patch.hostRevision);
    const secondPatchRevisions = secondEvents
      .filter((event) => event.type === "patch")
      .map((event) => event.patch.hostRevision);
    expect(firstPatchRevisions).toEqual(secondPatchRevisions.slice(0, firstPatchRevisions.length));
    expect(secondPatchRevisions).toEqual([...secondPatchRevisions].sort((left, right) => left - right));
  });

  it("keeps a Thread's tool profile sticky for KV-cache stability", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-tool-profile-"));
    const seen: Array<{ profile: AgentChatRequest["toolProfile"] }> = [];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-tool-profile",
      {
        runAgent: async (request) => {
          seen.push({ profile: request.toolProfile });
          return {
            id: `result-${seen.length}`,
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 1, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    const first = executionInput("profile-first", 0, binding, {
      threadId: "thread-sticky-profile",
      prompt: "检查时间线并导出",
      capability: "canvas-agent",
    });
    await coordinator.enqueue(opened.subscriptionId, first);
    const firstState = await coordinator.waitForTurn(opened.subscriptionId, first.mutation.payload.turn.turnId);
    const second = executionInput("profile-second", firstState.hostRevision, binding, {
      threadId: "thread-sticky-profile",
      prompt: "继续",
      capability: "canvas-agent",
    });
    await coordinator.enqueue(opened.subscriptionId, second);
    await coordinator.waitForTurn(opened.subscriptionId, second.mutation.payload.turn.turnId);

    expect(seen.map(({ profile }) => profile)).toEqual(["timeline", "timeline"]);
  });

  it("routes a started ProductionRun through Host history and a task ref", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-production-host-"));
    const productionRun = {
      tryExecute: vi.fn(async (call: RuntimeToolCall) => call.toolName === "start_production_run"
        ? {
            ok: true as const,
            result: { runId: "run-host-1", revision: 1, stageId: "direction" },
            silent: true as const,
          }
        : null),
      prepare: vi.fn(async () => null),
      execute: vi.fn(async () => ({ ok: false as const, code: "unexpected_execute" })),
      dispose: vi.fn(),
    } as unknown as PiProductionRunTransportAdapter & {
      tryExecute: ReturnType<typeof vi.fn>;
      prepare: ReturnType<typeof vi.fn>;
      execute: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    };
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-production-host",
      {
        productionRun: () => productionRun,
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "production-start-1",
            toolName: "start_production_run",
            args: { goal: "做一个五分钟品牌片" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return {
            id: "production-result-1",
            status: "finished",
            text: "已建立制作任务草稿。",
            finishReason: "toolUse",
            artifacts: [],
            toolCalls: [{ ...call, status: decision.ok ? "ok" as const : "error" as const, decision, ...(decision.ok ? { result: decision.result } : {}) }],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 1, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    const input = executionInput("production-host", 0, binding, {
      prompt: "帮我做一个 5 分钟品牌视频",
      capability: "canvas-agent",
    });
    await coordinator.enqueue(opened.subscriptionId, input);
    const state = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(productionRun.tryExecute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "start_production_run" }),
      expect.any(AbortSignal),
    );
    expect(state.items.some((item) => item.kind === "tool" && item.toolCallId === "production-start-1")).toBe(true);
    expect(state.items).toContainEqual(expect.objectContaining({
      kind: "task",
      task: expect.objectContaining({ kind: "production-run", runId: "run-host-1", stageId: "direction" }),
    }));
    expect(productionRun.execute).not.toHaveBeenCalled();
  });

  it("reattaches a pending decision after release without aborting or executing twice", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-reattach-"));
    const subscriptionIds = ["subscription-reattach-a", "subscription-reattach-b"];
    let runCount = 0;
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => subscriptionIds.shift()!,
      {
        runAgent: async (_request, hooks) => {
          runCount += 1;
          const call = { toolCallId: "tool-reattach", toolName: "write_document", args: { text: "x" } };
          hooks.emit({ type: "tool-call", ...call });
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return {
            id: "result-reattach",
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [{ ...call, status: "ok", result: { applied: true }, decision }],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const first = await coordinator.open(binding);
    let firstPending!: Extract<ProjectAgentExecutionEvent, { type: "tool-call" }>;
    const pendingSeen = new Promise<void>((resolve) => {
      coordinator.subscribe(first.subscriptionId, (event) => {
        if (event.type === "tool-call") {
          firstPending = event;
          resolve();
        }
      });
    });
    const input = executionInput("reattach", 0);
    await coordinator.enqueue(first.subscriptionId, input);
    await pendingSeen;
    coordinator.release(first.subscriptionId);
    expect(() => coordinator.snapshot(first.subscriptionId)).toThrow(ProjectAgentSubscriptionError);

    const second = await coordinator.open(binding);
    expect(second.subscriptionEpoch).toBeGreaterThan(first.subscriptionEpoch);
    let replayed!: Extract<ProjectAgentExecutionEvent, { type: "tool-call" }>;
    coordinator.subscribe(second.subscriptionId, (event) => {
      if (event.type === "tool-call") replayed = event;
    });
    expect(replayed).toMatchObject({
      subscriptionId: second.subscriptionId,
      subscriptionEpoch: second.subscriptionEpoch,
      turnId: firstPending.turnId,
      executionToken: firstPending.executionToken,
      toolCallId: firstPending.toolCallId,
    });
    await expect(
      coordinator.resolveToolDecision(first.subscriptionId, firstPending.turnId, firstPending.toolCallId, {
        ok: true,
      }),
    ).rejects.toThrow(ProjectAgentSubscriptionError);
    await coordinator.resolveToolDecision(second.subscriptionId, replayed.turnId, replayed.toolCallId, {
      ok: true,
      result: { applied: true },
    });
    const final = await coordinator.waitForTurn(second.subscriptionId, replayed.turnId);
    expect(final.turns.find((turn) => turn.turnId === replayed.turnId)?.status).toBe("done");
    expect(runCount).toBe(1);
  });

  it("atomically terminalizes process-restart orphans exactly once without running the model", async () => {
    for (const orphanStatus of ["queued", "running", "proposed"] as const) {
      const projectBinding = { ...binding, projectId: `project-recovery-${orphanStatus}`, projectGeneration: 2 };
      const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-recovery-"));
      const seedRouter = createProjectAgentRepositoryRouter({ rootDir: recoveryRoot });
      const host = seedRouter.attach(projectBinding);
      const input = executionInput(`recovery-${orphanStatus}`, 0, projectBinding);
      let state = (await host.dispatch(input.mutation)).state;
      if (orphanStatus !== "queued") {
        state = (
          await host.dispatch({
            commandId: `start-recovery-${orphanStatus}`,
            expectedRevision: state.hostRevision,
            binding: projectBinding,
            sender: { kind: "internal", senderId: "test" },
            type: "turn.start",
            payload: {
              turnId: input.mutation.payload.turn.turnId,
              queueItemId: input.mutation.payload.queueItem.queueItemId,
              assistantItem: {
                itemId: `assistant-recovery-${orphanStatus}`,
                threadId: input.mutation.payload.thread.threadId,
                turnId: input.mutation.payload.turn.turnId,
                kind: "assistant",
                text: "",
                textRevision: 0,
                status: "running",
                retryable: false,
                deviated: false,
                createdAt: "2026-08-28T00:00:00.000Z",
                updatedAt: "2026-08-28T00:00:00.000Z",
              },
              occurredAt: "2026-08-28T00:00:00.000Z",
            },
          })
        ).state;
      }
      if (orphanStatus === "proposed") {
        const ref = {
          approvalId: "approval-recovery-proposed",
          receiptProposalId: "receipt-recovery-proposed",
          threadId: input.mutation.payload.thread.threadId,
          turnId: input.mutation.payload.turn.turnId,
          toolCallId: "tool-recovery-proposed",
          policyRevision: input.mutation.payload.queueItem.policyRevision,
          inputHash: "input-recovery-proposed",
          actionHash: "action-recovery-proposed",
          target: input.mutation.payload.queueItem.target,
          preconditions: input.mutation.payload.queueItem.preconditions,
          expiresAt: "2026-08-29T00:00:00.000Z",
        } as const;
        await host.dispatch({
          commandId: "propose-recovery-proposed",
          expectedRevision: state.hostRevision,
          binding: projectBinding,
          sender: { kind: "internal", senderId: "test" },
          type: "proposal.put",
          payload: {
            approval: { ref, lifecycle: "pending" },
            item: {
              itemId: "proposal-recovery-proposed",
              threadId: ref.threadId,
              turnId: ref.turnId,
              kind: "proposal",
              approval: ref,
              status: "proposed",
              retryable: false,
              deviated: false,
              createdAt: "2026-08-28T00:00:00.000Z",
              updatedAt: "2026-08-28T00:00:00.000Z",
            },
            occurredAt: "2026-08-28T00:00:00.000Z",
          },
        });
      }
      let runCount = 0;
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: recoveryRoot }),
        () => `subscription-recovery-${orphanStatus}`,
        {
          runAgent: async () => {
            runCount += 1;
            throw new Error("must not run");
          },
          now: () => "2026-08-28T00:00:01.000Z",
        },
      );
      const opened = await coordinator.open(projectBinding);
      const recovered = coordinator.snapshot(opened.subscriptionId);
      expect(recovered.turns[0]).toMatchObject({ status: "failed", retryable: true });
      expect(recovered.queue[0]).toMatchObject({ status: "failed", retryable: true });
      expect(recovered.items.filter((item) => item.kind === "failure")).toHaveLength(1);
      expect(recovered.items.find((item) => item.kind === "failure")).toMatchObject({
        code: "execution_recovery_required",
        status: "failed",
        retryable: true,
      });
      const revisionAfterRecovery = recovered.hostRevision;
      coordinator.release(opened.subscriptionId);
      const nextCoordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: recoveryRoot }),
        () => `subscription-reopen-${orphanStatus}`,
        {
          runAgent: async () => {
            runCount += 1;
            throw new Error("must not run");
          },
          now: () => "2026-08-28T00:00:02.000Z",
        },
      );
      const reopened = await nextCoordinator.open(projectBinding);
      const reopenedState = nextCoordinator.snapshot(reopened.subscriptionId);
      expect(reopenedState.hostRevision).toBe(revisionAfterRecovery);
      expect(reopenedState.items.filter((item) => item.kind === "failure")).toHaveLength(1);
      expect(runCount).toBe(0);
      fs.rmSync(recoveryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { receiptState: "exact", expectedStatus: "done" },
    { receiptState: "missing", expectedStatus: "failed" },
    { receiptState: "binding-mismatch", expectedStatus: "failed" },
    { receiptState: "proposal-mismatch", expectedStatus: "failed" },
    { receiptState: "approval-mismatch", expectedStatus: "failed" },
    { receiptState: "action-mismatch", expectedStatus: "failed" },
  ] as const)(
    "terminalizes a claimed Canvas execution from a $receiptState durable receipt without redispatch",
    async ({ receiptState, expectedStatus }) => {
      const projectBinding = {
        ...binding,
        projectId: `project-canvas-recovery-${receiptState}`,
        projectGeneration: 3,
      };
      root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-canvas-recovery-${receiptState}-`));
      const { approval } = await seedClaimedCanvasExecution(root, projectBinding, `canvas-recovery-${receiptState}`);
      const exactReceipt = committedCanvasReceipt(projectBinding, {
        approvalId: approval.approvalId,
        receiptProposalId: approval.receiptProposalId,
        actionHash: approval.actionHash,
      });
      const receipt =
        receiptState === "missing"
          ? null
          : receiptState === "binding-mismatch"
            ? { ...exactReceipt, binding: { ...projectBinding, projectId: "project-forged" } }
            : receiptState === "proposal-mismatch"
              ? { ...exactReceipt, proposalId: "receipt-forged" }
              : receiptState === "approval-mismatch"
                ? { ...exactReceipt, proposal: { ...exactReceipt.proposal, hostApprovalId: "approval-forged" } }
                : receiptState === "action-mismatch"
                  ? { ...exactReceipt, proposal: { ...exactReceipt.proposal, hostActionHash: "f".repeat(64) } }
                  : exactReceipt;
      const readProposalReceipt = vi.fn(() => receipt);
      const canvasAdapter = canvasWriteAdapter();
      let runCount = 0;
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-canvas-recovery-${receiptState}`,
        {
          runAgent: async () => {
            runCount += 1;
            throw new Error("must not run");
          },
          now: () => "2026-08-28T00:00:01.000Z",
        },
      );

      const opened = await coordinator.open(projectBinding, {
        canvasWrite: canvasAdapter,
        proposalReceipt: readProposalReceipt,
      });
      const recovered = coordinator.snapshot(opened.subscriptionId);

      expect(readProposalReceipt).toHaveBeenCalledOnce();
      expect(canvasAdapter.execute).not.toHaveBeenCalled();
      expect(runCount).toBe(0);
      expect(recovered.turns.find((turn) => turn.turnId === approval.turnId)).toMatchObject({
        status: expectedStatus,
        retryable: false,
      });
      expect(recovered.queue.find((item) => item.turnId === approval.turnId)).toMatchObject({
        status: expectedStatus,
        retryable: false,
      });
      expect(recovered.items.find((item) => item.kind === "proposal" && item.turnId === approval.turnId)).toMatchObject(
        {
          status: expectedStatus,
        },
      );
      if (receiptState === "exact") {
        expect(recovered.items.some((item) => item.kind === "failure" && item.turnId === approval.turnId)).toBe(false);
      } else {
        expect(
          recovered.items.find((item) => item.kind === "failure" && item.turnId === approval.turnId),
        ).toMatchObject({
          code: "capability_receipt_unresolved",
          status: "failed",
          retryable: false,
        });
      }

      const revisionAfterRecovery = recovered.hostRevision;
      coordinator.release(opened.subscriptionId);
      const secondReader = vi.fn(() => receipt);
      const secondAdapter = canvasWriteAdapter();
      const reopenedCoordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-canvas-reopened-${receiptState}`,
        {
          runAgent: async () => {
            runCount += 1;
            throw new Error("must not run");
          },
        },
      );
      const reopened = await reopenedCoordinator.open(projectBinding, {
        canvasWrite: secondAdapter,
        proposalReceipt: secondReader,
      });
      expect(reopenedCoordinator.snapshot(reopened.subscriptionId).hostRevision).toBe(revisionAfterRecovery);
      expect(secondReader).not.toHaveBeenCalled();
      expect(secondAdapter.execute).not.toHaveBeenCalled();
      expect(runCount).toBe(0);
    },
  );

  it.each([
    {
      receiptOwner: "latest",
      expectedStatus: "done",
      expectedProposalStatuses: ["done", "done"],
    },
    {
      receiptOwner: "earlier",
      expectedStatus: "failed",
      expectedProposalStatuses: ["done", "failed"],
    },
  ] as const)(
    "recovers two claimed Canvas approvals only when the receipt uniquely matches the $receiptOwner approval",
    async ({ receiptOwner, expectedStatus, expectedProposalStatuses }) => {
      const projectBinding = {
        ...binding,
        projectId: `project-canvas-multi-recovery-${receiptOwner}`,
        projectGeneration: 4,
      };
      root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-canvas-multi-${receiptOwner}-`));
      const { approval: first } = await seedClaimedCanvasExecution(
        root,
        projectBinding,
        `canvas-multi-recovery-${receiptOwner}`,
      );
      const second = await seedSecondClaimedCanvasApproval(root, projectBinding, first);
      const receiptApproval = receiptOwner === "latest" ? second : first;
      const receipt = committedCanvasReceipt(projectBinding, {
        approvalId: receiptApproval.approvalId,
        receiptProposalId: receiptApproval.receiptProposalId,
        actionHash: receiptApproval.actionHash,
      });
      const readProposalReceipt = vi.fn(() => receipt);
      const canvasAdapter = canvasWriteAdapter();
      let runCount = 0;
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-canvas-multi-${receiptOwner}`,
        {
          runAgent: async () => {
            runCount += 1;
            throw new Error("must not run");
          },
        },
      );

      const opened = await coordinator.open(projectBinding, {
        canvasWrite: canvasAdapter,
        proposalReceipt: readProposalReceipt,
      });
      const recovered = coordinator.snapshot(opened.subscriptionId);

      expect(readProposalReceipt).toHaveBeenCalledOnce();
      expect(canvasAdapter.execute).not.toHaveBeenCalled();
      expect(runCount).toBe(0);
      expect(recovered.turns.find((turn) => turn.turnId === first.turnId)).toMatchObject({
        status: expectedStatus,
        retryable: false,
      });
      const proposals = recovered.items.filter((item) => item.kind === "proposal" && item.turnId === first.turnId);
      expect(proposals).toHaveLength(2);
      expect(proposals.map((proposal) => proposal.status)).toEqual(expectedProposalStatuses);
      if (receiptOwner === "latest") {
        expect(recovered.items.some((item) => item.kind === "failure" && item.turnId === first.turnId)).toBe(false);
      } else {
        expect(recovered.items.find((item) => item.kind === "failure" && item.turnId === first.turnId)).toMatchObject({
          code: "capability_receipt_unresolved",
          retryable: false,
        });
      }
    },
  );

  it("keeps commands scoped to the opened subscription binding", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-coordinator-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-a",
    );
    const opened = await coordinator.open(binding);
    expect(opened.subscriptionId).toBe("subscription-a");
    expect(coordinator.snapshot(opened.subscriptionId).binding).toEqual(binding);

    const mutation: ProjectAgentMutation = {
      commandId: "thread-command",
      expectedRevision: 0,
      binding,
      sender: { kind: "internal", senderId: "test" },
      type: "thread.put",
      payload: {
        thread: { threadId: "thread-a", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
      },
    };
    const reduction = await coordinator.dispatch(opened.subscriptionId, mutation);
    expect(reduction.state.hostRevision).toBe(1);

    expect(() =>
      coordinator.dispatch(opened.subscriptionId, {
        ...mutation,
        commandId: "foreign",
        binding: { ...binding, projectGeneration: 2 },
      }),
    ).toThrow(ProjectAgentSubscriptionError);
    coordinator.release(opened.subscriptionId);
    expect(coordinator.subscriptionCount()).toBe(0);
    expect(() => coordinator.snapshot(opened.subscriptionId)).toThrow(ProjectAgentSubscriptionError);
  });

  it("owns the queued turn execution, streams one assistant item, and waits for tool decisions", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-execution-"));
    let subscriptionId = "";
    const published: ProjectAgentExecutionEvent[] = [];
    let resolveToolCall!: (value: {
      turnId: string;
      toolCallId: string;
      assistantTextAnchor?: { itemId: string; textOffset: number };
    }) => void;
    const toolCallSeen = new Promise<{
      turnId: string;
      toolCallId: string;
      assistantTextAnchor?: { itemId: string; textOffset: number };
    }>((resolve) => {
      resolveToolCall = resolve;
    });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-execution",
      {
        runAgent: async (_request, hooks) => {
          hooks.emit({ type: "content-delta", delta: "hello" });
          hooks.emit({
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "insert_at_cursor",
            args: { content: "x" },
          });
          const decision = await hooks.awaitToolConfirmation(
            { toolCallId: "tool-1", toolName: "insert_at_cursor", args: { content: "x" } },
            hooks.abortSignal!,
          );
          expect(decision).toMatchObject({ ok: true, result: { applied: true } });
          return {
            id: "result",
            status: "finished",
            text: "hello",
            finishReason: "stop",
            artifacts: [],
            usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 2 },
            toolCalls: [
              {
                toolCallId: "tool-1",
                toolName: "insert_at_cursor",
                args: { content: "x" },
                status: "ok",
                result: { applied: true },
                decision,
              },
            ],
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    subscriptionId = opened.subscriptionId;
    coordinator.subscribe(opened.subscriptionId, (event) => {
      published.push(event);
      if (event.type === "tool-call") {
        resolveToolCall({
          turnId: event.turnId,
          toolCallId: event.toolCallId,
          ...(event.assistantTextAnchor ? { assistantTextAnchor: event.assistantTextAnchor } : {}),
        });
      }
    });
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, "thread-execution"),
      contextRevision: 0,
      recordId: "canonical-context-thread-execution",
    } as const;
    const now = "2026-08-28T00:00:00.000Z";
    const thread = {
      threadId: "thread-execution",
      createdAt: now,
      updatedAt: now,
    };
    const turn = {
      turnId: "turn-execution",
      threadId: thread.threadId,
      executionToken: "execution-token",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "creation-chat", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const userItem = {
      itemId: "user-execution",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "hi",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const queueItem = {
      queueItemId: "queue-execution",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "document" as const, documentId: "doc", anchor: { kind: "whole-document" as const } },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "document" as const },
      enqueuedAt: now,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: now,
    };
    const mutation: Extract<ProjectAgentMutation, { type: "turn.enqueue" }> = {
      commandId: "enqueue-execution",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: "subscription-execution" },
      type: "turn.enqueue",
      payload: { thread, turn, userItem, queueItem },
    };
    const request: AgentChatRequest = {
      prompt: "hi",
      capability: "creation-chat",
      history: { kind: "ephemeral" },
      projectId: binding.projectId,
    };
    void coordinator.enqueue(opened.subscriptionId, { mutation, request }).catch((error) => {
      console.error("execution enqueue failed", error);
    });
    const seen = await toolCallSeen;
    const assistantAtToolCall = coordinator
      .snapshot(subscriptionId)
      .items.find((item) => item.kind === "assistant" && item.turnId === seen.turnId);
    expect(assistantAtToolCall).toMatchObject({ text: "hello", textRevision: 1 });
    expect(seen.assistantTextAnchor).toEqual({ itemId: assistantAtToolCall?.itemId, textOffset: 5 });
    let unsubscribeReplay = () => {};
    let replayedAnchor: { itemId: string; textOffset: number } | undefined;
    const replayed = new Promise<void>((resolve) => {
      unsubscribeReplay = coordinator.subscribe(subscriptionId, (event) => {
        if (event.type === "tool-call" && event.toolCallId === seen.toolCallId) {
          replayedAnchor = event.assistantTextAnchor;
          resolve();
        }
      });
    });
    await replayed;
    unsubscribeReplay();
    expect(replayedAnchor).toEqual(seen.assistantTextAnchor);
    await coordinator.resolveToolDecision(subscriptionId, seen.turnId, seen.toolCallId, {
      ok: true,
      result: { applied: true },
    });
    const final = await coordinator.waitForTurn(subscriptionId, seen.turnId);
    expect(final.items.filter((item) => item.turnId === seen.turnId).map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "proposal",
      "tool",
    ]);
    expect(final.items.find((item) => item.kind === "assistant" && item.turnId === seen.turnId)).toMatchObject({
      text: "hello",
      status: "done",
    });
    expect(final.queue.find((item) => item.turnId === seen.turnId)?.status).toBe("done");
    const resultIndex = published.findIndex((event) => event.type === "execution-result");
    expect(resultIndex).toBeGreaterThan(-1);
    expect(
      published
        .slice(0, resultIndex)
        .some(
          (event) =>
            event.type === "patch" &&
            event.patch.changes.some((change) => change.kind === "turn-upserted" && change.turn.status === "done"),
        ),
    ).toBe(true);
    expect(published[resultIndex]).toMatchObject({
      type: "execution-result",
      turnId: seen.turnId,
      response: {
        status: "finished",
        finishReason: "stop",
        usage: { totalTokens: 2 },
        toolCalls: [{ toolCallId: seen.toolCallId, status: "ok" }],
      },
    });
  });

  it("appends one reference-only ExportJob task after the exact proposal receipt settles", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-export-taskref-"));
    let receipt: ProjectAgentProposalReceiptView | null = null;
    const phase4Surface: PiPhase4SurfaceTransportAdapter = {
      tryExecuteRead: vi.fn(async () => null),
      prepareWrite: vi.fn(async (call: RuntimeToolCall): Promise<PreparedExportWrite | null> => {
        if (call.toolName !== "export_timeline") return null;
        return Object.freeze({
          call,
          invocation: {
            input: { operation: "export_timeline", expectedRevision: "revision-a" },
            target: { kind: "export", timelineRevision: "revision-a" },
            preconditions: { timeline: { revision: "revision-a" } },
            policyRevision: 1,
            inputHash: "b".repeat(64),
            actionHash: "a".repeat(64),
          } as unknown as PreparedExportWrite["invocation"],
        });
      }),
      executeWrite: vi.fn(async (_prepared, approval) => {
        receipt = committedCanvasReceipt(binding, approval);
        return {
          ok: true,
          silent: true,
          result: {
            operation: "export_timeline",
            accepted: true,
            jobId: "job-export-taskref",
            backend: "filtergraph",
            timelineRevision: "revision-a",
            durationFrames: 60,
            profile: { aspectRatio: "16:9", resolution: "1080p", quality: "standard" },
          },
        };
      }),
      dispose: vi.fn(),
    };
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-export-taskref",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-export-taskref",
            toolName: "export_timeline",
            args: { expectedRevision: "revision-a" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return {
            id: "result-export-taskref",
            status: "finished",
            text: "export started",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [{
              ...call,
              status: decision.ok ? "ok" : "denied",
              ...(decision.ok && decision.result !== undefined ? { result: decision.result } : {}),
              decision,
            }],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding, {
      phase4Surface,
      proposalReceipt: () => receipt,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { approved: true },
      });
    });
    const base = executionInput("export-taskref", 0);
    const input: ExecutionInput = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "export", timelineRevision: "revision-a" },
            preconditions: { timeline: { revision: "revision-a" } },
            originSurface: { surfaceId: "preview-export", kind: "preview" },
          },
        },
      },
    };

    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    const taskItems = final.items.filter((item) => item.kind === "task");

    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]).toMatchObject({
      correlationId: "tool-export-taskref",
      task: { kind: "export-job", jobId: "job-export-taskref" },
      status: "done",
    });
    expect(Object.keys(taskItems[0]!.task).sort()).toEqual(["jobId", "kind"]);
    expect(final.proposalApprovals).toMatchObject([{ lifecycle: "claimed" }]);
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    coordinator.release(opened.subscriptionId);
  });

  it("auto-executes document read aliases through the Host without a pending confirmation", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-read-execution-"));
    const documentAdapter = {
      tryExecute: vi.fn(async (call: { toolName: string }, documentId: string) =>
        call.toolName === "read_full_text"
          ? { ok: true as const, result: { text: `text:${documentId}` }, silent: true as const }
          : null,
      ),
      dispose: vi.fn(),
    };
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-document-read",
      {
        runAgent: async (_request, hooks) => {
          const call = { toolCallId: "tool-document-read", toolName: "read_full_text", args: {} };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toEqual({ ok: true, result: { text: "text:document-document-read" }, silent: true });
          return {
            id: "result-document-read",
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [{ ...call, status: "ok", result: decision.ok ? decision.result : undefined, decision }],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding, { documentRead: documentAdapter });
    const input = executionInput("document-read", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(documentAdapter.tryExecute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "read_full_text" }),
      "document-document-read",
      expect.any(AbortSignal),
    );
    expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(0);
    expect(final.items.find((item) => item.kind === "tool")).toMatchObject({
      capability: { id: "document.read", version: 1 },
      status: "done",
    });
    coordinator.release(opened.subscriptionId);
    expect(documentAdapter.dispose).toHaveBeenCalledOnce();
  });

  it("does not execute a document.write or leave a proposal when the user denies it", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-write-denied-"));
    const documentAdapter = documentWriteAdapter();
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-document-write-denied",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-document-write-denied",
            toolName: "insert_at_cursor",
            args: { content: "x" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: false, denied: true });
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: false,
          denied: true,
          message: "User denied document write",
        });
      }
    });

    const input = executionInput("document-write-denied", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(documentAdapter.prepare).toHaveBeenCalledOnce();
    expect(documentAdapter.execute).not.toHaveBeenCalled();
    expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(0);
    expect(final.items.find((item) => item.kind === "tool")).toMatchObject({ status: "failed" });
  });

  it("executes an approved document.write through the Host and settles its frozen proposal", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-write-approved-"));
    fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
    const target = {
      kind: "document" as const,
      documentId: "document-document-write-approved",
      anchor: { kind: "cursor" as const, position: 7, beforeHash: "before-a", afterHash: "after-a" },
    };
    const preconditions = { document: { revision: 3, contentHash: "fnv1a-before" } } as const;
    const documentAdapter = documentWriteAdapter();
    const proposalReceipts = createProjectAgentProposalReceiptService({ projectRoot: root, binding });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-document-write-approved",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-document-write-approved",
            toolName: "replace_selection",
            args: { content: "new" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true, result: { applied: true } });
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      documentWrite: documentAdapter,
      proposalReceipt: () => proposalReceipts.read(),
      proposalReceiptWriter: proposalReceipts,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
      }
    });

    const base = executionInput("document-write-approved", 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: { ...base.mutation.payload.queueItem, target, preconditions, policyRevision: 5 },
        },
      },
    };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(documentAdapter.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "replace_selection" }),
      { documentId: target.documentId, target, preconditions },
      expect.any(AbortSignal),
    );
    expect(documentAdapter.execute).toHaveBeenCalledOnce();
    const invocation = documentAdapter.execute.mock.calls[0]?.[0].invocation;
    expect(invocation).toMatchObject({ target, preconditions });
    const proposal = final.items.find((item) => item.kind === "proposal");
    expect(proposal).toMatchObject({
      status: "done",
      approval: {
        approvalId: expect.stringMatching(/^approval-/),
        receiptProposalId: expect.any(String),
        policyRevision: 1,
        inputHash: invocation.inputHash,
        actionHash: invocation.actionHash,
        target,
        preconditions,
      },
    });
    expect(final.proposalApprovals).toHaveLength(1);
    expect(final.proposalApprovals[0]).toMatchObject({
      lifecycle: "claimed",
      ref: {
        approvalId: expect.stringMatching(/^approval-/),
        receiptProposalId: expect.any(String),
        policyRevision: 1,
        inputHash: invocation.inputHash,
        actionHash: invocation.actionHash,
        target,
        preconditions,
      },
    });
    const receiptPath = projectAgentProposalReceiptPath(root);
    expect(fs.existsSync(receiptPath)).toBe(true);
    expect(proposalReceipts.read()).toMatchObject({
      revision: 2,
      lifecycle: "committed",
      proposalId: expect.any(String),
      proposal: {
        hostApprovalId: expect.stringMatching(/^approval-/),
        hostActionHash: invocation.actionHash,
      },
    });
  });

  it.each(["capability_timeout", "capability_execution_failed"] as const)(
    "closes a prepared document receipt as undone on a %s write failure",
    async (code) => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-document-write-${code}-`));
      fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
      const documentAdapter = documentWriteAdapter({
        result: { ok: false, code, message: code },
      });
      const proposalReceipts = createProjectAgentProposalReceiptService({ projectRoot: root, binding });
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-document-write-${code}`,
        {
          runAgent: async (_request, hooks) => {
            const call = {
              toolCallId: `tool-document-write-${code}`,
              toolName: "append_to_end",
              args: { content: "network-safe failure" },
            };
            const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
            expect(decision).toMatchObject({ ok: true, result: { applied: true } });
            return documentWriteResponse(call, decision);
          },
        },
      );
      const opened = await coordinator.open(binding, {
        documentWrite: documentAdapter,
        proposalReceipt: () => proposalReceipts.read(),
        proposalReceiptWriter: proposalReceipts,
      });
      coordinator.subscribe(opened.subscriptionId, (event) => {
        if (event.type === "tool-call") {
          void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
            ok: true,
            result: { applied: true },
          });
        }
      });

      const input = executionInput(`document-write-${code}`, 0);
      await coordinator.enqueue(opened.subscriptionId, input);
      const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

      expect(documentAdapter.prepare).toHaveBeenCalledOnce();
      expect(documentAdapter.execute).toHaveBeenCalledOnce();
      expect(proposalReceipts.read()).toMatchObject({ revision: 2, lifecycle: "undone" });
      expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "failed" });
      expect(final.items.find((item) => item.kind === "failure")).toMatchObject({ status: "failed" });
    },
  );

  it("keeps the legacy document adapter fail-closed when no optional receipt writer is available", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-write-no-receipt-writer-"));
    const documentAdapter = documentWriteAdapter({
      result: { ok: false, code: "capability_timeout", message: "capability_timeout" },
    });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-document-write-no-receipt-writer",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-document-write-no-receipt-writer",
            toolName: "append_to_end",
            args: { content: "receipt writer unavailable" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
      }
    });

    const input = executionInput("document-write-no-receipt-writer", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(documentAdapter.execute).toHaveBeenCalledOnce();
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "failed" });
    coordinator.release(opened.subscriptionId);
  });

  it.each([
    { label: "explicit args operation", args: { operation: "append", content: "fallback append" }, operation: "append" },
    { label: "write fallback", args: { content: "fallback write" }, operation: "write" },
  ])("records the %s operation in the receipt proposal", async ({ label, args, operation }) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-document-write-${label.replaceAll(" ", "-")}-`));
    fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
    const documentAdapter = documentWriteAdapter();
    const proposalReceipts = createProjectAgentProposalReceiptService({ projectRoot: root, binding });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => `subscription-document-write-${operation}`,
      {
        runAgent: async (_request, hooks) => {
          const call = { toolCallId: `tool-document-write-${operation}`, toolName: "nomi_document_edit", args };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      documentWrite: documentAdapter,
      proposalReceipt: () => proposalReceipts.read(),
      proposalReceiptWriter: proposalReceipts,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
      }
    });

    const input = executionInput(`document-write-${operation}`, 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    expect(proposalReceipts.read()).toMatchObject({
      revision: 2,
      lifecycle: "committed",
      proposal: { stepLabels: [`${operation}:nomi_document_edit`] },
    });
    coordinator.release(opened.subscriptionId);
  });

  it("fails closed when the document receipt commit cannot be persisted", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-write-receipt-commit-failure-"));
    const preparedReceipt = (input: { proposalId: string; operationId: string; proposal: ProjectAgentCommittedProposalRecord }) => ({
      schemaVersion: 2,
      binding,
      revision: 1,
      lifecycle: "preparing" as const,
      proposalId: input.proposalId,
      operationId: input.operationId,
      proposal: input.proposal,
      proposalHash: "a".repeat(64),
      operations: [],
      updatedAt: "2026-08-28T00:00:00.000Z",
      journalHash: "b".repeat(64),
    });
    let writes = 0;
    const proposalReceiptWriter = {
      binding,
      read: vi.fn(() => null),
      write: vi.fn((input: Parameters<ProjectAgentProposalReceiptWriter["write"]>[0]) => {
        writes += 1;
        if (writes > 1) throw new Error("receipt_commit_write_failed");
        return preparedReceipt(input);
      }),
      transition: vi.fn(),
    } as unknown as ProjectAgentProposalReceiptWriter;
    const documentAdapter = documentWriteAdapter();
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-document-write-receipt-commit-failure",
      {
        runAgent: async (_request, hooks) => {
          const call = { toolCallId: "tool-document-write-receipt-commit-failure", toolName: "append_to_end", args: { content: "receipt must settle" } };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      documentWrite: documentAdapter,
      proposalReceipt: () => null,
      proposalReceiptWriter,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
      }
    });

    const input = executionInput("document-write-receipt-commit-failure", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(proposalReceiptWriter.write).toHaveBeenCalledTimes(2);
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "failed" });
    coordinator.release(opened.subscriptionId);
  });

  it("executes author_skill through the Host and settles its Skill-library proposal", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-skill-write-approved-"));
    const adapter = skillWriteAdapter();
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-skill-write-approved",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-skill-write-approved",
            toolName: "author_skill",
            args: {
              dirName: "test-skill",
              manifest: { name: "test.skill" },
              skillMarkdown: "body",
            },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true, result: { applied: true } });
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { skillWrite: adapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { approved: true },
        });
      }
    });
    const input = executionInput("skill-write-approved", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(adapter.prepare).toHaveBeenCalledOnce();
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(final.items.find((item) => item.kind === "tool")).toMatchObject({
      capability: { id: "skill.write", version: 1 },
      status: "done",
    });
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    expect(final.proposalApprovals[0]).toMatchObject({ lifecycle: "claimed" });
    coordinator.release(opened.subscriptionId);
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("loads load_skill through the Host read port without creating a proposal or approval", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-skill-read-"));
    const adapter = skillReadAdapter();
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-skill-read",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-skill-read",
            toolName: "load_skill",
            args: { name: "brand.promo", expectedContentHash: "a".repeat(64) },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true, silent: true, result: { loaded: true, name: "brand.promo" } });
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { skillRead: adapter });
    const input = executionInput("skill-read", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(adapter.tryExecute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "load_skill" }),
      expect.any(AbortSignal),
    );
    expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(0);
    expect(final.items.find((item) => item.kind === "tool")).toMatchObject({
      capability: { id: "skill.read", version: 1 },
      status: "done",
      skillLoad: { name: "brand.promo", packageVersion: "nomi-skill-v1", contentHash: "a".repeat(64) },
    });
    coordinator.release(opened.subscriptionId);
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("carries a successful Skill load ledger reference into the next Thread turn", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-skill-ledger-"));
    const adapter = skillReadAdapter();
    const seen: AgentChatRequest[] = [];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-skill-ledger",
      {
        runAgent: async (request, hooks) => {
          seen.push(request);
          if (seen.length === 1) {
            const call = { toolCallId: "tool-skill-ledger", toolName: "load_skill", args: { name: "brand.promo" } };
            const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
            return documentWriteResponse(call, decision);
          }
          return { id: "second", status: "finished", text: "continued", finishReason: "stop", artifacts: [], toolCalls: [], usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 } };
        },
      },
    );
    const opened = await coordinator.open(binding, { skillRead: adapter });
    const first = executionInput("skill-ledger-first", 0, binding, { threadId: "thread-skill-ledger" });
    await coordinator.enqueue(opened.subscriptionId, first);
    const firstState = await coordinator.waitForTurn(opened.subscriptionId, first.mutation.payload.turn.turnId);
    const second = executionInput("skill-ledger-second", firstState.hostRevision, binding, { threadId: "thread-skill-ledger" });
    await coordinator.enqueue(opened.subscriptionId, second);
    await coordinator.waitForTurn(opened.subscriptionId, second.mutation.payload.turn.turnId);

    expect(seen[1]?.hostPromptLedger).toEqual([expect.objectContaining({
      capability: { id: "skill.read", version: 1 },
      skillLoad: { name: "brand.promo", packageVersion: "nomi-skill-v1", contentHash: "a".repeat(64) },
    })]);
    coordinator.release(opened.subscriptionId);
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("does not execute author_skill when the user denies the proposal", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-skill-write-denied-"));
    const adapter = skillWriteAdapter();
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-skill-write-denied",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-skill-write-denied",
            toolName: "author_skill",
            args: { dirName: "test-skill", manifest: { name: "test.skill" }, skillMarkdown: "body" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { skillWrite: adapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: false,
          denied: true,
          message: "User denied Skill write",
        });
      }
    });
    const input = executionInput("skill-write-denied", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(0);
    expect(final.items.find((item) => item.kind === "tool")).toMatchObject({ status: "failed" });
    coordinator.release(opened.subscriptionId);
  });

  it("fails closed when author_skill is visible but its main-process owner is unavailable", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-skill-write-unavailable-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-skill-write-unavailable",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-skill-write-unavailable",
            toolName: "author_skill",
            args: { dirName: "test-skill", manifest: { name: "test.skill" }, skillMarkdown: "body" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding);
    const input = executionInput("skill-write-unavailable", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(final.items.find((item) => item.kind === "failure")).toMatchObject({
      code: "capability_surface_unavailable",
      status: "failed",
    });
    coordinator.release(opened.subscriptionId);
  });

  it("persists and reads back Canvas approval identity before Surface execute", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-write-approved-"));
    const canvasAdapter = canvasWriteAdapter();
    let receipt: ProjectAgentProposalReceiptView | null = null;
    canvasAdapter.execute.mockImplementation(
      async (_prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
        receipt = committedCanvasReceipt(binding, approval);
        return { ok: true, result: { applied: true, proposalId: approval.receiptProposalId }, silent: true };
      },
    );
    const readProposalReceipt = vi.fn(() => receipt);
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-write-approved",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-canvas-write-approved",
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "new prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true });
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      canvasWrite: canvasAdapter,
      proposalReceipt: readProposalReceipt,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { approved: true },
        });
      }
    });

    const base = executionInput("canvas-write-approved", 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "canvas" as const, nodeIds: ["node-real"] },
            preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
            originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const },
          },
        },
      },
    };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(canvasAdapter.prepare).toHaveBeenCalledOnce();
    expect(canvasAdapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ invocation: expect.objectContaining({ actionHash: "action-hash" }) }),
      {
        receiptProposalId: expect.stringMatching(/^receipt-/),
        approvalId: expect.stringMatching(/^approval-/),
        actionHash: "action-hash",
      },
      expect.any(AbortSignal),
    );
    expect(canvasAdapter.execute).toHaveBeenCalledOnce();
    expect(readProposalReceipt).toHaveBeenCalledOnce();
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "done",
      retryable: false,
    });
    expect(final.proposalApprovals).toMatchObject([
      { lifecycle: "claimed", ref: { actionHash: "action-hash", target: { kind: "canvas", nodeIds: ["node-real"] } } },
    ]);
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    coordinator.release(opened.subscriptionId);
  });

  it("re-prepares a Canvas proposal from the approved effective parameters", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-effective-args-"));
    const canvasAdapter = canvasWriteAdapter();
    let receipt: ProjectAgentProposalReceiptView | null = null;
    canvasAdapter.execute.mockImplementation(
      async (prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
        receipt = committedCanvasReceipt(binding, approval);
        expect(prepared.call.args).toEqual({ nodeId: "node-real", prompt: "edited prompt" });
        return { ok: true, result: { applied: true, proposalId: approval.receiptProposalId }, silent: true };
      },
    );
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-effective-args",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-canvas-effective-args",
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "original prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true, effectiveArgs: { prompt: "edited prompt" } });
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      canvasWrite: canvasAdapter,
      proposalReceipt: vi.fn(() => receipt),
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          effectiveArgs: { nodeId: "node-real", prompt: "edited prompt" },
          overridesDelta: { prompt: "edited prompt" },
        });
      }
    });
    const base = executionInput("canvas-effective-args", 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "canvas" as const, nodeIds: ["node-real"] },
            preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
            originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const },
          },
        },
      },
    };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(canvasAdapter.prepare).toHaveBeenCalledTimes(2);
    expect(canvasAdapter.prepare.mock.calls[1]?.[0]).toMatchObject({ args: { prompt: "edited prompt" } });
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    coordinator.release(opened.subscriptionId);
  });

  it("returns a correctable failure when edited Canvas parameters fail revalidation", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-invalid-effective-args-"));
    const canvasAdapter = canvasWriteAdapter({ prepareErrors: [undefined, "capability_input_invalid"] });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-invalid-effective-args",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-canvas-invalid-effective-args",
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "original prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: false, code: "capability_input_invalid" });
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { canvasWrite: canvasAdapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          effectiveArgs: { nodeId: "node-real", prompt: "edited prompt" },
          overridesDelta: { prompt: "edited prompt" },
        });
      }
    });
    const input = canvasExecutionInput("canvas-invalid-effective-args", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(canvasAdapter.prepare).toHaveBeenCalledTimes(2);
    expect(canvasAdapter.execute).not.toHaveBeenCalled();
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(final.items.find((item) => item.kind === "failure")).toMatchObject({
      code: "capability_input_invalid",
      retryable: true,
    });
    coordinator.release(opened.subscriptionId);
  });

  it("re-prepares create_canvas_nodes from every approved image/video field before execute", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-create-effective-args-"));
    const canvasAdapter = canvasWriteAdapter();
    const originalArgs = {
      nodes: [{ clientId: "image-1", kind: "image", prompt: "original", modelKey: "image-a", modeId: "t2i", params: { size: "1024x1024" } },
        { clientId: "video-1", kind: "video", prompt: "original video", modelKey: "video-a", modeId: "t2v", params: { aspect_ratio: "16:9", resolution: "720p", duration: 5 } }],
    };
    const effectiveArgs = {
      nodes: [{ clientId: "image-1", kind: "image", prompt: "edited image", modelKey: "image-b", modeId: "t2i", params: { size: "1536x1024" } },
        { clientId: "video-1", kind: "video", prompt: "edited video", modelKey: "video-b", modeId: "i2v", params: { aspect_ratio: "9:16", resolution: "1080p", duration: 8 } }],
    };
    let receipt: ProjectAgentProposalReceiptView | null = null;
    canvasAdapter.execute.mockImplementation(async (prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
      expect(prepared.call.args).toEqual(effectiveArgs);
      expect(prepared.invocation.input).toMatchObject({ operation: "create_canvas_nodes", nodes: effectiveArgs.nodes });
      receipt = committedCanvasReceipt(binding, approval);
      return { ok: true, result: { applied: true, proposalId: approval.receiptProposalId }, silent: true };
    });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-create-effective-args",
      {
        runAgent: async (_request, hooks) => {
          const call = { toolCallId: "tool-canvas-create-effective-args", toolName: "create_canvas_nodes", args: originalArgs };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({ ok: true, effectiveArgs });
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { canvasWrite: canvasAdapter, proposalReceipt: vi.fn(() => receipt) });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true, effectiveArgs, overridesDelta: { nodes: effectiveArgs.nodes },
      });
    });
    const base = canvasExecutionInput("canvas-create-effective-args", 0);
    const input = { ...base, mutation: { ...base.mutation, payload: { ...base.mutation.payload,
      queueItem: { ...base.mutation.payload.queueItem, target: { kind: "canvas" as const, nodeIds: ["node-real"] }, preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
        originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const } },
    } } };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(canvasAdapter.prepare).toHaveBeenCalledTimes(2);
    expect(canvasAdapter.execute).toHaveBeenCalledOnce();
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    coordinator.release(opened.subscriptionId);
  });

  it("persists a claimed Timeline approval before Surface execute", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-timeline-write-approved-"));
    const timelineAdapter = timelineWriteAdapter();
    let subscriptionId = "";
    let approvalWasClaimedBeforeExecute = false;
    const call = {
      toolCallId: "tool-timeline-write-approved",
      toolName: "apply_edit_plan",
      args: {
        planId: "plan-a",
        baseRevision: "deadbeef",
        summary: "Move clip A",
        operations: [{ kind: "move", clipId: "clip-a", startFrame: 48 }],
      },
    };
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-timeline-write-approved",
      {
        runAgent: async (_request, hooks) => {
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return documentWriteResponse(call, decision);
        },
      },
    );
    timelineAdapter.execute.mockImplementation(async (
      _prepared: PreparedTimelineWrite,
      approval: TimelineWriteApprovalAuthority,
    ) => {
      approvalWasClaimedBeforeExecute = coordinator.snapshot(subscriptionId).proposalApprovals.some(
        (candidate) => candidate.lifecycle === "claimed" &&
          candidate.ref.approvalId === approval.approvalId &&
          candidate.ref.actionHash === approval.actionHash,
      );
      return {
        ok: true,
        result: { operation: "apply_edit_plan", ok: true, revision: "cafebabe", applied: true },
        silent: true,
      };
    });
    const opened = await coordinator.open(binding, { timelineWrite: timelineAdapter });
    subscriptionId = opened.subscriptionId;
    coordinator.subscribe(subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { approved: true },
        });
      }
    });
    const base = executionInput("timeline-write-approved", 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "timeline" as const, clipIds: ["clip-a"] },
            preconditions: { timeline: { revision: "deadbeef" } },
            originSurface: { surfaceId: "timeline-surface", kind: "timeline" as const },
          },
        },
      },
    };
    await coordinator.enqueue(subscriptionId, input);
    const final = await coordinator.waitForTurn(subscriptionId, input.mutation.payload.turn.turnId);

    expect(approvalWasClaimedBeforeExecute).toBe(true);
    expect(timelineAdapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ invocation: expect.objectContaining({ actionHash: "timeline-action-hash" }) }),
      {
        receiptProposalId: expect.stringMatching(/^receipt-/),
        approvalId: expect.stringMatching(/^approval-/),
        actionHash: "timeline-action-hash",
      },
      expect.any(AbortSignal),
    );
    expect(final.proposalApprovals).toMatchObject([
      {
        lifecycle: "claimed",
        ref: {
          actionHash: "timeline-action-hash",
          target: { kind: "timeline", clipIds: ["clip-a"] },
          preconditions: { timeline: { revision: "deadbeef" } },
        },
      },
    ]);
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
    coordinator.release(subscriptionId);
  });

  it("atomically settles two clean Canvas approvals in one turn", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-two-clean-"));
    const canvasAdapter = canvasWriteAdapter();
    let receipt: ProjectAgentProposalReceiptView | null = null;
    canvasAdapter.execute.mockImplementation(
      async (_prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
        receipt = committedCanvasReceipt(binding, approval);
        return { ok: true, result: { applied: true, proposalId: approval.receiptProposalId }, silent: true };
      },
    );
    const readProposalReceipt = vi.fn(() => receipt);
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-two-clean",
      {
        runAgent: async (_request, hooks) => {
          const calls = [
            {
              toolCallId: "tool-canvas-clean-1",
              toolName: "set_node_prompt",
              args: { nodeId: "node-real", prompt: "first prompt" },
            },
            {
              toolCallId: "tool-canvas-clean-2",
              toolName: "set_node_prompt",
              args: { nodeId: "node-real", prompt: "second prompt" },
            },
          ];
          const decisions: AgentChatToolDecision[] = [];
          for (const call of calls) decisions.push(await hooks.awaitToolConfirmation(call, hooks.abortSignal!));
          const response = canvasWriteResponse(calls[0], decisions[0]);
          return {
            ...response,
            toolCalls: calls.map((call, index) => ({
              ...call,
              status: "ok" as const,
              decision: decisions[index],
            })),
          };
        },
      },
    );
    const opened = await coordinator.open(binding, {
      canvasWrite: canvasAdapter,
      proposalReceipt: readProposalReceipt,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { approved: true },
      });
    });
    const input = canvasExecutionInput("canvas-two-clean", 0);

    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(canvasAdapter.prepare).toHaveBeenCalledTimes(2);
    expect(canvasAdapter.execute).toHaveBeenCalledTimes(2);
    expect(readProposalReceipt).toHaveBeenCalledTimes(2);
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "done",
      retryable: false,
    });
    const proposals = final.items.filter((item) => item.kind === "proposal");
    expect(proposals).toHaveLength(2);
    expect(proposals.every((proposal) => proposal.status === "done" && proposal.retryable === false)).toBe(true);
  });

  it("settles an earlier Canvas approval done and a later unresolved approval failed without redispatch", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-mixed-settlement-"));
    const canvasAdapter = canvasWriteAdapter();
    let receipt: ProjectAgentProposalReceiptView | null = null;
    canvasAdapter.execute.mockImplementation(
      async (_prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
        if (canvasAdapter.execute.mock.calls.length === 1) receipt = committedCanvasReceipt(binding, approval);
        return { ok: true, result: { applied: true, proposalId: approval.receiptProposalId }, silent: true };
      },
    );
    const readProposalReceipt = vi.fn(() => receipt);
    const decisions: AgentChatToolDecision[] = [];
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-mixed-settlement",
      {
        runAgent: async (_request, hooks) => {
          const calls = [
            {
              toolCallId: "tool-canvas-mixed-1",
              toolName: "set_node_prompt",
              args: { nodeId: "node-real", prompt: "first prompt" },
            },
            {
              toolCallId: "tool-canvas-mixed-2",
              toolName: "set_node_prompt",
              args: { nodeId: "node-real", prompt: "second prompt" },
            },
            {
              toolCallId: "tool-canvas-mixed-3",
              toolName: "set_node_prompt",
              args: { nodeId: "node-real", prompt: "third prompt" },
            },
          ];
          for (const call of calls) decisions.push(await hooks.awaitToolConfirmation(call, hooks.abortSignal!));
          const response = canvasWriteResponse(calls[0], decisions[0]);
          return {
            ...response,
            toolCalls: calls.map((call, index) => ({
              ...call,
              status: decisions[index].ok ? ("ok" as const) : ("denied" as const),
              decision: decisions[index],
            })),
          };
        },
      },
    );
    const opened = await coordinator.open(binding, {
      canvasWrite: canvasAdapter,
      proposalReceipt: readProposalReceipt,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { approved: true },
      });
    });
    const input = canvasExecutionInput("canvas-mixed-settlement", 0);

    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(decisions).toHaveLength(3);
    expect(decisions[0]).toMatchObject({ ok: true });
    expect(decisions[1]).toMatchObject({ ok: false, code: "capability_receipt_unresolved" });
    expect(decisions[2]).toEqual(decisions[1]);
    expect(canvasAdapter.prepare).toHaveBeenCalledTimes(2);
    expect(canvasAdapter.execute).toHaveBeenCalledTimes(2);
    expect(readProposalReceipt).toHaveBeenCalledTimes(2);
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    const proposals = final.items.filter((item) => item.kind === "proposal");
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ status: "done", retryable: false });
    expect(proposals[1]).toMatchObject({ status: "failed", retryable: false });
  });

  it.each([
    { scenario: "missing receipt", forge: "missing" },
    { scenario: "receipt read error", forge: "read-error" },
    { scenario: "Surface output proposal id", forge: "output-proposal" },
    { scenario: "receipt binding", forge: "binding" },
    { scenario: "receipt proposal id", forge: "receipt-proposal" },
    { scenario: "Host approval id", forge: "approval" },
    { scenario: "Host action hash", forge: "action" },
  ] as const)("fails nonretryably when Canvas $scenario does not match the claimed approval", async ({ forge }) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-canvas-receipt-${forge}-`));
    const canvasAdapter = canvasWriteAdapter();
    let approval: CanvasWriteApprovalAuthority | undefined;
    canvasAdapter.execute.mockImplementation(
      async (_prepared: PreparedCanvasWrite, value: CanvasWriteApprovalAuthority) => {
        approval = value;
        return {
          ok: true,
          result: {
            applied: true,
            proposalId: forge === "output-proposal" ? "receipt-forged" : value.receiptProposalId,
          },
          silent: true,
        };
      },
    );
    const readProposalReceipt = vi.fn((): ProjectAgentProposalReceiptView | null => {
      if (forge === "read-error") throw new Error("receipt read failed");
      if (!approval || forge === "missing") return null;
      const exact = committedCanvasReceipt(binding, approval);
      if (forge === "binding") {
        return { ...exact, binding: { ...binding, projectId: "project-forged" } };
      }
      if (forge === "receipt-proposal") {
        return { ...exact, proposalId: "receipt-forged" };
      }
      if (forge === "approval") {
        return { ...exact, proposal: { ...exact.proposal, hostApprovalId: "approval-forged" } };
      }
      if (forge === "action") {
        return { ...exact, proposal: { ...exact.proposal, hostActionHash: "action-forged" } };
      }
      return exact;
    });
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => `subscription-canvas-receipt-${forge}`,
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: `tool-canvas-receipt-${forge}`,
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "new prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, {
      canvasWrite: canvasAdapter,
      proposalReceipt: readProposalReceipt,
    });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { approved: true },
      });
    });
    const base = executionInput(`canvas-receipt-${forge}`, 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "canvas" as const, nodeIds: ["node-real"] },
            preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
            originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const },
          },
        },
      },
    };

    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(canvasAdapter.execute).toHaveBeenCalledOnce();
    expect(readProposalReceipt).toHaveBeenCalledOnce();
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(
      final.items.find((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
    ).toMatchObject({
      code: "capability_receipt_unresolved",
      status: "failed",
      retryable: false,
    });
    expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "failed" });
    coordinator.release(opened.subscriptionId);
  });

  it.each([
    { executeState: "failed-result", receiptState: "exact", expectedStatus: "done" },
    { executeState: "throw", receiptState: "exact", expectedStatus: "done" },
    { executeState: "failed-result", receiptState: "missing", expectedStatus: "failed" },
    { executeState: "throw", receiptState: "missing", expectedStatus: "failed" },
  ] as const)(
    "reconciles a post-dispatch $executeState from a $receiptState receipt without redispatch",
    async ({ executeState, receiptState, expectedStatus }) => {
      const id = `canvas-post-dispatch-${executeState}-${receiptState}`;
      root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-${id}-`));
      const canvasAdapter = canvasWriteAdapter();
      let receipt: ProjectAgentProposalReceiptView | null = null;
      canvasAdapter.execute.mockImplementation(
        async (_prepared: PreparedCanvasWrite, approval: CanvasWriteApprovalAuthority) => {
          if (receiptState === "exact") receipt = committedCanvasReceipt(binding, approval);
          if (executeState === "throw") throw new Error("Surface response lost after dispatch");
          return { ok: false, code: "capability_timeout", message: "capability_timeout" };
        },
      );
      const readProposalReceipt = vi.fn(() => receipt);
      const decisions: AgentChatToolDecision[] = [];
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-${id}`,
        {
          runAgent: async (_request, hooks) => {
            const calls = [
              {
                toolCallId: `tool-${id}-1`,
                toolName: "set_node_prompt",
                args: { nodeId: "node-real", prompt: "new prompt" },
              },
              {
                toolCallId: `tool-${id}-2`,
                toolName: "set_node_prompt",
                args: { nodeId: "node-real", prompt: "second prompt" },
              },
            ];
            const callCount = 2;
            for (const call of calls.slice(0, callCount)) {
              decisions.push(await hooks.awaitToolConfirmation(call, hooks.abortSignal!));
            }
            const response = canvasWriteResponse(calls[0], decisions[0]);
            return {
              ...response,
              toolCalls: calls.slice(0, callCount).map((call, index) => ({
                ...call,
                status: decisions[index].ok ? ("ok" as const) : ("denied" as const),
                decision: decisions[index],
              })),
            };
          },
        },
      );
      const opened = await coordinator.open(binding, {
        canvasWrite: canvasAdapter,
        proposalReceipt: readProposalReceipt,
      });
      const pending = vi.fn();
      coordinator.subscribe(opened.subscriptionId, (event) => {
        if (event.type !== "tool-call") return;
        pending(event.toolCallId);
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { approved: true },
        });
      });
      const input = canvasExecutionInput(id, 0);

      await coordinator.enqueue(opened.subscriptionId, input);
      const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

      expect(pending).toHaveBeenCalledOnce();
      expect(canvasAdapter.prepare).toHaveBeenCalledOnce();
      expect(canvasAdapter.execute).toHaveBeenCalledOnce();
      expect(readProposalReceipt).toHaveBeenCalledOnce();
      expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
        status: expectedStatus,
        retryable: false,
      });
      if (receiptState === "exact") {
        expect(decisions).toHaveLength(2);
        expect(decisions[0]).toMatchObject({
          ok: true,
          proposalId: expect.stringMatching(/^receipt-/),
          silent: true,
        });
        expect(decisions[1]).toEqual(decisions[0]);
        expect(
          final.items.some((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
        ).toBe(false);
        expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "done" });
      } else {
        expect(decisions).toHaveLength(2);
        expect(decisions[0]).toMatchObject({ ok: false, code: "capability_receipt_unresolved" });
        expect(decisions[1]).toMatchObject({ ok: false, code: "capability_receipt_unresolved" });
        expect(
          final.items.find((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
        ).toMatchObject({
          code: "capability_receipt_unresolved",
          retryable: false,
        });
        expect(final.items.find((item) => item.kind === "proposal")).toMatchObject({ status: "failed" });
      }
    },
  );

  it("fails a canonical Canvas write without a Surface adapter and never emits a legacy confirmation", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-write-legacy-fallback-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-canvas-write-legacy-fallback",
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: "tool-canvas-write-legacy-fallback",
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "new prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          expect(decision).toMatchObject({
            ok: false,
            code: "capability_surface_unavailable",
            message: "capability_surface_unavailable",
          });
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding);
    const pending = vi.fn();
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      pending(event);
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { applied: "legacy" },
      });
    });
    const base = executionInput("canvas-write-legacy-fallback", 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "canvas" as const, nodeIds: ["node-real"] },
            preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
            originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const },
          },
        },
      },
    };

    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(pending).not.toHaveBeenCalled();
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(
      final.items.find((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
    ).toMatchObject({
      code: "capability_surface_unavailable",
      retryable: true,
    });
    expect(final.items.some((item) => item.kind === "proposal")).toBe(false);
    coordinator.release(opened.subscriptionId);
  });

  it("keeps canonical storyboard operations and the legacy planner alias on the renderer-owned path", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-storyboard-path-compatibility-"));
    const calls = [
      {
        toolCallId: "tool-storyboard-legacy",
        toolName: "propose_storyboard_plan",
        args: { title: "Legacy plan", anchors: [], shots: [{ index: 1 }] },
      },
      {
        toolCallId: "tool-storyboard-canonical",
        toolName: "nomi_canvas_plan",
        args: {
          operation: "patch_shots",
          select: { kind: "indexes", indexes: [1] },
          patch: { promptAppend: "rain" },
        },
      },
      {
        toolCallId: "tool-storyboard-legacy-malformed-args",
        toolName: "propose_storyboard_plan",
        args: [],
      },
    ];
    const decisions: AgentChatToolDecision[] = [];
    let callIndex = 0;
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-storyboard-path-compatibility",
      {
        runAgent: async (_request, hooks) => {
          const call = calls[callIndex++];
          if (!call) throw new Error("storyboard compatibility test exhausted its calls");
          decisions.push(await hooks.awaitToolConfirmation(call, hooks.abortSignal!));
          return {
            id: `result-${call.toolCallId}`,
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [{ ...call, status: decisions.at(-1)?.ok ? "ok" as const : "denied" as const, decision: decisions.at(-1)! }],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    const observedToolNames: string[] = [];
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      observedToolNames.push(event.toolName);
      void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
        ok: true,
        result: { approved: true },
      });
    });

    const legacyInput = canvasExecutionInput("storyboard-path-compatibility-legacy", 0);
    await coordinator.enqueue(opened.subscriptionId, legacyInput);
    const legacyFinal = await coordinator.waitForTurn(opened.subscriptionId, legacyInput.mutation.payload.turn.turnId);

    const canonicalInput = canvasExecutionInput(
      "storyboard-path-compatibility-canonical",
      coordinator.snapshot(opened.subscriptionId).hostRevision,
    );
    await coordinator.enqueue(opened.subscriptionId, canonicalInput);
    const canonicalFinal = await coordinator.waitForTurn(opened.subscriptionId, canonicalInput.mutation.payload.turn.turnId);

    const legacyMalformedInput = canvasExecutionInput(
      "storyboard-path-compatibility-legacy-malformed-args",
      coordinator.snapshot(opened.subscriptionId).hostRevision,
    );
    await coordinator.enqueue(opened.subscriptionId, legacyMalformedInput);
    const legacyMalformedFinal = await coordinator.waitForTurn(
      opened.subscriptionId,
      legacyMalformedInput.mutation.payload.turn.turnId,
    );

    expect(observedToolNames).toEqual(["propose_storyboard_plan", "nomi_canvas_plan", "propose_storyboard_plan"]);
    expect(decisions).toHaveLength(3);
    expect(decisions.every((decision) => decision.ok)).toBe(true);
    expect(legacyFinal.turns.find((turn) => turn.turnId === legacyInput.mutation.payload.turn.turnId)).toMatchObject({
      status: "done",
      retryable: false,
    });
    expect(canonicalFinal.turns.find((turn) => turn.turnId === canonicalInput.mutation.payload.turn.turnId)).toMatchObject({
      status: "done",
      retryable: false,
    });
    expect(legacyMalformedFinal.turns.find((turn) => turn.turnId === legacyMalformedInput.mutation.payload.turn.turnId)).toMatchObject({
      status: "done",
      retryable: false,
    });
    coordinator.release(opened.subscriptionId);
  });

  it.each([
    {
      code: "capability_declined",
      status: "declined",
      retryable: false,
      nextAction: "edit the request or submit a new proposal",
      approve: false,
    },
    {
      code: "capability_cancelled",
      status: "stopped",
      retryable: true,
      nextAction: "submit the request again when ready",
      approve: true,
    },
    {
      code: "capability_timeout",
      status: "failed",
      retryable: true,
      nextAction: "retry the capability request",
      approve: true,
    },
    {
      code: "capability_unsupported",
      status: "failed",
      retryable: false,
      nextAction: "use a capability supported by this surface",
      approve: true,
    },
    {
      code: "capability_target_stale",
      status: "failed",
      retryable: true,
      nextAction: "review the current canvas and submit a new proposal",
      approve: true,
    },
    {
      code: "capability_surface_unavailable",
      status: "failed",
      retryable: true,
      nextAction: "reopen the canvas and retry",
      approve: true,
    },
    {
      code: "capability_receipt_unresolved",
      status: "failed",
      retryable: false,
      nextAction: "review the canvas and submit a new proposal; do not retry automatically",
      approve: true,
    },
  ] as const)("durably projects Canvas outcome $code through every Host record", async (outcome) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-${outcome.code}-`));
    const canvasAdapter = canvasWriteAdapter(outcome.approve ? { prepareError: outcome.code } : {});
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => `subscription-${outcome.code}`,
      {
        runAgent: async (_request, hooks) => {
          const call = {
            toolCallId: `tool-${outcome.code}`,
            toolName: "set_node_prompt",
            args: { nodeId: "node-real", prompt: "new prompt" },
          };
          const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
          return canvasWriteResponse(call, decision);
        },
      },
    );
    const opened = await coordinator.open(binding, { canvasWrite: canvasAdapter });
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type !== "tool-call") return;
      void coordinator.resolveToolDecision(
        opened.subscriptionId,
        event.turnId,
        event.toolCallId,
        outcome.approve
          ? { ok: true, result: { approved: true } }
          : { ok: false, denied: true, message: "User declined Canvas write" },
      );
    });

    const base = executionInput(outcome.code, 0);
    const input = {
      ...base,
      mutation: {
        ...base.mutation,
        payload: {
          ...base.mutation.payload,
          queueItem: {
            ...base.mutation.payload.queueItem,
            target: { kind: "canvas" as const, nodeIds: ["node-real"] },
            preconditions: { nodes: [{ nodeId: "node-real", contentHash: "sha256-node" }] },
            originSurface: { surfaceId: "canvas-surface", kind: "canvas" as const },
          },
        },
      },
    };
    await coordinator.enqueue(opened.subscriptionId, input);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: outcome.status,
      retryable: outcome.retryable,
    });
    expect(final.queue.find((item) => item.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: outcome.status,
      retryable: outcome.retryable,
    });
    expect(
      final.items.find((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
    ).toMatchObject({
      code: outcome.code,
      message: outcome.code,
      nextAction: outcome.nextAction,
      status: outcome.status,
      retryable: outcome.retryable,
    });
    const proposal = final.items.find((item) => item.kind === "proposal");
    expect(proposal).toBeUndefined();
    expect(canvasAdapter.execute).not.toHaveBeenCalled();

    coordinator.release(opened.subscriptionId);
    const reopened = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => `reopened-${outcome.code}`,
    );
    const reopenedSubscription = await reopened.open(binding);
    const restored = reopened.snapshot(reopenedSubscription.subscriptionId);
    expect(restored.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)).toMatchObject({
      status: outcome.status,
      retryable: outcome.retryable,
    });
    expect(
      restored.items.find((item) => item.kind === "failure" && item.turnId === input.mutation.payload.turn.turnId),
    ).toMatchObject({
      code: outcome.code,
      status: outcome.status,
      retryable: outcome.retryable,
    });
    reopened.release(reopenedSubscription.subscriptionId);
  });

  it("includes frozen preconditions in the proposal action hash", async () => {
    const run = async (preconditions: Readonly<{ document: { revision: number; contentHash: string } }>) => {
      const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-document-write-action-hash-"));
      try {
        const documentAdapter = documentWriteAdapter();
        const coordinator = createProjectAgentExecutionCoordinator(
          createProjectAgentRepositoryRouter({ rootDir: localRoot }),
          () => "subscription-document-write-action-hash",
          {
            runAgent: async (_request, hooks) => {
              const call = {
                toolCallId: "tool-document-write-action-hash",
                toolName: "insert_at_cursor",
                args: { content: "x" },
              };
              const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
              return documentWriteResponse(call, decision);
            },
          },
        );
        const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
        coordinator.subscribe(opened.subscriptionId, (event) => {
          if (event.type === "tool-call") {
            void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
              ok: true,
              result: { applied: true },
            });
          }
        });
        const base = executionInput("document-write-action-hash", 0);
        const input = {
          ...base,
          mutation: {
            ...base.mutation,
            payload: {
              ...base.mutation.payload,
              queueItem: { ...base.mutation.payload.queueItem, preconditions },
            },
          },
        };
        await coordinator.enqueue(opened.subscriptionId, input);
        const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
        const proposal = final.items.find((item) => item.kind === "proposal");
        coordinator.release(opened.subscriptionId);
        // Drain's final snapshot runs in a following microtask. Let it observe
        // the terminal queue before removing this test's repository root.
        await new Promise<void>((resolve) => setImmediate(resolve));
        return proposal?.kind === "proposal" ? (proposal.approval?.actionHash ?? "") : "";
      } finally {
        fs.rmSync(localRoot, { recursive: true, force: true });
      }
    };

    const first = await run({ document: { revision: 1, contentHash: "fnv1a-one" } });
    const second = await run({ document: { revision: 2, contentHash: "fnv1a-two" } });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it.each(["document_target_stale", "surface_port_stale"] as const)(
    "fails closed when document.write preparation detects a stale %s",
    async (staleCode) => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-project-agent-document-write-${staleCode}-`));
      const documentAdapter = documentWriteAdapter({ prepareError: staleCode });
      const coordinator = createProjectAgentExecutionCoordinator(
        createProjectAgentRepositoryRouter({ rootDir: root }),
        () => `subscription-document-write-${staleCode}`,
        {
          runAgent: async (_request, hooks) => {
            const call = { toolCallId: `tool-${staleCode}`, toolName: "append_to_end", args: { content: "x" } };
            const decision = await hooks.awaitToolConfirmation(call, hooks.abortSignal!);
            expect(decision).toMatchObject({ ok: false, code: staleCode });
            return documentWriteResponse(call, decision);
          },
        },
      );
      const opened = await coordinator.open(binding, { documentWrite: documentAdapter });
      const toolEvents: ProjectAgentExecutionEvent[] = [];
      coordinator.subscribe(opened.subscriptionId, (event) => toolEvents.push(event));

      const input = executionInput(`document-write-${staleCode}`, 0);
      await coordinator.enqueue(opened.subscriptionId, input);
      const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);

      expect(documentAdapter.prepare).toHaveBeenCalledOnce();
      expect(documentAdapter.execute).not.toHaveBeenCalled();
      expect(toolEvents.filter((event) => event.type === "tool-call")).toHaveLength(0);
      expect(final.items.filter((item) => item.kind === "proposal")).toHaveLength(0);
    },
  );

  it("terminalizes a running turn when the model runtime fails", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-execution-error-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-execution-error",
      {
        runAgent: async (_request, hooks) => {
          hooks.emit({
            type: "tool-call",
            toolCallId: "tool-execution-error",
            toolName: "insert_at_cursor",
            args: { content: "x" },
          });
          const decision = await hooks.awaitToolConfirmation(
            { toolCallId: "tool-execution-error", toolName: "insert_at_cursor", args: { content: "x" } },
            hooks.abortSignal!,
          );
          expect(decision).toMatchObject({ ok: true });
          throw new Error("provider offline");
        },
      },
    );
    const opened = await coordinator.open(binding);
    let snapshotAtExecutionError: ReturnType<typeof coordinator.snapshot> | null = null;
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
      }
      if (event.type === "execution-error") {
        snapshotAtExecutionError = coordinator.snapshot(opened.subscriptionId);
      }
    });
    const now = "2026-08-28T00:00:00.000Z";
    const thread = {
      threadId: "thread-execution-error",
      createdAt: now,
      updatedAt: now,
    };
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, thread.threadId),
      contextRevision: 0,
      recordId: "canonical-context-execution-error",
    } as const;
    const turn = {
      turnId: "turn-execution-error",
      threadId: thread.threadId,
      executionToken: "execution-token-error",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "creation-chat", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const userItem = {
      itemId: "user-execution-error",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "hi",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const queueItem = {
      queueItemId: "queue-execution-error",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "document" as const, documentId: "doc", anchor: { kind: "whole-document" as const } },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "document" as const },
      enqueuedAt: now,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: now,
    };
    await coordinator.enqueue(opened.subscriptionId, {
      mutation: {
        commandId: "enqueue-execution-error",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: opened.subscriptionId },
        type: "turn.enqueue",
        payload: { thread, turn, userItem, queueItem },
      },
      request: {
        prompt: "hi",
        capability: "creation-chat",
        history: { kind: "ephemeral" },
        projectId: binding.projectId,
      },
    });
    const final = await Promise.race([
      coordinator.waitForTurn(opened.subscriptionId, turn.turnId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn did not reach terminal state")), 500)),
    ]);
    expect(final.turns.find((candidate) => candidate.turnId === turn.turnId)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(final.queue.find((candidate) => candidate.turnId === turn.turnId)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(
      final.items.find((candidate) => candidate.kind === "assistant" && candidate.turnId === turn.turnId),
    ).toMatchObject({ status: "failed" });
    expect(
      final.items.find((candidate) => candidate.kind === "failure" && candidate.turnId === turn.turnId),
    ).toMatchObject({ status: "failed", retryable: true, code: "runtime_error", message: "provider offline" });
    expect(snapshotAtExecutionError).not.toBeNull();
    expect(snapshotAtExecutionError!.turns.find((candidate) => candidate.turnId === turn.turnId)).toMatchObject({
      status: "failed",
    });
    expect(snapshotAtExecutionError!.queue.find((candidate) => candidate.turnId === turn.turnId)).toMatchObject({
      status: "failed",
    });
    expect(
      snapshotAtExecutionError!.items.find(
        (candidate) => candidate.kind === "failure" && candidate.turnId === turn.turnId,
      ),
    ).toMatchObject({ status: "failed", code: "runtime_error", message: "provider offline" });
  });

  it("does not publish execution-error when terminal failure commit leaves the durable turn running", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-terminal-commit-error-"));
    const backingRouter = createProjectAgentRepositoryRouter({ rootDir: root });
    const backingHost = backingRouter.attach(binding);
    let terminalAttempted!: () => void;
    const terminalAttempt = new Promise<void>((resolve) => {
      terminalAttempted = resolve;
    });
    const host = {
      ...backingHost,
      dispatch: async (mutation: ProjectAgentMutation) => {
        if (mutation.type === "async.result" && mutation.commandId.startsWith("execution-failed-")) {
          terminalAttempted();
          throw new Error("terminal repository unavailable");
        }
        return backingHost.dispatch(mutation);
      },
    };
    const router = {
      attach: () => host,
      repositoryFor: backingRouter.repositoryFor,
      partitionCount: backingRouter.partitionCount,
    } as unknown as Parameters<typeof createProjectAgentExecutionCoordinator>[0];
    const internalErrors: Array<{
      error: unknown;
      context: { phase: string; turnId: string; message: string };
    }> = [];
    const coordinator = createProjectAgentExecutionCoordinator(router, () => "subscription-terminal-commit-error", {
      runAgent: async (_request, hooks) => {
        hooks.emit({ type: "content-delta", delta: "partial answer" });
        throw new Error("provider offline");
      },
      reportInternalError: (error, context) => internalErrors.push({ error, context }),
    });
    const opened = await coordinator.open(binding);
    const published: ProjectAgentExecutionEvent[] = [];
    coordinator.subscribe(opened.subscriptionId, (event) => published.push(event));
    const now = "2026-08-28T00:00:00.000Z";
    const thread = {
      threadId: "thread-terminal-commit-error",
      createdAt: now,
      updatedAt: now,
    };
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, thread.threadId),
      contextRevision: 0,
      recordId: "context-terminal-commit-error",
    } as const;
    const turn = {
      turnId: "turn-terminal-commit-error",
      threadId: thread.threadId,
      executionToken: "token-terminal-commit-error",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "creation-chat", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const userItem = {
      itemId: "user-terminal-commit-error",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "hi",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const queueItem = {
      queueItemId: "queue-terminal-commit-error",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "document" as const, documentId: "doc", anchor: { kind: "whole-document" as const } },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "document" as const },
      enqueuedAt: now,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: now,
    };
    await coordinator.enqueue(opened.subscriptionId, {
      mutation: {
        commandId: "enqueue-terminal-commit-error",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: opened.subscriptionId },
        type: "turn.enqueue",
        payload: { thread, turn, userItem, queueItem },
      },
      request: {
        prompt: "hi",
        capability: "creation-chat",
        history: { kind: "ephemeral" },
        projectId: binding.projectId,
      },
    });
    await terminalAttempt;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(coordinator.snapshot(opened.subscriptionId).turns.find((item) => item.turnId === turn.turnId)?.status).toBe(
      "running",
    );
    expect(published.filter((event) => event.type === "execution-error")).toEqual([]);
    expect(internalErrors).toMatchObject([
      {
        error: { message: "terminal repository unavailable" },
        context: {
          phase: "terminalize-runtime-failure",
          turnId: turn.turnId,
          message: "provider offline",
        },
      },
    ]);
  });

  it("does not abort an execution when a stale stop command is rejected", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-stale-stop-"));
    let startedResolve!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    let finishedResolve!: () => void;
    const executionFinished = new Promise<void>((resolve) => {
      finishedResolve = resolve;
    });
    let aborted = false;
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-stale-stop",
      {
        runAgent: async (_request, hooks) => {
          startedResolve();
          await new Promise<void>((resolve) => {
            hooks.abortSignal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            );
          });
          finishedResolve();
          return {
            id: "cancelled",
            text: "",
            status: "cancelled",
            toolCalls: [],
            artifacts: [],
            usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 },
            finishReason: "aborted",
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    const now = "2026-08-28T00:00:00.000Z";
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, "thread-stale-stop"),
      contextRevision: 0,
      recordId: "context-stale-stop",
    } as const;
    const thread = { threadId: "thread-stale-stop", createdAt: now, updatedAt: now } as const;
    const turn = {
      turnId: "turn-stale-stop",
      threadId: thread.threadId,
      executionToken: "token-stale-stop",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "creation-chat", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const userItem = {
      itemId: "user-stale-stop",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "wait",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const queueItem = {
      queueItemId: "queue-stale-stop",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "document" as const, documentId: "doc", anchor: { kind: "whole-document" as const } },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "document" as const },
      enqueuedAt: now,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: now,
    };
    const request: AgentChatRequest = {
      prompt: "wait",
      capability: "creation-chat",
      history: { kind: "ephemeral" },
      projectId: binding.projectId,
    };
    await coordinator.enqueue(opened.subscriptionId, {
      mutation: {
        commandId: "enqueue-stale-stop",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: opened.subscriptionId },
        type: "turn.enqueue",
        payload: { thread, turn, userItem, queueItem },
      },
      request,
    });
    await executionStarted;

    const running = coordinator.snapshot(opened.subscriptionId);
    await expect(
      coordinator.dispatch(opened.subscriptionId, {
        commandId: "stale-stop",
        expectedRevision: running.hostRevision - 1,
        binding,
        sender: { kind: "renderer", senderId: opened.subscriptionId },
        type: "turn.transition",
        payload: { turnId: turn.turnId, status: "stopped", updatedAt: "2026-08-28T00:00:01.000Z" },
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(aborted).toBe(false);
    expect(coordinator.snapshot(opened.subscriptionId).turns.find((item) => item.turnId === turn.turnId)?.status).toBe(
      "running",
    );
    await coordinator.dispatch(opened.subscriptionId, {
      commandId: "valid-stop",
      expectedRevision: coordinator.snapshot(opened.subscriptionId).hostRevision,
      binding,
      sender: { kind: "renderer", senderId: opened.subscriptionId },
      type: "turn.transition",
      payload: {
        turnId: turn.turnId,
        status: "stopped",
        updatedAt: running.turns.find((item) => item.turnId === turn.turnId)!.updatedAt,
      },
    });
    await executionFinished;
    expect(aborted).toBe(true);
    coordinator.release(opened.subscriptionId);
  });

  it("retries the FIFO head after a start revision conflict without dropping its request", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-start-race-"));
    const backingRouter = createProjectAgentRepositoryRouter({ rootDir: root });
    const backingHost = backingRouter.attach(binding);
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let startEntered!: () => void;
    const startReady = new Promise<void>((resolve) => {
      startEntered = resolve;
    });
    let firstStart = true;
    const host = {
      ...backingHost,
      dispatch: (mutation: ProjectAgentMutation) => {
        if (firstStart && mutation.type === "turn.start") {
          firstStart = false;
          startEntered();
          return startGate.then(() => backingHost.dispatch(mutation));
        }
        return backingHost.dispatch(mutation);
      },
    };
    const router = {
      attach: () => host,
      repositoryFor: backingRouter.repositoryFor,
      partitionCount: backingRouter.partitionCount,
    } as unknown as Parameters<typeof createProjectAgentExecutionCoordinator>[0];
    let runCount = 0;
    let runFinished!: () => void;
    const runComplete = new Promise<void>((resolve) => {
      runFinished = resolve;
    });
    const coordinator = createProjectAgentExecutionCoordinator(router, () => "subscription-start-race", {
      runAgent: async () => {
        runCount += 1;
        runFinished();
        return {
          id: "completed",
          status: "finished",
          text: "completed",
          finishReason: "stop",
          artifacts: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
        } satisfies AgentChatResponse;
      },
    });
    const opened = await coordinator.open(binding);
    const now = "2026-08-28T00:00:00.000Z";
    const thread = {
      threadId: "thread-start-race",
      createdAt: now,
      updatedAt: now,
    };
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, thread.threadId),
      contextRevision: 0,
      recordId: "context-start-race",
    } as const;
    const turn = {
      turnId: "turn-start-race",
      threadId: thread.threadId,
      executionToken: "token-start-race",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "creation-chat", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const userItem = {
      itemId: "user-start-race",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "original",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    };
    const queueItem = {
      queueItemId: "queue-start-race",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "document" as const, documentId: "doc", anchor: { kind: "whole-document" as const } },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "document" as const },
      enqueuedAt: now,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: now,
    };
    const request: AgentChatRequest = {
      prompt: "original",
      capability: "creation-chat",
      history: { kind: "ephemeral" },
      projectId: binding.projectId,
    };
    await coordinator.enqueue(opened.subscriptionId, {
      mutation: {
        commandId: "enqueue-start-race",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: opened.subscriptionId },
        type: "turn.enqueue",
        payload: { thread, turn, userItem, queueItem },
      },
      request,
    });
    await startReady;

    await coordinator.dispatch(opened.subscriptionId, {
      commandId: "edit-start-race",
      expectedRevision: 1,
      binding,
      sender: { kind: "renderer", senderId: opened.subscriptionId },
      type: "queue.edit",
      payload: {
        queueItemId: queueItem.queueItemId,
        userItemId: userItem.itemId,
        text: "edited before start",
        occurredAt: "2026-08-28T00:00:01.000Z",
      },
    });
    releaseStart();
    await runComplete;

    expect(runCount).toBe(1);
    const final = await coordinator.waitForTurn(opened.subscriptionId, turn.turnId);
    expect(final.turns[0]?.status).toBe("done");
    coordinator.release(opened.subscriptionId);
  });

  it("rejects a forged request project and derives canvas selection from the queued target", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-request-scope-"));
    let capturedRequest: AgentChatRequest | undefined;
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-request-scope",
      {
        runAgent: async (request) => {
          capturedRequest = request;
          return {
            id: "request-scope-result",
            status: "finished",
            text: "done",
            finishReason: "stop",
            artifacts: [],
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
          } satisfies AgentChatResponse;
        },
      },
    );
    const opened = await coordinator.open(binding);
    const timestamp = "2026-08-28T00:00:00.000Z";
    const thread = {
      threadId: "thread-request-scope",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const contextRef = {
      binding: createProjectAgentContextBinding(binding, thread.threadId),
      contextRevision: 0,
      recordId: "context-request-scope",
    } as const;
    const turn = {
      turnId: "turn-request-scope",
      threadId: thread.threadId,
      executionToken: "token-request-scope",
      model: { id: "model", version: 1 },
      skillVersions: [],
      capabilityVersions: [{ id: "canvas-refine", version: 1 }],
      contextRef,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const userItem = {
      itemId: "user-request-scope",
      threadId: thread.threadId,
      turnId: turn.turnId,
      kind: "user" as const,
      text: "refine",
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const queueItem = {
      queueItemId: "queue-request-scope",
      threadId: thread.threadId,
      turnId: turn.turnId,
      binding,
      target: { kind: "canvas" as const, nodeIds: ["canonical-node"] },
      preconditions: {},
      contextRef,
      model: turn.model,
      skillVersions: [],
      capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [],
      originSurface: { surfaceId: "surface", kind: "canvas" as const },
      enqueuedAt: timestamp,
      status: "queued" as const,
      retryable: false,
      deviated: false,
      updatedAt: timestamp,
    };
    const mutation: Extract<ProjectAgentMutation, { type: "turn.enqueue" }> = {
      commandId: "enqueue-request-scope",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: opened.subscriptionId },
      type: "turn.enqueue",
      payload: { thread, turn, userItem, queueItem },
    };

    await expect(
      coordinator.enqueue(opened.subscriptionId, {
        mutation,
        request: {
          prompt: "forged",
          capability: "canvas-refine",
          history: { kind: "ephemeral" },
          projectId: "project-b",
          selectedNodeIds: ["forged-node"],
        },
      }),
    ).rejects.toThrow(ProjectAgentSubscriptionError);

    await coordinator.enqueue(opened.subscriptionId, {
      mutation,
      request: {
        prompt: "valid",
        capability: "canvas-refine",
        history: { kind: "ephemeral" },
        projectId: binding.projectId,
        selectedNodeIds: ["forged-node"],
      },
    });
    await coordinator.waitForTurn(opened.subscriptionId, turn.turnId);
    expect(capturedRequest).toMatchObject({
      projectId: binding.projectId,
      canvasProjectId: binding.projectId,
      selectedNodeIds: ["canonical-node"],
    });
  });

  it("applies a queued steer before the next model request", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-steer-"));
    let observedPrompt = "";
    const coordinator = createProjectAgentExecutionCoordinator(createProjectAgentRepositoryRouter({ rootDir: root }), () => "subscription-steer", {
      runAgent: async (request) => {
        observedPrompt = request.prompt;
        return { id: "steer-result", status: "finished", text: "done", finishReason: "stop", artifacts: [], toolCalls: [], usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 } };
      },
    });
    const opened = await coordinator.open(binding);
    const base = executionInput("steer", 0);
    const input: ExecutionInput = { ...base, mutation: { ...base.mutation, payload: { ...base.mutation.payload, queueItem: { ...base.mutation.payload.queueItem, paused: true } } } };
    await coordinator.enqueue(opened.subscriptionId, input);
    await coordinator.steer(opened.subscriptionId, input.mutation.payload.turn.turnId, "改成更近的镜头");
    const beforeResume = coordinator.snapshot(opened.subscriptionId);
    await coordinator.dispatch(opened.subscriptionId, {
      commandId: "resume-steer",
      expectedRevision: beforeResume.hostRevision,
      binding,
      sender: { kind: "renderer", senderId: opened.subscriptionId },
      type: "queue.resume",
      payload: { queueItemId: input.mutation.payload.queueItem.queueItemId, occurredAt: "2026-08-28T00:00:01.000Z" },
    });
    await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(observedPrompt).toContain("改成更近的镜头");
  });

  it("interrupts a partially published turn and settles it as stopped", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-interrupt-"));
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const coordinator = createProjectAgentExecutionCoordinator(createProjectAgentRepositoryRouter({ rootDir: root }), () => "subscription-interrupt", {
      runAgent: async (_request, hooks) => {
        hooks.emit({ type: "content-delta", delta: "partial" });
        started();
        return new Promise<AgentChatResponse>((_resolve, reject) => {
          hooks.abortSignal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        });
      },
    });
    const opened = await coordinator.open(binding);
    const input = executionInput("interrupt", 0);
    await coordinator.enqueue(opened.subscriptionId, input);
    await startedPromise;
    await coordinator.interrupt(opened.subscriptionId, input.mutation.payload.turn.turnId);
    const final = await coordinator.waitForTurn(opened.subscriptionId, input.mutation.payload.turn.turnId);
    expect(final.turns.find((turn) => turn.turnId === input.mutation.payload.turn.turnId)?.status).toBe("stopped");
    expect(final.items.find((item) => item.kind === "assistant" && item.turnId === input.mutation.payload.turn.turnId)).toMatchObject({ text: "partial" });
  });
});
