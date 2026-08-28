import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import type { AgentChatRequest, AgentChatResponse } from "../harness/agentChatContracts";
import { createProjectAgentContextBinding } from "./projectAgentContextBinding";
import {
  createProjectAgentExecutionCoordinator,
  ProjectAgentSubscriptionError,
} from "./projectAgentExecutionCoordinator";
import { createProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";

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
): ExecutionInput {
  const occurredAt = "2026-08-28T00:00:00.000Z";
  const thread = {
    threadId: `thread-${id}`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    provenance: { kind: "canonical" as const },
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
      prompt: id,
      capability: "creation-chat",
      history: { kind: "ephemeral" as const },
      projectId: projectBinding.projectId,
    },
  };
}

let root = "";

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgentExecutionCoordinator", () => {
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
    expect(firstEvents.every((event) => event.subscriptionId === first.subscriptionId && event.subscriptionEpoch === 1)).toBe(true);
    expect(secondEvents.every((event) => event.subscriptionId === second.subscriptionId && event.subscriptionEpoch === 2)).toBe(true);
    const firstPatchRevisions = firstEvents
      .filter((event) => event.type === "patch")
      .map((event) => event.patch.hostRevision);
    const secondPatchRevisions = secondEvents
      .filter((event) => event.type === "patch")
      .map((event) => event.patch.hostRevision);
    expect(firstPatchRevisions).toEqual(secondPatchRevisions.slice(0, firstPatchRevisions.length));
    expect(secondPatchRevisions).toEqual([...secondPatchRevisions].sort((left, right) => left - right));
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
        state = (await host.dispatch({
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
        })).state;
      }
      if (orphanStatus === "proposed") {
        const ref = {
          approvalId: "approval-recovery-proposed",
          threadId: input.mutation.payload.thread.threadId,
          turnId: input.mutation.payload.turn.turnId,
          toolCallId: "tool-recovery-proposed",
          actionHash: "action-recovery-proposed",
          target: input.mutation.payload.queueItem.target,
          preconditions: input.mutation.payload.queueItem.preconditions,
          expiresAt: "2026-08-29T00:00:00.000Z",
        } as const;
        state = (await host.dispatch({
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
        })).state;
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
    let coordinator!: ReturnType<typeof createProjectAgentExecutionCoordinator>;
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
    coordinator = createProjectAgentExecutionCoordinator(
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
        provenance: { kind: "canonical" as const },
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
      published.slice(0, resultIndex).some(
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
      provenance: { kind: "canonical" as const },
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
      provenance: { kind: "canonical" as const },
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
      provenance: { kind: "canonical" as const },
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
      provenance: { kind: "canonical" as const },
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
});
