import crypto from "node:crypto";
import type { AgentChatRequest, AgentChatResponse, AgentChatToolDecision } from "../harness/agentChatContracts";
import type { AgentChatV2Hooks } from "../ai/agentChatV2";
import { captureAgentChatRequest } from "../harness/agentChatPolicy";
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectAgentHostState,
  ProjectAgentTurn,
  ProjectAgentQueueItem,
  ProjectAgentPatch,
  ProjectBinding,
  ProjectAgentFailureItem,
  ProjectAgentStatus,
  ProjectAgentAssistantTextAnchor,
  ProjectAgentExecutionEventPayload,
  ProposalApprovalRef,
} from "../shared/projectAgentContracts";
import { projectAgentPartitionKey, sameProjectAgentBinding } from "./projectAgentIdentity";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter, PreparedDocumentWrite } from "../capabilityCore/documentWriteTransportAdapters";
import type {
  PiCanvasWriteTransportAdapter,
  PreparedCanvasWrite,
} from "../capabilityCore/canvasWriteTransportAdapters";
import type {
  PiTimelineReadTransportAdapter,
  PiTimelineWriteTransportAdapter,
  PreparedTimelineWrite,
} from "../capabilityCore/timelineTransportAdapters";
import type {
  PiPhase4SurfaceTransportAdapter,
  PreparedExportWrite,
} from "../capabilityCore/phase4SurfaceTransportAdapters";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";
import { DOCUMENT_READ_CAPABILITY } from "../shared/agentCapabilities/documentRead";
import { CANVAS_DELETE_CAPABILITY } from "../shared/agentCapabilities/canvasDelete";
import { CANVAS_WRITE_CAPABILITY } from "../shared/agentCapabilities/canvasWrite";
import { TIMELINE_READ_CAPABILITY } from "../shared/agentCapabilities/timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "../shared/agentCapabilities/timelineWrite";
import { ASSET_READ_CAPABILITY } from "../shared/agentCapabilities/assetRead";
import { EXPORT_READ_CAPABILITY, EXPORT_WRITE_CAPABILITY } from "../shared/agentCapabilities/exportCapabilities";
import type { ProjectAgentProposalReceiptView } from "../shared/projectAgentProposalReceipt";
import { committedProjectAgentReceiptMatchesApproval } from "./projectAgentProposalReceiptCorrelation";
import { digest, executionPrompt, stableJson, statusForResponse, toolItem } from "./projectAgentExecutionHelpers";

export type ProjectAgentSubscription = Readonly<{
  subscriptionId: string;
  subscriptionEpoch: number;
  binding: ProjectBinding;
  snapshot: ProjectAgentHostState;
}>;

export type ProjectAgentProposalReceiptReader = () => ProjectAgentProposalReceiptView | null;

export type ProjectAgentExecutionOpenOptions = Readonly<{
  canvasRead?: PiCanvasReadTransportAdapter;
  documentRead?: PiDocumentReadTransportAdapter;
  documentWrite?: PiDocumentWriteTransportAdapter;
  canvasWrite?: PiCanvasWriteTransportAdapter;
  timelineRead?: PiTimelineReadTransportAdapter;
  timelineWrite?: PiTimelineWriteTransportAdapter;
  phase4Surface?: PiPhase4SurfaceTransportAdapter;
  proposalReceipt?: ProjectAgentProposalReceiptReader;
}>;

export type ProjectAgentExecutionCoordinatorDeps = Readonly<{
  runAgent?: (request: AgentChatRequest, hooks: AgentChatV2Hooks) => Promise<AgentChatResponse>;
  now?: () => string;
  reportInternalError?: (
    error: unknown,
    context: Readonly<{ phase: "start" | "terminalize-runtime-failure"; turnId: string; message: string }>,
  ) => void;
}>;

function readProposalReceiptSafely(
  reader: ProjectAgentProposalReceiptReader | undefined,
): ProjectAgentProposalReceiptView | null {
  try {
    return reader?.() ?? null;
  } catch {
    return null;
  }
}

type ProjectAgentExecutionEnqueue = Readonly<{
  mutation: Extract<ProjectAgentMutation, { type: "turn.enqueue" }>;
  request: AgentChatRequest;
  canvasRead?: PiCanvasReadTransportAdapter;
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
  assistantTextAnchor?: ProjectAgentAssistantTextAnchor;
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
  approvedProposalIds?: string[];
  proposalSettlementStatuses?: Map<string, ProjectAgentStatus>;
  capabilityOutcome?: CanvasWriteCapabilityOutcome;
  blockedCanvasWriteDecision?: AgentChatToolDecision;
  canvasRead?: PiCanvasReadTransportAdapter;
};

function recordProposalSettlement(
  execution: ActiveExecution,
  approvalId: string,
  status: ProjectAgentStatus,
): void {
  execution.proposalSettlementStatuses ??= new Map();
  execution.proposalSettlementStatuses.set(approvalId, status);
}

function proposalSettlementsFor(
  execution: ActiveExecution,
  fallbackStatus: ProjectAgentStatus,
): readonly Readonly<{ approvalId: string; status: ProjectAgentStatus }>[] {
  return (execution.approvedProposalIds ?? []).map((approvalId) => Object.freeze({
    approvalId,
    status: execution.proposalSettlementStatuses?.get(approvalId) ?? fallbackStatus,
  }));
}

const CANVAS_WRITE_OUTCOMES = Object.freeze({
  capability_declined: {
    status: "declined",
    retryable: false,
    nextAction: "edit the request or submit a new proposal",
  },
  capability_cancelled: {
    status: "stopped",
    retryable: true,
    nextAction: "submit the request again when ready",
  },
  capability_timeout: {
    status: "failed",
    retryable: true,
    nextAction: "retry the capability request",
  },
  capability_unsupported: {
    status: "failed",
    retryable: false,
    nextAction: "use a capability supported by this surface",
  },
  capability_target_stale: {
    status: "failed",
    retryable: true,
    nextAction: "review the current canvas and submit a new proposal",
  },
  capability_surface_unavailable: {
    status: "failed",
    retryable: true,
    nextAction: "reopen the canvas and retry",
  },
  capability_receipt_unresolved: {
    status: "failed",
    retryable: false,
    nextAction: "review the canvas and submit a new proposal; do not retry automatically",
  },
} as const);

type CanvasWriteCapabilityOutcomeCode = keyof typeof CANVAS_WRITE_OUTCOMES;

type CanvasWriteCapabilityOutcome = Readonly<{
  toolCallId: string;
  code: CanvasWriteCapabilityOutcomeCode;
  message: string;
  nextAction: string;
  status: ProjectAgentStatus;
  retryable: boolean;
}>;

function normalizeCanvasWriteOutcomeCode(
  code: string | undefined,
  fallback: CanvasWriteCapabilityOutcomeCode,
): CanvasWriteCapabilityOutcomeCode {
  if (code && Object.hasOwn(CANVAS_WRITE_OUTCOMES, code)) return code as CanvasWriteCapabilityOutcomeCode;
  if (["surface_port_suspended", "surface_port_unavailable", "surface_port_stale", "surface_owner_mismatch"].includes(code ?? "")) {
    return "capability_surface_unavailable";
  }
  if (["capability_policy_stale", "project_binding_stale", "project_scope_changed"].includes(code ?? "")) {
    return "capability_target_stale";
  }
  return fallback;
}

function rememberCanvasWriteOutcome(
  execution: ActiveExecution,
  toolCallId: string,
  code: string | undefined,
  fallback: CanvasWriteCapabilityOutcomeCode,
  denied = false,
): Extract<AgentChatToolDecision, { ok: false }> {
  const canonicalCode = normalizeCanvasWriteOutcomeCode(code, fallback);
  const definition = CANVAS_WRITE_OUTCOMES[canonicalCode];
  execution.capabilityOutcome ??= Object.freeze({
    toolCallId,
    code: canonicalCode,
    message: canonicalCode,
    nextAction: definition.nextAction,
    status: definition.status,
    retryable: definition.retryable,
  });
  return {
    ok: false,
    code: canonicalCode,
    message: canonicalCode,
    ...(denied ? { denied: true } : {}),
  };
}

type FrozenExecutionRequest = Readonly<{
  request: AgentChatRequest;
  requestDigest: string;
  preferredSubscriptionId: string;
  canvasRead?: PiCanvasReadTransportAdapter;
}>;

type SubscriptionDelivery = {
  phase: "pre-live" | "activating" | "live";
  listeners: Set<ProjectAgentExecutionListener>;
  buffered: ProjectAgentExecutionEvent[];
};

type ExecutionPartition = {
  partitionKey: string;
  binding: ProjectBinding;
  host: OfflineProjectAgentHost;
  subscriptionIds: Set<string>;
  requests: Map<string, FrozenExecutionRequest>;
  active: Map<string, ActiveExecution>;
  completions: Map<string, Deferred<ProjectAgentHostState>>;
  initialization: Promise<void>;
  drain?: Promise<void>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

export type ProjectAgentExecutionCoordinator = Readonly<{
  open: (
    binding: ProjectBinding,
    options?: ProjectAgentExecutionOpenOptions,
  ) => Promise<ProjectAgentSubscription>;
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

type SubscriptionRecord = ProjectAgentSubscription & Readonly<{ partitionKey: string }>;

export function createProjectAgentExecutionCoordinator(
  router: ProjectAgentRepositoryRouter,
  randomId: () => string = () => crypto.randomUUID(),
  deps: ProjectAgentExecutionCoordinatorDeps = {},
): ProjectAgentExecutionCoordinator {
  const subscriptions = new Map<string, SubscriptionRecord>();
  const issuedSubscriptionIds = new Set<string>();
  const partitions = new Map<string, ExecutionPartition>();
  const partitionEpochs = new Map<string, number>();
  const deliveries = new Map<string, SubscriptionDelivery>();
  const canvasReads = new Map<string, PiCanvasReadTransportAdapter | undefined>();
  const documentReads = new Map<string, PiDocumentReadTransportAdapter | undefined>();
  const documentWrites = new Map<string, PiDocumentWriteTransportAdapter | undefined>();
  const canvasWrites = new Map<string, PiCanvasWriteTransportAdapter | undefined>();
  const timelineReads = new Map<string, PiTimelineReadTransportAdapter | undefined>();
  const timelineWrites = new Map<string, PiTimelineWriteTransportAdapter | undefined>();
  const phase4Surfaces = new Map<string, PiPhase4SurfaceTransportAdapter | undefined>();
  const proposalReceiptReaders = new Map<string, ProjectAgentProposalReceiptReader | undefined>();
  const runAgent =
    deps.runAgent ?? (async (request, hooks) => (await import("../ai/agentChatV2")).runAgentChatV2(request, hooks));
  const now = deps.now ?? (() => new Date().toISOString());
  const reportInternalError =
    deps.reportInternalError ??
    ((error: unknown, context: Readonly<{ phase: string; turnId: string; message: string }>) => {
      console.error(`[nomi:project-agent] ${context.phase} failed for ${context.turnId}: ${context.message}`, error);
    });

  function publish(partition: ExecutionPartition, event: ProjectAgentExecutionEventPayload): void {
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) continue;
      const notification = Object.freeze({
        ...event,
        subscriptionId,
        subscriptionEpoch: subscription.subscriptionEpoch,
      }) as ProjectAgentExecutionEvent;
      const delivery = deliveries.get(subscriptionId);
      if (!delivery) continue;
      if (delivery.phase !== "live") {
        delivery.buffered.push(notification);
        continue;
      }
      for (const listener of delivery.listeners) {
        try {
          listener(notification);
        } catch {
          /* A renderer observer cannot stop execution. */
        }
      }
    }
  }

  function publishPatch(partition: ExecutionPartition, patch: ProjectAgentPatch): void {
    publish(partition, { type: "patch", patch });
  }

  function complete(partition: ExecutionPartition, turnId: string): void {
    const pending = partition.completions.get(turnId);
    if (!pending) return;
    const state = partition.host.getSnapshot(partition.binding);
    const turn = state.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn || ["queued", "running", "proposed"].includes(turn.status)) return;
    pending.resolve(state);
    partition.completions.delete(turnId);
  }

  function completionForPartition(partition: ExecutionPartition, turnId: string): Promise<ProjectAgentHostState> {
    const existing = partition.completions.get(turnId);
    if (existing) return existing.promise;
    const current = partition.host.getSnapshot(partition.binding);
    const turn = current.turns.find((candidate) => candidate.turnId === turnId);
    if (turn && !["queued", "running", "proposed"].includes(turn.status)) return Promise.resolve(current);
    const entry = deferred<ProjectAgentHostState>();
    partition.completions.set(turnId, entry);
    return entry.promise;
  }

  function completionFor(subscriptionId: string, turnId: string): Promise<ProjectAgentHostState> {
    return completionForPartition(requirePartition(requireSubscription(subscriptionId)), turnId);
  }

  async function recoverClaimedCanvasExecution(
    partition: ExecutionPartition,
    state: ProjectAgentHostState,
    turn: ProjectAgentTurn,
    readProposalReceipt: ProjectAgentProposalReceiptReader | undefined,
  ): Promise<boolean> {
    const approvals = state.proposalApprovals.filter(
      (candidate) => candidate.lifecycle === "claimed"
        && candidate.ref.turnId === turn.turnId
        && candidate.ref.target.kind === "canvas",
    );
    if (approvals.length === 0) return false;
    const queueItem = state.queue.find((candidate) => candidate.turnId === turn.turnId);
    const assistant = state.items.find(
      (candidate) => candidate.kind === "assistant" && candidate.turnId === turn.turnId && candidate.status === "running",
    );
    if (!queueItem || !assistant || assistant.kind !== "assistant") return false;
    const receipt = readProposalReceiptSafely(readProposalReceipt);
    const matchingApprovals = approvals.filter((approval) =>
      committedProjectAgentReceiptMatchesApproval(partition.binding, receipt, approval.ref));
    const latestApproval = approvals.at(-1)!;
    const matchedApprovalIndex = matchingApprovals.length === 1
      ? approvals.findIndex((approval) => approval.ref.approvalId === matchingApprovals[0].ref.approvalId)
      : -1;
    const matched = matchedApprovalIndex === approvals.length - 1;
    const recoveredAt = now();
    const failure: ProjectAgentFailureItem | undefined = matched
      ? undefined
      : Object.freeze({
          itemId: `failure-${digest([partition.binding, turn.executionToken, "capability_receipt_unresolved"])}`,
          threadId: turn.threadId,
          turnId: turn.turnId,
          correlationId: latestApproval.ref.toolCallId,
          kind: "failure" as const,
          code: "capability_receipt_unresolved",
          message: "capability_receipt_unresolved",
          nextAction: CANVAS_WRITE_OUTCOMES.capability_receipt_unresolved.nextAction,
          status: "failed" as const,
          retryable: false,
          deviated: false,
          createdAt: recoveredAt,
          updatedAt: recoveredAt,
        });
    await partition.host.dispatch({
      commandId: `canvas-receipt-recover-${turn.executionToken}`,
      expectedRevision: state.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: "execution-recovery" },
      type: "async.result",
      payload: {
        asyncToken: turn.executionToken,
        binding: partition.binding,
        threadId: turn.threadId,
        turnId: turn.turnId,
        queueItemId: queueItem.queueItemId,
        target: queueItem.target,
        preconditions: queueItem.preconditions,
        expectedRevision: state.hostRevision,
        items: failure ? [failure] : [],
        turnStatus: matched ? "done" : "failed",
        retryable: false,
        proposalSettlements: approvals.map((approval, index) => ({
          approvalId: approval.ref.approvalId,
          status: index <= matchedApprovalIndex ? "done" : "failed",
        })),
        assistantFinal: {
          itemId: assistant.itemId,
          executionToken: turn.executionToken,
          expectedTextRevision: assistant.textRevision,
          text: assistant.text,
        },
        receivedAt: recoveredAt,
      },
    });
    return true;
  }

  async function recoverOrphanedExecutions(
    partition: ExecutionPartition,
    readProposalReceipt: ProjectAgentProposalReceiptReader | undefined,
  ): Promise<void> {
    while (true) {
      const state = partition.host.getSnapshot(partition.binding);
      const turn = state.turns.find((candidate) => ["queued", "running", "proposed"].includes(candidate.status));
      if (!turn) return;
      if (await recoverClaimedCanvasExecution(partition, state, turn, readProposalReceipt)) continue;
      const recoveredAt = now();
      await partition.host.dispatch({
        commandId: `execution-recover-${turn.executionToken}`,
        expectedRevision: state.hostRevision,
        binding: partition.binding,
        sender: { kind: "internal", senderId: "execution-recovery" },
        type: "execution.recover",
        payload: {
          turnId: turn.turnId,
          failure: Object.freeze({
            itemId: `failure-${digest([partition.binding, turn.executionToken, "process-restart"])}`,
            threadId: turn.threadId,
            turnId: turn.turnId,
            kind: "failure" as const,
            code: "execution_recovery_required",
            message: "The previous Agent process ended before this turn completed.",
            status: "failed" as const,
            retryable: true,
            deviated: false,
            createdAt: recoveredAt,
            updatedAt: recoveredAt,
          }),
          recoveredAt,
        },
      });
    }
  }

  async function open(
    binding: ProjectBinding,
    options: ProjectAgentExecutionOpenOptions = {},
  ): Promise<ProjectAgentSubscription> {
    const partitionKey = projectAgentPartitionKey(binding);
    let partition = partitions.get(partitionKey);
    if (!partition) {
      partition = {
        partitionKey,
        binding: Object.freeze({ ...binding }),
        host: router.attach(binding),
        subscriptionIds: new Set(),
        requests: new Map(),
        active: new Map(),
        completions: new Map(),
        initialization: Promise.resolve(),
      };
      partitions.set(partitionKey, partition);
      partition.initialization = recoverOrphanedExecutions(partition, options.proposalReceipt);
    } else if (!sameProjectAgentBinding(binding, partition.binding)) {
      throw new ProjectAgentSubscriptionError("Project Agent partition binding mismatch");
    }
    await partition.initialization;
    const subscriptionEpoch = (partitionEpochs.get(partitionKey) ?? 0) + 1;
    partitionEpochs.set(partitionKey, subscriptionEpoch);
    const subscription: SubscriptionRecord = Object.freeze({
      subscriptionId: randomId(),
      subscriptionEpoch,
      partitionKey,
      binding: partition.binding,
      snapshot: partition.host.getSnapshot(partition.binding),
    });
    if (issuedSubscriptionIds.has(subscription.subscriptionId)) {
      throw new ProjectAgentSubscriptionError("Project Agent subscription id collision");
    }
    issuedSubscriptionIds.add(subscription.subscriptionId);
    subscriptions.set(subscription.subscriptionId, subscription);
    partition.subscriptionIds.add(subscription.subscriptionId);
    deliveries.set(subscription.subscriptionId, {
      phase: "pre-live",
      listeners: new Set(),
      buffered: [],
    });
    canvasReads.set(subscription.subscriptionId, options.canvasRead);
    documentReads.set(subscription.subscriptionId, options.documentRead);
    documentWrites.set(subscription.subscriptionId, options.documentWrite);
    canvasWrites.set(subscription.subscriptionId, options.canvasWrite);
    timelineReads.set(subscription.subscriptionId, options.timelineRead);
    timelineWrites.set(subscription.subscriptionId, options.timelineWrite);
    phase4Surfaces.set(subscription.subscriptionId, options.phase4Surface);
    proposalReceiptReaders.set(subscription.subscriptionId, options.proposalReceipt);
    return subscription;
  }

  function requireSubscription(subscriptionId: string): SubscriptionRecord {
    const record = subscriptions.get(subscriptionId);
    if (!record) throw new ProjectAgentSubscriptionError("Project Agent subscription is unavailable");
    return record;
  }

  function requirePartition(record: SubscriptionRecord): ExecutionPartition {
    const partition = partitions.get(record.partitionKey);
    if (!partition || !sameProjectAgentBinding(partition.binding, record.binding)) {
      throw new ProjectAgentSubscriptionError("Project Agent execution partition is unavailable");
    }
    return partition;
  }

  function dispatchPartition(partition: ExecutionPartition, mutation: ProjectAgentMutation) {
    if (!sameProjectAgentBinding(mutation.binding, partition.binding)) {
      throw new ProjectAgentSubscriptionError("Project Agent subscription binding mismatch");
    }
    return partition.host.dispatch(mutation).then((reduction) => {
      // Abort only after the stop transition commits. A stale or malformed
      // stop command must not cancel an execution that remains running.
      if (mutation.type === "turn.transition" && mutation.payload.status === "stopped") {
        const active = partition.active.get(mutation.payload.turnId);
        if (active) {
          active.controller.abort();
        } else {
          const reserved = partition.requests.get(mutation.payload.turnId);
          partition.requests.delete(mutation.payload.turnId);
          reserved?.canvasRead?.dispose();
        }
      }
      if (reduction.patch && !reduction.replayed) publishPatch(partition, reduction.patch);
      const terminalTurnId =
        mutation.type === "turn.transition" || mutation.type === "execution.recover" ? mutation.payload.turnId : "";
      complete(partition, terminalTurnId);
      scheduleDrain(partition);
      return reduction;
    });
  }

  function dispatch(subscriptionId: string, mutation: ProjectAgentMutation) {
    const record = requireSubscription(subscriptionId);
    return dispatchPartition(requirePartition(record), mutation);
  }

  function snapshot(subscriptionId: string): ProjectAgentHostState {
    const record = requireSubscription(subscriptionId);
    const partition = requirePartition(record);
    return partition.host.getSnapshot(partition.binding);
  }

  async function enqueue(subscriptionId: string, input: ProjectAgentExecutionEnqueue) {
    const record = requireSubscription(subscriptionId);
    const partition = requirePartition(record);
    for (const claimedProjectId of [input.request.projectId, input.request.canvasProjectId]) {
      if (claimedProjectId !== undefined && claimedProjectId !== record.binding.projectId) {
        throw new ProjectAgentSubscriptionError("Project Agent request project does not match its subscription");
      }
    }
    const target = input.mutation.payload.queueItem.target;
    const request = captureAgentChatRequest({
      ...input.request,
      history: { kind: "ephemeral" },
      projectId: record.binding.projectId,
      ...(target.kind === "canvas"
        ? { canvasProjectId: record.binding.projectId, selectedNodeIds: [...target.nodeIds] }
        : { canvasProjectId: undefined, selectedNodeIds: [] }),
    });
    const requestMap = partition.requests;
    const turnId = input.mutation.payload.turn.turnId;
    const previousRequest = requestMap.get(turnId);
    const requestDigest = digest(request);
    if (previousRequest && previousRequest.requestDigest !== requestDigest) {
      throw new ProjectAgentSubscriptionError("Project Agent turn already reserved a different execution request");
    }
    // Register the ephemeral execution input before dispatch can schedule a
    // drain. Otherwise its first microtask can observe a queued turn without
    // a request and strand the FIFO head permanently.
    const reservation =
      previousRequest ?? Object.freeze({
        request,
        requestDigest,
        preferredSubscriptionId: subscriptionId,
        ...(input.canvasRead ? { canvasRead: input.canvasRead } : {}),
      });
    if (previousRequest && input.canvasRead) input.canvasRead.dispose();
    if (!previousRequest) requestMap.set(turnId, reservation);
    try {
      const reduction = await dispatchPartition(partition, input.mutation);
      if (!reduction.replayed) {
        completionForPartition(partition, turnId);
        scheduleDrain(partition);
      } else if (!previousRequest && requestMap.get(turnId) === reservation) {
        requestMap.delete(turnId);
        reservation.canvasRead?.dispose();
      }
      return reduction;
    } catch (error) {
      if (!previousRequest && requestMap.get(turnId) === reservation) requestMap.delete(turnId);
      throw error;
    }
  }

  function queueExecutionMutation(execution: ActiveExecution, work: () => Promise<void>): Promise<void> {
    const next = execution.publicationTail.then(work, work);
    execution.publicationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function dispatchFresh(
    partition: ExecutionPartition,
    build: (state: ProjectAgentHostState) => ProjectAgentMutation,
  ): Promise<Awaited<ReturnType<OfflineProjectAgentHost["dispatch"]>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = partition.host.getSnapshot(partition.binding);
      try {
        return await dispatchPartition(partition, build(state));
      } catch (error) {
        lastError = error;
        if ((error as { code?: unknown })?.code !== "revision_conflict") throw error;
      }
    }
    throw lastError ?? new ProjectAgentSubscriptionError("Project Agent mutation could not be committed");
  }

  async function persistApprovedProposal(
    partition: ExecutionPartition,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    decision: AgentChatToolDecision,
    verified?: Readonly<{
      approvalId: string;
      receiptProposalId: string;
      target: ProjectAgentQueueItem["target"];
      preconditions: ProjectAgentQueueItem["preconditions"];
      policyRevision: number;
      inputHash: string;
      actionHash: string;
    }>,
  ): Promise<ProposalApprovalRef | undefined> {
    if (!decision.ok || decision.silent) return;
    const occurredAt = now();
    const expiresAt = new Date(new Date(occurredAt).getTime() + 10 * 60_000).toISOString();
    const approvalId = verified?.approvalId
      ?? decision.proposalId?.trim()
      ?? `approval-${digest([execution.turn.executionToken, call.toolCallId])}`;
    const target = verified?.target ?? execution.queueItem.target;
    const preconditions = verified?.preconditions ?? execution.queueItem.preconditions;
    const fallbackActionHash = digest({
      toolName: call.toolName,
      args: call.args,
      target,
      preconditions,
    });
    const ref = Object.freeze({
      approvalId,
      receiptProposalId: verified?.receiptProposalId ?? approvalId,
      threadId: execution.turn.threadId,
      turnId: execution.turn.turnId,
      toolCallId: call.toolCallId,
      policyRevision: verified?.policyRevision ?? execution.queueItem.policyRevision,
      inputHash: verified?.inputHash ?? digest({ toolName: call.toolName, args: call.args }),
      actionHash: verified?.actionHash ?? fallbackActionHash,
      target,
      preconditions,
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
    await queueExecutionMutation(execution, async () => {
      await dispatchFresh(partition, (current) => ({
        commandId: `proposal-put-${digest([execution.turn.executionToken, call.toolCallId])}`,
        expectedRevision: current.hostRevision,
        binding: partition.binding,
        sender: { kind: "internal", senderId: execution.turn.executionToken },
        type: "proposal.put",
        payload: { approval: { ref, lifecycle: "pending" }, item, occurredAt },
      }));
      await dispatchFresh(partition, (claimed) => ({
        commandId: `proposal-claim-${digest([execution.turn.executionToken, call.toolCallId])}`,
        expectedRevision: claimed.hostRevision,
        binding: partition.binding,
        sender: { kind: "internal", senderId: execution.turn.executionToken },
        type: "proposal.transition",
        payload: { approvalId, lifecycle: "claimed", occurredAt: now() },
      }));
    });
    const persisted = partition.host
      .getSnapshot(partition.binding)
      .proposalApprovals.find((approval) => approval.ref.approvalId === approvalId);
    if (!persisted || persisted.lifecycle !== "claimed" || stableJson(persisted.ref) !== stableJson(ref)) {
      throw new Error("approval_persistence_failed");
    }
    execution.approvedProposalIds ??= [];
    execution.approvedProposalIds.push(approvalId);
    return persisted.ref;
  }

  function cleanupExecution(partition: ExecutionPartition, execution: ActiveExecution, keepRequest: boolean): void {
    execution.pending.clear();
    partition.active.delete(execution.turn.turnId);
    const latest = partition.host.getSnapshot(partition.binding);
    const stillQueued = latest?.turns.some((turn) => turn.turnId === execution.turn.turnId && turn.status === "queued");
    if (!keepRequest || !stillQueued) {
      partition.requests.delete(execution.turn.turnId);
      execution.canvasRead?.dispose();
    }
    complete(partition, execution.turn.turnId);
  }

  async function awaitToolDecision(
    partition: ExecutionPartition,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    signal: AbortSignal,
  ): Promise<AgentChatToolDecision> {
    if (signal.aborted || execution.controller.signal.aborted)
      return Promise.resolve({ ok: false, denied: true, message: "Agent request cancelled" });
    await execution.publicationTail;
    if (signal.aborted || execution.controller.signal.aborted)
      return { ok: false, denied: true, message: "Agent request cancelled" };
    const existing = execution.pending.get(call.toolCallId);
    if (existing) return Promise.reject(new Error("Duplicate pending Project Agent tool call"));
    const assistant = partition.host
      .getSnapshot(partition.binding)
      .items.find((item) => item.kind === "assistant" && item.turnId === execution.turn.turnId);
    const assistantTextAnchor =
      assistant?.kind === "assistant"
        ? Object.freeze({ itemId: assistant.itemId, textOffset: assistant.text.length })
        : undefined;
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
        ...(assistantTextAnchor ? { assistantTextAnchor } : {}),
        resolve: settleResolve,
        signal,
      });
      signal.addEventListener("abort", abort, { once: true });
      publish(partition, {
        type: "tool-call",
        binding: partition.binding,
        turnId: execution.turn.turnId,
        executionToken: execution.turn.executionToken,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
        ...(assistantTextAnchor ? { assistantTextAnchor } : {}),
      });
    });
  }

  function canvasReadFor(
    partition: ExecutionPartition,
    preferredSubscriptionId: string,
    turnCanvasRead?: PiCanvasReadTransportAdapter,
  ) {
    if (turnCanvasRead) return turnCanvasRead;
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? canvasReads.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiCanvasReadTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = canvasReads.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function documentReadFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? documentReads.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiDocumentReadTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = documentReads.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function documentWriteFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? documentWrites.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiDocumentWriteTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = documentWrites.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function canvasWriteFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? canvasWrites.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiCanvasWriteTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = canvasWrites.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function timelineReadFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? timelineReads.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiTimelineReadTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = timelineReads.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function timelineWriteFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? timelineWrites.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiTimelineWriteTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = timelineWrites.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function phase4SurfaceFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? phase4Surfaces.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: PiPhase4SurfaceTransportAdapter | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const adapter = phase4Surfaces.get(subscriptionId);
      if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
        selected = adapter;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  function proposalReceiptReaderFor(partition: ExecutionPartition, preferredSubscriptionId: string) {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? proposalReceiptReaders.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: ProjectAgentProposalReceiptReader | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const reader = proposalReceiptReaders.get(subscriptionId);
      if (subscription && reader && subscription.subscriptionEpoch > selectedEpoch) {
        selected = reader;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  }

  async function executeTurn(partition: ExecutionPartition, execution: ActiveExecution): Promise<"continue" | "stop"> {
    const startAt = now();
    const current = partition.host.getSnapshot(partition.binding);
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
      await dispatchPartition(partition, {
        commandId: `turn-start-${execution.turn.executionToken}`,
        expectedRevision: current.hostRevision,
        binding: partition.binding,
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
        cleanupExecution(partition, execution, true);
        return partition.host.getSnapshot(partition.binding).hostRevision !== current.hostRevision ? "continue" : "stop";
      }
      if (!execution.controller.signal.aborted) {
        reportInternalError(error, {
          phase: "start",
          turnId: execution.turn.turnId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      cleanupExecution(partition, execution, false);
      return "stop";
    }
    const append = (delta: string): void => {
      void queueExecutionMutation(execution, async () => {
        if (execution.controller.signal.aborted || !delta) return;
        const state = partition.host.getSnapshot(partition.binding);
        const item = state.items.find(
          (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
        );
        if (!item || item.kind !== "assistant") return;
        try {
          await dispatchFresh(partition, (state) => ({
            commandId: `assistant-append-${execution.turn.executionToken}-${item.textRevision + 1}-${digest(delta).slice(0, 12)}`,
            expectedRevision: state.hostRevision,
            binding: partition.binding,
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
        projectId: execution.request.projectId ?? partition.binding.projectId,
        canvasProjectId: execution.request.canvasProjectId ?? partition.binding.projectId,
        prompt: executionPrompt(partition.host.getSnapshot(partition.binding), execution.turn.turnId, execution.request),
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
          // Transport adapters own capability-name matching. The coordinator
          // only offers the injected adapter a chance to handle a call, so it
          // cannot become a second tool dispatch/executor owner.
          const frozen = partition.requests.get(execution.turn.turnId);
          const canonicalCapability = resolveCapabilityAlias(call.toolName)?.contract;
          const isCanvasMutation = canonicalCapability?.id === CANVAS_WRITE_CAPABILITY.id
            || canonicalCapability?.id === CANVAS_DELETE_CAPABILITY.id;
          if (isCanvasMutation && execution.blockedCanvasWriteDecision) {
            return execution.blockedCanvasWriteDecision;
          }
          const read = await canvasReadFor(
            partition,
            frozen?.preferredSubscriptionId ?? "",
            execution.canvasRead,
          )?.tryExecute(call, signal);
          if (read) return read;
          const documentId = execution.queueItem.target.kind === "document" ? execution.queueItem.target.documentId : "";
          const documentAdapter = documentReadFor(partition, frozen?.preferredSubscriptionId ?? "");
          const document = await documentAdapter?.tryExecute(call, documentId, signal);
          if (document) return document;
          if (canonicalCapability?.id === DOCUMENT_READ_CAPABILITY.id) {
            return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
          }
          const timelineReadAdapter = timelineReadFor(partition, frozen?.preferredSubscriptionId ?? "");
          const timelineRead = await timelineReadAdapter?.tryExecute(call, signal);
          if (timelineRead) return timelineRead;
          if (canonicalCapability?.id === TIMELINE_READ_CAPABILITY.id) {
            return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
          }
          const phase4Surface = phase4SurfaceFor(partition, frozen?.preferredSubscriptionId ?? "");
          const phase4Read = await phase4Surface?.tryExecuteRead(call, signal);
          if (phase4Read) return phase4Read;
          if (
            canonicalCapability?.id === ASSET_READ_CAPABILITY.id
            || canonicalCapability?.id === EXPORT_READ_CAPABILITY.id
          ) {
            return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
          }
          const canvasWriteAdapter = canvasWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
          if (canvasWriteAdapter) {
            let prepared: PreparedCanvasWrite | null;
            try {
              prepared = await canvasWriteAdapter.prepare(call, signal);
            } catch (error) {
              const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : error instanceof Error ? error.message : "capability_execution_failed";
              return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
            }
            if (prepared) {
              const decision = await awaitToolDecision(partition, execution, call, signal);
              if (!decision.ok) {
                return rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  decision.code,
                  signal.aborted ? "capability_cancelled" : "capability_declined",
                  decision.denied,
                );
              }
              const persisted = await persistApprovedProposal(partition, execution, call, decision, {
                approvalId: `approval-${digest([execution.turn.executionToken, call.toolCallId])}`,
                receiptProposalId: `receipt-${digest([execution.turn.executionToken, call.toolCallId, "receipt"])}`,
                target: prepared.invocation.target,
                preconditions: prepared.invocation.preconditions,
                policyRevision: prepared.invocation.policyRevision,
                inputHash: prepared.invocation.inputHash,
                actionHash: prepared.invocation.actionHash,
              });
              if (!persisted) throw new Error("approval_persistence_failed");
              let executed: AgentChatToolDecision | undefined;
              try {
                executed = await canvasWriteAdapter.execute(prepared, {
                  receiptProposalId: persisted.receiptProposalId,
                  approvalId: persisted.approvalId,
                  actionHash: persisted.actionHash,
                }, signal);
              } catch {
                executed = undefined;
              }
              const receipt = readProposalReceiptSafely(proposalReceiptReaderFor(
                partition,
                frozen?.preferredSubscriptionId ?? "",
              ));
              const receiptMatches = committedProjectAgentReceiptMatchesApproval(
                partition.binding,
                receipt,
                persisted,
              );
              if (receiptMatches && (!executed || !executed.ok)) {
                const recovered = {
                  ok: true,
                  proposalId: persisted.receiptProposalId,
                  silent: true,
                } as const;
                recordProposalSettlement(execution, persisted.approvalId, "done");
                execution.blockedCanvasWriteDecision = recovered;
                return recovered;
              }
              const outputProposalId = executed?.ok && executed.result
                && typeof executed.result === "object"
                && !Array.isArray(executed.result)
                && typeof (executed.result as { proposalId?: unknown }).proposalId === "string"
                ? (executed.result as { proposalId: string }).proposalId
                : undefined;
              if (
                outputProposalId !== persisted.receiptProposalId
                || !receiptMatches
              ) {
                const unresolved = rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  "capability_receipt_unresolved",
                  "capability_receipt_unresolved",
                );
                execution.blockedCanvasWriteDecision = unresolved;
                recordProposalSettlement(execution, persisted.approvalId, "failed");
                return unresolved;
              }
              recordProposalSettlement(execution, persisted.approvalId, "done");
              return executed!;
            }
            if (isCanvasMutation) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                "capability_unsupported",
                "capability_unsupported",
              );
            }
          }
          if (isCanvasMutation) {
            return rememberCanvasWriteOutcome(
              execution,
              call.toolCallId,
              "capability_surface_unavailable",
              "capability_surface_unavailable",
            );
          }
          if (phase4Surface) {
            let prepared: PreparedExportWrite | null;
            try {
              prepared = await phase4Surface.prepareWrite(call, signal);
            } catch (error) {
              const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : error instanceof Error ? error.message : "capability_execution_failed";
              return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
            }
            if (prepared) {
              const decision = await awaitToolDecision(partition, execution, call, signal);
              if (!decision.ok) {
                return rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  decision.code,
                  signal.aborted ? "capability_cancelled" : "capability_declined",
                  decision.denied,
                );
              }
              const persisted = await persistApprovedProposal(partition, execution, call, decision, {
                approvalId: `approval-${digest([execution.turn.executionToken, call.toolCallId])}`,
                receiptProposalId: `receipt-${digest([execution.turn.executionToken, call.toolCallId, "receipt"])}`,
                target: prepared.invocation.target,
                preconditions: prepared.invocation.preconditions,
                policyRevision: prepared.invocation.policyRevision,
                inputHash: prepared.invocation.inputHash,
                actionHash: prepared.invocation.actionHash,
              });
              if (!persisted) throw new Error("approval_persistence_failed");
              const executed = await phase4Surface.executeWrite(prepared, {
                receiptProposalId: persisted.receiptProposalId,
                approvalId: persisted.approvalId,
                actionHash: persisted.actionHash,
              }, signal);
              const receipt = readProposalReceiptSafely(proposalReceiptReaderFor(
                partition,
                frozen?.preferredSubscriptionId ?? "",
              ));
              const receiptMatches = committedProjectAgentReceiptMatchesApproval(
                partition.binding,
                receipt,
                persisted,
              );
              if (!executed.ok || !receiptMatches) {
                recordProposalSettlement(execution, persisted.approvalId, "failed");
                return rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  executed.ok ? "capability_receipt_unresolved" : executed.code,
                  signal.aborted ? "capability_cancelled" : "capability_receipt_unresolved",
                );
              }
              recordProposalSettlement(execution, persisted.approvalId, "done");
              return executed;
            }
          }
          if (canonicalCapability?.id === EXPORT_WRITE_CAPABILITY.id) {
            return rememberCanvasWriteOutcome(
              execution,
              call.toolCallId,
              "capability_surface_unavailable",
              "capability_surface_unavailable",
            );
          }
          const timelineWriteAdapter = timelineWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
          if (timelineWriteAdapter) {
            let prepared: PreparedTimelineWrite | null;
            try {
              prepared = await timelineWriteAdapter.prepare(call, signal);
            } catch (error) {
              const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : error instanceof Error ? error.message : "capability_execution_failed";
              return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
            }
            if (prepared) {
              const decision = await awaitToolDecision(partition, execution, call, signal);
              if (!decision.ok) {
                return rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  decision.code,
                  signal.aborted ? "capability_cancelled" : "capability_declined",
                  decision.denied,
                );
              }
              const persisted = await persistApprovedProposal(partition, execution, call, decision, {
                approvalId: `approval-${digest([execution.turn.executionToken, call.toolCallId])}`,
                receiptProposalId: `receipt-${digest([execution.turn.executionToken, call.toolCallId, "receipt"])}`,
                target: prepared.invocation.target,
                preconditions: prepared.invocation.preconditions,
                policyRevision: prepared.invocation.policyRevision,
                inputHash: prepared.invocation.inputHash,
                actionHash: prepared.invocation.actionHash,
              });
              if (!persisted) throw new Error("approval_persistence_failed");
              const executed = await timelineWriteAdapter.execute(prepared, {
                receiptProposalId: persisted.receiptProposalId,
                approvalId: persisted.approvalId,
                actionHash: persisted.actionHash,
              }, signal);
              recordProposalSettlement(execution, persisted.approvalId, executed.ok ? "done" : "failed");
              if (!executed.ok) {
                return rememberCanvasWriteOutcome(
                  execution,
                  call.toolCallId,
                  executed.code,
                  signal.aborted ? "capability_cancelled" : "capability_target_stale",
                );
              }
              return executed;
            }
          }
          if (canonicalCapability?.id === TIMELINE_WRITE_CAPABILITY.id) {
            return rememberCanvasWriteOutcome(
              execution,
              call.toolCallId,
              "capability_surface_unavailable",
              "capability_surface_unavailable",
            );
          }
          const writeAdapter = documentWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
          if (writeAdapter) {
            const documentId = execution.queueItem.target.kind === "document" ? execution.queueItem.target.documentId : "";
            let prepared: PreparedDocumentWrite | null;
            try {
              prepared = await writeAdapter.prepare(call, {
                documentId,
                target: execution.queueItem.target,
                preconditions: execution.queueItem.preconditions,
              }, signal);
            } catch (error) {
              const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : error instanceof Error ? error.message : "capability_execution_failed";
              return { ok: false, code, message: code };
            }
            if (prepared) {
              const decision = await awaitToolDecision(partition, execution, call, signal);
              if (!decision.ok) return decision;
              try {
                await persistApprovedProposal(partition, execution, call, decision, {
                  approvalId: `approval-${digest([execution.turn.executionToken, call.toolCallId])}`,
                  receiptProposalId: `receipt-${digest([execution.turn.executionToken, call.toolCallId, "receipt"])}`,
                  target: prepared.invocation.target,
                  preconditions: prepared.invocation.preconditions,
                  policyRevision: prepared.invocation.policyRevision,
                  inputHash: prepared.invocation.inputHash,
                  actionHash: prepared.invocation.actionHash,
                });
              } catch {
                return { ok: false, message: "approval_persistence_failed" };
              }
              return writeAdapter.execute(prepared, signal);
            }
          }
          const decision = await awaitToolDecision(partition, execution, call, signal);
          if (decision.ok && !decision.silent) {
            try {
              await persistApprovedProposal(partition, execution, call, decision);
            } catch {
              return { ok: false, message: "approval_persistence_failed" };
            }
          }
          return decision;
        },
      });
      await execution.publicationTail;
      const finalState = partition.host.getSnapshot(partition.binding);
      const assistant = finalState.items.find(
        (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
      );
      const capabilityOutcome = execution.capabilityOutcome;
      const status = capabilityOutcome?.status ?? statusForResponse(response);
      const proposalSettlements = proposalSettlementsFor(execution, status);
      const toolItems = response.toolCalls.map((item) => toolItem(partition.binding, execution.turn, item, now()));
      const receivedAt = now();
      const outcomeFailure: ProjectAgentFailureItem | undefined = capabilityOutcome
        ? Object.freeze({
            itemId: `failure-${digest([execution.turn.executionToken, capabilityOutcome.toolCallId, capabilityOutcome.code])}`,
            threadId: execution.turn.threadId,
            turnId: execution.turn.turnId,
            correlationId: capabilityOutcome.toolCallId,
            kind: "failure" as const,
            code: capabilityOutcome.code,
            message: capabilityOutcome.message,
            nextAction: capabilityOutcome.nextAction,
            status: capabilityOutcome.status,
            retryable: capabilityOutcome.retryable,
            deviated: false,
            createdAt: receivedAt,
            updatedAt: receivedAt,
          })
        : undefined;
      const beforeResult = partition.host.getSnapshot(partition.binding);
      const currentStatus = beforeResult.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
      if (!currentStatus || ["queued", "running", "proposed"].includes(currentStatus)) {
        await dispatchFresh(partition, (state) => ({
          commandId: `async-result-${execution.turn.executionToken}`,
          expectedRevision: state.hostRevision,
          binding: partition.binding,
          sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
          type: "async.result",
          payload: {
            asyncToken: execution.turn.executionToken,
            binding: partition.binding,
            threadId: execution.turn.threadId,
            turnId: execution.turn.turnId,
            queueItemId: execution.queueItem.queueItemId,
            target: execution.queueItem.target,
            preconditions: execution.queueItem.preconditions,
            expectedRevision: state.hostRevision,
            items: outcomeFailure ? [...toolItems, outcomeFailure] : toolItems,
            turnStatus: status,
            ...(capabilityOutcome ? { retryable: capabilityOutcome.retryable } : {}),
            ...(proposalSettlements.length > 0
              ? { proposalSettlements }
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
            receivedAt,
          },
        }));
      }
      const committed = partition.host.getSnapshot(partition.binding);
      const committedStatus = committed.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
      if (!committedStatus || ["queued", "running", "proposed"].includes(committedStatus)) {
        throw new Error("Project Agent execution result has no committed terminal turn");
      }
      publish(partition, {
        type: "execution-result",
        binding: partition.binding,
        turnId: execution.turn.turnId,
        executionToken: execution.turn.executionToken,
        response,
      });
    } catch (error) {
      if (!execution.controller.signal.aborted) {
        const message = error instanceof Error && error.message ? error.message : String(error) || "Agent execution failed";
        // A runtime failure is a canonical transcript fact. Commit both the
        // terminal assistant and a Failure Item before notifying views.
        let terminalError: unknown;
        try {
          await execution.publicationTail;
          const beforeFailure = partition.host.getSnapshot(partition.binding);
          const currentStatus = beforeFailure.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
          const assistant = beforeFailure.items.find(
            (item) => item.kind === "assistant" && item.turnId === execution.turn.turnId,
          );
          if (currentStatus === "running" && assistant?.kind === "assistant") {
            const failedAt = now();
            const proposalSettlements = proposalSettlementsFor(execution, "failed");
            await dispatchFresh(partition, (state) => ({
              commandId: `execution-failed-${execution.turn.executionToken}`,
              expectedRevision: state.hostRevision,
              binding: partition.binding,
              sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
              type: "async.result",
              payload: {
                asyncToken: execution.turn.executionToken,
                binding: partition.binding,
                threadId: execution.turn.threadId,
                turnId: execution.turn.turnId,
                queueItemId: execution.queueItem.queueItemId,
                target: execution.queueItem.target,
                preconditions: execution.queueItem.preconditions,
                expectedRevision: state.hostRevision,
                items: [Object.freeze({
                  itemId: `failure-${digest([execution.turn.executionToken, "runtime-failure"])}`,
                  threadId: execution.turn.threadId,
                  turnId: execution.turn.turnId,
                  kind: "failure" as const,
                  code: "runtime_error",
                  message,
                  status: "failed" as const,
                  retryable: true,
                  deviated: false,
                  createdAt: failedAt,
                  updatedAt: failedAt,
                })],
                turnStatus: "failed" as const,
                ...(proposalSettlements.length > 0
                  ? { proposalSettlements }
                  : {}),
                assistantFinal: {
                  itemId: assistant.itemId,
                  executionToken: execution.turn.executionToken,
                  expectedTextRevision: assistant.textRevision,
                  text: assistant.text,
                },
                receivedAt: failedAt,
              },
            }));
          }
        } catch (failureCommitError) {
          terminalError = failureCommitError;
        }
        const committed = partition.host.getSnapshot(partition.binding);
        const committedStatus = committed.turns.find(
          (turn) => turn.turnId === execution.turn.turnId,
        )?.status;
        if (committedStatus === "failed") {
          publish(partition, {
            type: "execution-error",
            binding: partition.binding,
            turnId: execution.turn.turnId,
            executionToken: execution.turn.executionToken,
            message,
          });
        } else {
          reportInternalError(terminalError ?? error, {
            phase: "terminalize-runtime-failure",
            turnId: execution.turn.turnId,
            message,
          });
        }
      }
      try {
        await execution.publicationTail;
      } catch {
        /* terminal publication is best effort after cancellation */
      }
    } finally {
      cleanupExecution(partition, execution, false);
    }
    return "continue";
  }

  function scheduleDrain(partition: ExecutionPartition): void {
    if (partition.drain) return;
    const tail = Promise.resolve()
      .then(async () => {
        while (true) {
          if (partition.active.size) return;
          const state = partition.host.getSnapshot(partition.binding);
          const head = state.queue.find((item) => ["queued", "proposed", "running"].includes(item.status));
          if (!head || head.status !== "queued") return;
          const frozenRequest = partition.requests.get(head.turnId);
          if (!frozenRequest) return;
          const turn = state.turns.find((candidate) => candidate.turnId === head.turnId);
          if (!turn) return;
          const execution: ActiveExecution = {
            turn,
            queueItem: head,
            request: frozenRequest.request,
            controller: new AbortController(),
            pending: new Map(),
            publicationTail: Promise.resolve(),
            canvasRead: frozenRequest.canvasRead,
          };
          partition.active.set(turn.turnId, execution);
          if ((await executeTurn(partition, execution)) === "stop") return;
        }
      })
      .finally(() => {
        if (partition.drain === tail) partition.drain = undefined;
      });
    partition.drain = tail;
  }

  function subscribe(subscriptionId: string, listener: ProjectAgentExecutionListener): () => void {
    const subscription = requireSubscription(subscriptionId);
    const partition = requirePartition(subscription);
    const delivery = deliveries.get(subscriptionId)!;
    delivery.listeners.add(listener);

    const pendingNotification = (
      execution: ActiveExecution,
      pending: PendingToolDecision,
    ): ProjectAgentExecutionEvent => ({
      type: "tool-call",
      subscriptionId,
      subscriptionEpoch: subscription.subscriptionEpoch,
      binding: partition.binding,
      turnId: pending.turnId,
      executionToken: execution.turn.executionToken,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      args: pending.args,
      ...(pending.assistantTextAnchor ? { assistantTextAnchor: pending.assistantTextAnchor } : {}),
    });
    const notify = (notification: ProjectAgentExecutionEvent, target = listener): void => {
      try {
        target(notification);
      } catch {
        // A renderer observer cannot stop execution.
      }
    };

    if (delivery.phase === "pre-live") {
      delivery.phase = "activating";
      // A pending tool call may have been published before the first listener
      // attached. Add only calls absent from that ordered pre-live history.
      for (const execution of partition.active.values()) {
        for (const pending of execution.pending.values()) {
          const alreadyBuffered = delivery.buffered.some(
            (event) =>
              event.type === "tool-call" &&
              event.executionToken === execution.turn.executionToken &&
              event.toolCallId === pending.toolCallId,
          );
          if (!alreadyBuffered) delivery.buffered.push(pendingNotification(execution, pending));
        }
      }
      while (delivery.buffered.length > 0) {
        const notification = delivery.buffered.shift()!;
        for (const target of delivery.listeners) notify(notification, target);
      }
      delivery.phase = "live";
    } else if (delivery.phase === "live") {
      // A renderer can be remounted while an approval is pending. Later
      // listeners replay only currently live decisions, never old patches.
      for (const execution of partition.active.values()) {
        for (const pending of execution.pending.values()) {
          notify(pendingNotification(execution, pending));
        }
      }
    }
    return () => delivery.listeners.delete(listener);
  }

  async function resolveToolDecision(
    subscriptionId: string,
    turnId: string,
    toolCallId: string,
    decision: AgentChatToolDecision,
  ): Promise<void> {
    const subscription = requireSubscription(subscriptionId);
    const partition = requirePartition(subscription);
    const execution = partition.active.get(turnId);
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
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) return;
      const partition = partitions.get(subscription.partitionKey);
      partition?.subscriptionIds.delete(subscriptionId);
      subscriptions.delete(subscriptionId);
      deliveries.delete(subscriptionId);
      canvasReads.get(subscriptionId)?.dispose();
      canvasReads.delete(subscriptionId);
      documentReads.get(subscriptionId)?.dispose();
      documentReads.delete(subscriptionId);
      documentWrites.get(subscriptionId)?.dispose();
      documentWrites.delete(subscriptionId);
      canvasWrites.get(subscriptionId)?.dispose();
      canvasWrites.delete(subscriptionId);
      timelineReads.get(subscriptionId)?.dispose();
      timelineReads.delete(subscriptionId);
      timelineWrites.get(subscriptionId)?.dispose();
      timelineWrites.delete(subscriptionId);
      phase4Surfaces.get(subscriptionId)?.dispose();
      phase4Surfaces.delete(subscriptionId);
      proposalReceiptReaders.delete(subscriptionId);
    },
    subscriptionCount: () => subscriptions.size,
  });
}
