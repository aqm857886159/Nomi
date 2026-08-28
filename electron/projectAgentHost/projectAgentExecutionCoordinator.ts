import crypto, { createHash } from "node:crypto";
import type { AgentChatRequest, AgentChatResponse, AgentChatToolDecision } from "../harness/agentChatContracts";
import type { AgentChatV2Hooks } from "../ai/agentChatV2";
import { captureAgentChatRequest } from "../harness/agentChatPolicy";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentTurn,
  ProjectAgentQueueItem,
  ProjectAgentPatch,
  ProjectBinding,
  ProjectAgentStatus,
} from "../shared/projectAgentContracts";
import { sameProjectAgentBinding } from "./projectAgentIdentity";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";

export type ProjectAgentSubscription = Readonly<{
  subscriptionId: string;
  binding: ProjectBinding;
  snapshot: ProjectAgentHostState;
}>;

export type ProjectAgentExecutionCoordinatorDeps = Readonly<{
  runAgent?: (request: AgentChatRequest, hooks: AgentChatV2Hooks) => Promise<AgentChatResponse>;
  now?: () => string;
}>;

type ProjectAgentExecutionEnqueue = Readonly<{
  mutation: Extract<ProjectAgentMutation, { type: "turn.enqueue" }>;
  request: AgentChatRequest;
}>;

type ProjectAgentExecutionListener = (event: ProjectAgentExecutionEvent) => void;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type PendingToolDecision = Readonly<{
  turnId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  resolve: (decision: AgentChatToolDecision) => void;
  signal: AbortSignal;
}>;

type ActiveExecution = {
  turn: ProjectAgentTurn;
  queueItem: ProjectAgentQueueItem;
  request: AgentChatRequest;
  controller: AbortController;
  pending: Map<string, PendingToolDecision>;
  publicationTail: Promise<void>;
  approvedProposalId?: string;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(`nomi-project-agent-execution:v1\0${stableJson(value)}`)
    .digest("hex");
}

function statusForResponse(response: AgentChatResponse): ProjectAgentStatus {
  if (response.status === "cancelled") return "stopped";
  if (response.status === "error") return "failed";
  return "done";
}

function executionPrompt(snapshot: ProjectAgentHostState, turnId: string, request: AgentChatRequest): string {
  const prior = snapshot.items
    .filter((item) => item.threadId === snapshot.activeThreadId && item.turnId !== turnId)
    .flatMap((item) => {
      if (item.kind === "user") return [`用户：${item.text}`];
      if (item.kind === "assistant") return [`Nomi：${item.text}`];
      return [];
    })
    .join("\n");
  if (!prior) return request.prompt;
  return `此前同一项目线程：\n${prior}\n\n本轮请求：\n${request.prompt}`;
}

function toolItem(
  binding: ProjectBinding,
  turn: ProjectAgentTurn,
  record: AgentChatResponse["toolCalls"][number],
  now: string,
): ProjectAgentItem {
  const status = record.status === "ok" ? "done" : record.status === "cancelled" ? "stopped" : "failed";
  return Object.freeze({
    itemId: `tool-${digest([binding, turn.executionToken, record.toolCallId])}`,
    threadId: turn.threadId,
    turnId: turn.turnId,
    kind: "tool" as const,
    toolCallId: record.toolCallId,
    invocationId: `invocation-${digest([turn.executionToken, record.toolCallId])}`,
    capability: { id: record.toolName, version: 1 },
    ...(record.error ? { text: record.error } : {}),
    resultRef: `result-${digest(record.result ?? record.error ?? record.status)}`,
    status,
    retryable: false,
    deviated: false,
    createdAt: now,
    updatedAt: now,
  });
}

export type ProjectAgentExecutionCoordinator = Readonly<{
  open: (
    binding: ProjectBinding,
    options?: Readonly<{ canvasRead?: PiCanvasReadTransportAdapter }>,
  ) => ProjectAgentSubscription;
  snapshot: (subscriptionId: string) => ProjectAgentHostState;
  dispatch: (subscriptionId: string, mutation: ProjectAgentMutation) => ReturnType<OfflineProjectAgentHost["dispatch"]>;
  enqueue: (
    subscriptionId: string,
    input: ProjectAgentExecutionEnqueue,
  ) => ReturnType<OfflineProjectAgentHost["dispatch"]>;
  subscribe: (subscriptionId: string, listener: ProjectAgentExecutionListener) => () => void;
  resolveToolDecision: (
    subscriptionId: string,
    turnId: string,
    toolCallId: string,
    decision: AgentChatToolDecision,
  ) => Promise<void>;
  waitForTurn: (subscriptionId: string, turnId: string) => Promise<ProjectAgentHostState>;
  release: (subscriptionId: string) => void;
  subscriptionCount: () => number;
}>;

export class ProjectAgentSubscriptionError extends Error {
  readonly code = "project_agent_subscription_invalid" as const;
}

type SubscriptionRecord = ProjectAgentSubscription & Readonly<{ host: OfflineProjectAgentHost }>;

export function createProjectAgentExecutionCoordinator(
  router: ProjectAgentRepositoryRouter,
  randomId: () => string = () => crypto.randomUUID(),
  deps: ProjectAgentExecutionCoordinatorDeps = {},
): ProjectAgentExecutionCoordinator {
  const subscriptions = new Map<string, SubscriptionRecord>();
  const listeners = new Map<string, Set<ProjectAgentExecutionListener>>();
  const canvasReads = new Map<string, PiCanvasReadTransportAdapter | undefined>();
  const requests = new Map<string, Map<string, AgentChatRequest>>();
  const active = new Map<string, Map<string, ActiveExecution>>();
  const completions = new Map<string, Map<string, Deferred<ProjectAgentHostState>>>();
  const drains = new Map<string, Promise<void>>();
  const runAgent =
    deps.runAgent ?? (async (request, hooks) => (await import("../ai/agentChatV2")).runAgentChatV2(request, hooks));
  const now = deps.now ?? (() => new Date().toISOString());

  function publish(subscriptionId: string, event: ProjectAgentExecutionEvent): void {
    for (const listener of listeners.get(subscriptionId) ?? []) {
      try {
        listener(event);
      } catch {
        /* A renderer observer cannot stop execution. */
      }
    }
  }

  function publishPatch(subscriptionId: string, patch: ProjectAgentPatch): void {
    publish(subscriptionId, { type: "patch", patch });
  }

  function complete(subscriptionId: string, turnId: string): void {
    const record = subscriptions.get(subscriptionId);
    const pending = completions.get(subscriptionId)?.get(turnId);
    if (!record || !pending) return;
    const state = record.host.getSnapshot(record.binding);
    const turn = state.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn || ["queued", "running", "proposed"].includes(turn.status)) return;
    pending.resolve(state);
    completions.get(subscriptionId)?.delete(turnId);
  }

  function completionFor(subscriptionId: string, turnId: string): Promise<ProjectAgentHostState> {
    const record = requireSubscription(subscriptionId);
    const existing = completions.get(subscriptionId)?.get(turnId);
    if (existing) return existing.promise;
    const current = record.host.getSnapshot(record.binding);
    const turn = current.turns.find((candidate) => candidate.turnId === turnId);
    if (turn && !["queued", "running", "proposed"].includes(turn.status)) return Promise.resolve(current);
    const entry = deferred<ProjectAgentHostState>();
    let map = completions.get(subscriptionId);
    if (!map) {
      map = new Map();
      completions.set(subscriptionId, map);
    }
    map.set(turnId, entry);
    return entry.promise;
  }

  function open(
    binding: ProjectBinding,
    options: Readonly<{ canvasRead?: PiCanvasReadTransportAdapter }> = {},
  ): ProjectAgentSubscription {
    const host = router.attach(binding);
    const subscription: SubscriptionRecord = Object.freeze({
      subscriptionId: randomId(),
      binding: Object.freeze({ ...binding }),
      snapshot: host.getSnapshot(binding),
      host,
    });
    if (subscriptions.has(subscription.subscriptionId)) {
      throw new ProjectAgentSubscriptionError("Project Agent subscription id collision");
    }
    subscriptions.set(subscription.subscriptionId, subscription);
    listeners.set(subscription.subscriptionId, new Set());
    requests.set(subscription.subscriptionId, new Map());
    active.set(subscription.subscriptionId, new Map());
    completions.set(subscription.subscriptionId, new Map());
    canvasReads.set(subscription.subscriptionId, options.canvasRead);
    return subscription;
  }

  function requireSubscription(subscriptionId: string): SubscriptionRecord {
    const record = subscriptions.get(subscriptionId);
    if (!record) throw new ProjectAgentSubscriptionError("Project Agent subscription is unavailable");
    return record;
  }

  function dispatch(subscriptionId: string, mutation: ProjectAgentMutation) {
    const record = requireSubscription(subscriptionId);
    if (!sameProjectAgentBinding(mutation.binding, record.binding)) {
      throw new ProjectAgentSubscriptionError("Project Agent subscription binding mismatch");
    }
    return record.host.dispatch(mutation).then((reduction) => {
      // Abort only after the stop transition commits. A stale or malformed
      // stop command must not cancel an execution that remains running.
      if (mutation.type === "turn.transition" && mutation.payload.status === "stopped") {
        active.get(subscriptionId)?.get(mutation.payload.turnId)?.controller.abort();
      }
      if (reduction.patch) publishPatch(subscriptionId, reduction.patch);
      complete(subscriptionId, mutation.type === "turn.transition" ? mutation.payload.turnId : "");
      scheduleDrain(subscriptionId);
      return reduction;
    });
  }

  function snapshot(subscriptionId: string): ProjectAgentHostState {
    const record = requireSubscription(subscriptionId);
    return record.host.getSnapshot(record.binding);
  }

  async function enqueue(subscriptionId: string, input: ProjectAgentExecutionEnqueue) {
    const request = captureAgentChatRequest({ ...input.request, history: { kind: "ephemeral" } });
    const requestMap = requests.get(subscriptionId);
    if (!requestMap) throw new ProjectAgentSubscriptionError("Project Agent subscription is unavailable");
    const turnId = input.mutation.payload.turn.turnId;
    const previousRequest = requestMap.get(turnId);
    // Register the ephemeral execution input before dispatch can schedule a
    // drain. Otherwise its first microtask can observe a queued turn without
    // a request and strand the FIFO head permanently.
    requestMap.set(turnId, request);
    try {
      const reduction = await dispatch(subscriptionId, input.mutation);
      if (!reduction.replayed) {
        completionFor(subscriptionId, turnId);
        scheduleDrain(subscriptionId);
      } else if (previousRequest) {
        requestMap.set(turnId, previousRequest);
      } else {
        requestMap.delete(turnId);
      }
      return reduction;
    } catch (error) {
      if (previousRequest) requestMap.set(turnId, previousRequest);
      else requestMap.delete(turnId);
      throw error;
    }
  }

  function queueExecutionMutation(
    subscriptionId: string,
    execution: ActiveExecution,
    work: () => Promise<void>,
  ): Promise<void> {
    const next = execution.publicationTail.then(work, work);
    execution.publicationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function dispatchFresh(
    subscriptionId: string,
    build: (state: ProjectAgentHostState) => ProjectAgentMutation,
  ): Promise<Awaited<ReturnType<OfflineProjectAgentHost["dispatch"]>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const record = requireSubscription(subscriptionId);
      const state = record.host.getSnapshot(record.binding);
      try {
        return await dispatch(subscriptionId, build(state));
      } catch (error) {
        lastError = error;
        if ((error as { code?: unknown })?.code !== "revision_conflict") throw error;
      }
    }
    throw lastError ?? new ProjectAgentSubscriptionError("Project Agent mutation could not be committed");
  }

  async function persistApprovedProposal(
    subscriptionId: string,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    decision: AgentChatToolDecision,
  ): Promise<void> {
    if (!decision.ok || decision.silent) return;
    const record = requireSubscription(subscriptionId);
    const occurredAt = now();
    const expiresAt = new Date(new Date(occurredAt).getTime() + 10 * 60_000).toISOString();
    const approvalId =
      decision.proposalId?.trim() || `approval-${digest([execution.turn.executionToken, call.toolCallId])}`;
    const ref = Object.freeze({
      approvalId,
      threadId: execution.turn.threadId,
      turnId: execution.turn.turnId,
      toolCallId: call.toolCallId,
      actionHash: digest({ toolName: call.toolName, args: call.args, target: execution.queueItem.target }),
      target: execution.queueItem.target,
      preconditions: execution.queueItem.preconditions,
      expiresAt,
    });
    const item = Object.freeze({
      itemId: `proposal-${digest([execution.turn.executionToken, call.toolCallId])}`,
      threadId: execution.turn.threadId,
      turnId: execution.turn.turnId,
      kind: "proposal" as const,
      approval: ref,
      status: "proposed" as const,
      retryable: false,
      deviated: false,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    await queueExecutionMutation(subscriptionId, execution, async () => {
      await dispatchFresh(subscriptionId, (current) => ({
        commandId: `proposal-put-${digest([execution.turn.executionToken, call.toolCallId])}`,
        expectedRevision: current.hostRevision,
        binding: record.binding,
        sender: { kind: "internal", senderId: execution.turn.executionToken },
        type: "proposal.put",
        payload: { approval: { ref, lifecycle: "pending" }, item, occurredAt },
      }));
      await dispatchFresh(subscriptionId, (claimed) => ({
        commandId: `proposal-claim-${digest([execution.turn.executionToken, call.toolCallId])}`,
        expectedRevision: claimed.hostRevision,
        binding: record.binding,
        sender: { kind: "internal", senderId: execution.turn.executionToken },
        type: "proposal.transition",
        payload: { approvalId, lifecycle: "claimed", occurredAt: now() },
      }));
    });
    execution.approvedProposalId = approvalId;
  }

  function cleanupExecution(subscriptionId: string, execution: ActiveExecution, keepRequest: boolean): void {
    execution.pending.clear();
    active.get(subscriptionId)?.delete(execution.turn.turnId);
    const record = subscriptions.get(subscriptionId);
    const latest = record?.host.getSnapshot(record.binding);
    const stillQueued = latest?.turns.some((turn) => turn.turnId === execution.turn.turnId && turn.status === "queued");
    if (!keepRequest || !stillQueued) requests.get(subscriptionId)?.delete(execution.turn.turnId);
    complete(subscriptionId, execution.turn.turnId);
  }

  function awaitToolDecision(
    subscriptionId: string,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    signal: AbortSignal,
  ): Promise<AgentChatToolDecision> {
    if (signal.aborted || execution.controller.signal.aborted)
      return Promise.resolve({ ok: false, denied: true, message: "Agent request cancelled" });
    const existing = execution.pending.get(call.toolCallId);
    if (existing) return Promise.reject(new Error("Duplicate pending Project Agent tool call"));
    return new Promise((resolve) => {
      const settle = (decision: AgentChatToolDecision): void => {
        if (execution.pending.get(call.toolCallId)?.resolve !== settleResolve) return;
        execution.pending.delete(call.toolCallId);
        signal.removeEventListener("abort", abort);
        resolve(decision);
      };
      const settleResolve = (decision: AgentChatToolDecision): void => {
        settle(decision);
      };
      const abort = (): void => settle({ ok: false, denied: true, message: "Agent request cancelled" });
      execution.pending.set(call.toolCallId, {
        turnId: execution.turn.turnId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
        resolve: settleResolve,
        signal,
      });
      signal.addEventListener("abort", abort, { once: true });
      publish(subscriptionId, {
        type: "tool-call",
        binding: requireSubscription(subscriptionId).binding,
        turnId: execution.turn.turnId,
        executionToken: execution.turn.executionToken,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
      });
    });
  }

  async function executeTurn(subscriptionId: string, execution: ActiveExecution): Promise<"continue" | "stop"> {
    const record = requireSubscription(subscriptionId);
    const startAt = now();
    const current = record.host.getSnapshot(record.binding);
    const assistantItem = Object.freeze({
      itemId: `assistant-${digest([execution.turn.executionToken, "assistant"])}`,
      threadId: execution.turn.threadId,
      turnId: execution.turn.turnId,
      kind: "assistant" as const,
      text: "",
      textRevision: 0,
      status: "running" as const,
      retryable: false,
      deviated: false,
      createdAt: startAt,
      updatedAt: startAt,
    });
    try {
      await dispatch(subscriptionId, {
        commandId: `turn-start-${execution.turn.executionToken}`,
        expectedRevision: current.hostRevision,
        binding: record.binding,
        sender: { kind: "internal", senderId: execution.turn.executionToken },
        type: "turn.start",
        payload: {
          turnId: execution.turn.turnId,
          queueItemId: execution.queueItem.queueItemId,
          assistantItem,
          occurredAt: startAt,
        },
      });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === "revision_conflict" || code === "running_turn_exists" || code === "queue_order_violation") {
        // The queue entry is still authoritative, but another mutation won
        // between the snapshot and turn.start. Keep its request so the next
        // drain can rebuild the start command from the latest revision.
        cleanupExecution(subscriptionId, execution, true);
        return record.host.getSnapshot(record.binding).hostRevision !== current.hostRevision ? "continue" : "stop";
      }
      if (!execution.controller.signal.aborted)
        publish(subscriptionId, {
          type: "execution-error",
          binding: record.binding,
          turnId: execution.turn.turnId,
          executionToken: execution.turn.executionToken,
          message: error instanceof Error ? error.message : String(error),
        });
      cleanupExecution(subscriptionId, execution, false);
      return "stop";
    }
    const append = (delta: string): void => {
      void queueExecutionMutation(subscriptionId, execution, async () => {
        if (execution.controller.signal.aborted || !delta) return;
        const state = record.host.getSnapshot(record.binding);
        const item = state.items.find(
          (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
        );
        if (!item || item.kind !== "assistant") return;
        try {
          await dispatchFresh(subscriptionId, (state) => ({
            commandId: `assistant-append-${execution.turn.executionToken}-${item.textRevision + 1}-${digest(delta).slice(0, 12)}`,
            expectedRevision: state.hostRevision,
            binding: record.binding,
            sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
            type: "assistant.append",
            payload: {
              turnId: execution.turn.turnId,
              itemId: item.itemId,
              executionToken: execution.turn.executionToken,
              expectedTextRevision: item.textRevision,
              delta,
              occurredAt: now(),
            },
          }));
        } catch (error) {
          if (!execution.controller.signal.aborted && !String((error as { code?: unknown })?.code).includes("stale"))
            throw error;
        }
      });
    };
    try {
      const request = {
        ...execution.request,
        history: { kind: "ephemeral" as const },
        projectId: execution.request.projectId ?? record.binding.projectId,
        canvasProjectId: execution.request.canvasProjectId ?? record.binding.projectId,
        prompt: executionPrompt(record.host.getSnapshot(record.binding), execution.turn.turnId, execution.request),
      };
      const response = await runAgent(request, {
        abortSignal: execution.controller.signal,
        emit: (event) => {
          if (event.type === "content-delta") append(event.delta);
          // The runtime emits tool-call before the await hook. The hook emits
          // the single renderer notification after read-tool auto execution is
          // ruled out, so no duplicate pending card is possible here.
        },
        awaitToolConfirmation: async (call, signal) => {
          if (call.toolName === CANVAS_READ_CAPABILITY.aliases.pi) {
            const read = await canvasReads.get(subscriptionId)?.tryExecute(call, signal);
            if (read) return read;
          }
          const decision = await awaitToolDecision(subscriptionId, execution, call, signal);
          if (decision.ok && !decision.silent) {
            try {
              await persistApprovedProposal(subscriptionId, execution, call, decision);
            } catch {
              return { ok: false, message: "approval_persistence_failed" };
            }
          }
          return decision;
        },
      });
      await execution.publicationTail;
      const finalState = record.host.getSnapshot(record.binding);
      const assistant = finalState.items.find(
        (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
      );
      const status = statusForResponse(response);
      const toolItems = response.toolCalls.map((item) => toolItem(record.binding, execution.turn, item, now()));
      await dispatchFresh(subscriptionId, (state) => ({
        commandId: `async-result-${execution.turn.executionToken}`,
        expectedRevision: state.hostRevision,
        binding: record.binding,
        sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
        type: "async.result",
        payload: {
          asyncToken: execution.turn.executionToken,
          binding: record.binding,
          threadId: execution.turn.threadId,
          turnId: execution.turn.turnId,
          queueItemId: execution.queueItem.queueItemId,
          target: execution.queueItem.target,
          preconditions: execution.queueItem.preconditions,
          expectedRevision: state.hostRevision,
          items: toolItems,
          turnStatus: status,
          ...(execution.approvedProposalId
            ? { proposalApprovalId: execution.approvedProposalId, proposalStatus: status }
            : {}),
          ...(assistant && assistant.kind === "assistant"
            ? {
                assistantFinal: {
                  itemId: assistant.itemId,
                  executionToken: execution.turn.executionToken,
                  expectedTextRevision: assistant.textRevision,
                  text: response.text,
                },
              }
            : {}),
          receivedAt: now(),
        },
      }));
    } catch (error) {
      if (!execution.controller.signal.aborted) {
        publish(subscriptionId, {
          type: "execution-error",
          binding: record.binding,
          turnId: execution.turn.turnId,
          executionToken: execution.turn.executionToken,
          message: error instanceof Error ? error.message : String(error),
        });
        // A model/runtime failure must not leave a running turn stranded in
        // the queue. Publish the terminal state through the same Host path as
        // every other mutation, after already queued assistant deltas settle.
        try {
          await execution.publicationTail;
          await dispatchFresh(subscriptionId, (state) => ({
            commandId: `execution-failed-${execution.turn.executionToken}`,
            expectedRevision: state.hostRevision,
            binding: record.binding,
            sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
            type: "turn.transition",
            payload: {
              turnId: execution.turn.turnId,
              status: "failed" as const,
              retryable: true,
              updatedAt: now(),
            },
          }));
        } catch (terminalError) {
          // Preserve the original runtime error notification. A concurrent
          // stop or terminal commit may have won the race already.
        }
      }
      try {
        await execution.publicationTail;
      } catch {
        /* terminal publication is best effort after cancellation */
      }
    } finally {
      cleanupExecution(subscriptionId, execution, false);
    }
    return "continue";
  }

  function scheduleDrain(subscriptionId: string): void {
    if (!subscriptions.has(subscriptionId) || drains.has(subscriptionId)) return;
    const tail = Promise.resolve()
      .then(async () => {
        while (true) {
          const record = subscriptions.get(subscriptionId);
          if (!record) return;
          if (active.get(subscriptionId)?.size) return;
          const state = record.host.getSnapshot(record.binding);
          const head = state.queue.find((item) => ["queued", "proposed", "running"].includes(item.status));
          if (!head || head.status !== "queued") return;
          const request = requests.get(subscriptionId)?.get(head.turnId);
          if (!request) return;
          const turn = state.turns.find((candidate) => candidate.turnId === head.turnId);
          if (!turn) return;
          const execution: ActiveExecution = {
            turn,
            queueItem: head,
            request,
            controller: new AbortController(),
            pending: new Map(),
            publicationTail: Promise.resolve(),
          };
          active.get(subscriptionId)?.set(turn.turnId, execution);
          if ((await executeTurn(subscriptionId, execution)) === "stop") return;
        }
      })
      .finally(() => {
        drains.delete(subscriptionId);
      });
    drains.set(subscriptionId, tail);
  }

  function subscribe(subscriptionId: string, listener: ProjectAgentExecutionListener): () => void {
    requireSubscription(subscriptionId);
    const set = listeners.get(subscriptionId)!;
    set.add(listener);
    // A renderer can be remounted while an approval is pending. Replay the
    // pending call to the new subscriber so a surface switch cannot strand
    // the decision card in an unmounted panel.
    for (const execution of active.get(subscriptionId)?.values() ?? []) {
      for (const pending of execution.pending.values()) {
        try {
          listener({
            type: "tool-call",
            binding: requireSubscription(subscriptionId).binding,
            turnId: pending.turnId,
            executionToken: execution.turn.executionToken,
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            args: pending.args,
          });
        } catch {
          // A renderer observer cannot stop execution.
        }
      }
    }
    return () => set.delete(listener);
  }

  async function resolveToolDecision(
    subscriptionId: string,
    turnId: string,
    toolCallId: string,
    decision: AgentChatToolDecision,
  ): Promise<void> {
    const execution = active.get(subscriptionId)?.get(turnId);
    const pending = execution?.pending.get(toolCallId);
    if (!execution || !pending) throw new ProjectAgentSubscriptionError("Project Agent tool decision is unavailable");
    pending.resolve(decision);
  }

  return Object.freeze({
    open,
    snapshot,
    dispatch,
    enqueue,
    subscribe,
    resolveToolDecision,
    waitForTurn: completionFor,
    release: (subscriptionId: string) => {
      for (const execution of active.get(subscriptionId)?.values() ?? []) execution.controller.abort();
      subscriptions.delete(subscriptionId);
      listeners.delete(subscriptionId);
      canvasReads.get(subscriptionId)?.dispose();
      canvasReads.delete(subscriptionId);
      requests.delete(subscriptionId);
      active.delete(subscriptionId);
      completions.delete(subscriptionId);
      drains.delete(subscriptionId);
    },
    subscriptionCount: () => subscriptions.size,
  });
}
