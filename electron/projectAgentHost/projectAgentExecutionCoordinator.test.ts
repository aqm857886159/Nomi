import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectAgentMutation } from "../shared/projectAgentContracts";
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

let root = "";

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgentExecutionCoordinator", () => {
  it("keeps commands scoped to the opened subscription binding", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-coordinator-"));
    const coordinator = createProjectAgentExecutionCoordinator(
      createProjectAgentRepositoryRouter({ rootDir: root }),
      () => "subscription-a",
    );
    const opened = coordinator.open(binding);
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
    const toolCallSeen = new Promise<{ turnId: string; toolCallId: string }>((resolve) => {
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
      const opened = coordinator.open(binding);
      subscriptionId = opened.subscriptionId;
      coordinator.subscribe(opened.subscriptionId, (event) => {
        if (event.type === "tool-call") resolve({ turnId: event.turnId, toolCallId: event.toolCallId });
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
    });
    const seen = await toolCallSeen;
    let unsubscribeReplay = () => {};
    const replayed = new Promise<void>((resolve) => {
      unsubscribeReplay = coordinator.subscribe(subscriptionId, (event) => {
        if (event.type === "tool-call" && event.toolCallId === seen.toolCallId) {
          resolve();
        }
      });
    });
    await replayed;
    unsubscribeReplay();
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
    const opened = coordinator.open(binding);
    coordinator.subscribe(opened.subscriptionId, (event) => {
      if (event.type === "tool-call") {
        void coordinator.resolveToolDecision(opened.subscriptionId, event.turnId, event.toolCallId, {
          ok: true,
          result: { applied: true },
        });
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
    const opened = coordinator.open(binding);
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
    coordinator.release(opened.subscriptionId);
    await executionFinished;
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
    const opened = coordinator.open(binding);
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
    const opened = coordinator.open(binding);
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
