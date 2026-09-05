import crypto from "node:crypto";
import type { AgentChatToolDecision } from "../harness/agentChatContracts";
import type { AgentChatRequest, AgentChatResponse } from "../harness/agentChatContracts";
import { captureAgentChatRequest, mergeAgentToolProfiles, resolveAgentToolProfile } from "../harness/agentChatPolicy";
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectAgentHostState,
  ProjectAgentQueueItem,
  ProjectAgentPatch,
  ProjectBinding,
  ProjectAgentExecutionEventPayload,
} from "../shared/projectAgentContracts";
import { projectAgentPartitionKey, sameProjectAgentBinding } from "./projectAgentIdentity";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter } from "../capabilityCore/documentWriteTransportAdapters";
import type {
  PiCanvasWriteTransportAdapter,
} from "../capabilityCore/canvasWriteTransportAdapters";
import type {
  PiTimelineReadTransportAdapter,
  PiTimelineWriteTransportAdapter,
} from "../capabilityCore/timelineTransportAdapters";
import type {
  PiPhase4SurfaceTransportAdapter,
} from "../capabilityCore/phase4SurfaceTransportAdapters";
import type {
  PiSkillWriteTransportAdapter,
} from "../capabilityCore/skillWriteTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import type { PiProductionRunTransportAdapter } from "../capabilityCore/productionRunTransportAdapters";
import type { PiGenerationTransportAdapter } from "../capabilityCore/generationTransportAdapters";
import { isRendererOwnedStoryboardProposal } from "../shared/agentCapabilities/canvasWrite";
import {
  digest,
  validateSteering,
  turnIsInterruptible,
} from "./projectAgentExecutionHelpers";
import { projectAgentWorkModeOf } from "../shared/projectAgentContracts";
import { projectAgentExecutionRisk, projectAgentMayReuseSafeApproval, projectAgentWorkModeDecision } from "./projectAgentExecutionPolicy";
import {
  ProjectAgentSubscriptionError,
  deferred,
  recordProposalSettlement,
  rememberCanvasWriteOutcome,
  type ActiveExecution,
  type ExecutionPartition,
  type PendingToolDecision,
  type ProjectAgentExecutionCoordinatorDeps,
  type ProjectAgentExecutionEnqueue,
  type ProjectAgentExecutionListener,
  type ProjectAgentProposalReceiptReader,
  type ProjectAgentProposalReceiptWriter,
  type ProjectAgentSubscription,
  type ProjectAgentExecutionOpenOptions,
  type ProjectAgentExecutionCoordinator,
  type SubscriptionDelivery,
  type SubscriptionRecord,
} from "./projectAgentExecutionCoordinatorTypes";
import { executeProjectAgentTurn, type ProjectAgentTurnExecutionContext } from "./projectAgentTurnExecution";
import { recoverOrphanedExecutions } from "./projectAgentExecutionRecovery";
import { completeProjectAgentExperience } from "../experience/projectAgentExperience";

import {
  persistApprovedProposal as persistApprovedProposalIn,
  persistPreparedProposal as persistPreparedProposalIn,
  type ProjectAgentProposalPersistenceContext,
} from "./projectAgentProposalPersistence";
import { createProjectAgentAdapterResolvers } from "./projectAgentAdapterResolvers";
export type {
  ProjectAgentSubscription,
  ProjectAgentProposalReceiptReader,
  ProjectAgentProposalReceiptWriter,
  ProjectAgentExecutionOpenOptions,
  ProjectAgentExecutionCoordinatorDeps,
  ProjectAgentExecutionCoordinator,
} from "./projectAgentExecutionCoordinatorTypes";
export { ProjectAgentSubscriptionError } from "./projectAgentExecutionCoordinatorTypes";
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
  const skillReads = new Map<string, PiSkillReadTransportAdapter | undefined>();
  const skillWrites = new Map<string, PiSkillWriteTransportAdapter | undefined>();
  const productionRuns = new Map<string, PiProductionRunTransportAdapter | undefined>();
  const generationAdapters = new Map<string, PiGenerationTransportAdapter | undefined>(); let generationAdapterFactory = deps.generation;
  const proposalReceiptReaders = new Map<string, ProjectAgentProposalReceiptReader | undefined>();
  const proposalReceiptWriters = new Map<string, ProjectAgentProposalReceiptWriter | undefined>();
  const runAgent =
    deps.runAgent ?? (async (request, hooks) => (await import("../ai/agentChatV2")).runAgentChatV2(request, hooks));
  const now = deps.now ?? (() => new Date().toISOString());
  const reportInternalError =
    deps.reportInternalError ??
    ((error: unknown, context: Readonly<{ phase: string; turnId: string; message: string }>) => {
      console.error(`[nomi:project-agent] ${context.phase} failed for ${context.turnId}: ${context.message}`, error);
    });
  const onTurnCompleted = deps.onTurnCompleted ?? completeProjectAgentExperience;

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
        toolProfiles: new Map(),
        active: new Map(),
        completions: new Map(),
        initialization: Promise.resolve(),
        steering: new Map(),
      };
      partitions.set(partitionKey, partition);
      partition.initialization = recoverOrphanedExecutions(partition, options.proposalReceipt, now);
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
    skillReads.set(subscription.subscriptionId, options.skillRead);
    skillWrites.set(subscription.subscriptionId, options.skillWrite);
    proposalReceiptReaders.set(subscription.subscriptionId, options.proposalReceipt);
    proposalReceiptWriters.set(subscription.subscriptionId, options.proposalReceiptWriter);
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
      if (mutation.type === "queue.delete" && reduction.patch && !reduction.replayed) {
        const removedTurnId = reduction.patch.changes.find((change) => change.kind === "turn-removed")?.turnId;
        if (removedTurnId) {
          const reserved = partition.requests.get(removedTurnId);
          partition.requests.delete(removedTurnId);
          reserved?.canvasRead?.dispose();
        }
      }
      const terminalTurnId =
        mutation.type === "turn.transition" || mutation.type === "execution.recover"
          ? mutation.payload.turnId
          : mutation.type === "queue.delete"
            ? reduction.patch?.changes.find((change) => change.kind === "turn-removed")?.turnId ?? ""
            : "";
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

  /**
   * 临时执行路（2026-09-05）：single-shot（判官 / 方向规划）问一次、零工具、不要历史，
   * 也**不该在用户的项目会话里留下任何痕迹**——机器提示词不是用户说的话。
   *
   * 它直接调既有的 runAgent 依赖：不 dispatch mutation、不进命令账本、不写仓库，
   * 因此盘上快照（含 hostRevision）前后完全不变。附件 claim 由 IPC 侧沿用既有解析器解析后传进来，
   * 判官的本地帧准入不受影响。
   */
  async function runEphemeral(subscriptionId: string, request: AgentChatRequest): Promise<AgentChatResponse> {
    const record = requireSubscription(subscriptionId);
    const partition = requirePartition(record);
    if (request.capability !== "single-shot") {
      throw new ProjectAgentSubscriptionError("Ephemeral execution is only for single-shot capability");
    }
    for (const claimedProjectId of [request.projectId, request.canvasProjectId]) {
      if (claimedProjectId !== undefined && claimedProjectId !== record.binding.projectId) {
        throw new ProjectAgentSubscriptionError("Project Agent request project does not match its subscription");
      }
    }
    return runAgent(
      captureAgentChatRequest({
        ...request,
        history: { kind: "ephemeral" },
        projectId: partition.binding.projectId,
        canvasProjectId: partition.binding.projectId,
      }),
      { abortSignal: undefined, emit: () => undefined, awaitToolConfirmation: async () => ({ ok: false, message: "single-shot runs without tools" }) },
    );
  }

  async function enqueue(subscriptionId: string, input: ProjectAgentExecutionEnqueue) {
    const record = requireSubscription(subscriptionId);
    const partition = requirePartition(record);
    // 结构上堵死回头路（R28）：single-shot 只能走 runEphemeral。若它又被当成 Host 回合排进来，
    // 就会重新在用户线程里留下机器提示词——那正是本次要消灭的那一类，故 fail-closed 而非静默接受。
    if (input.request.capability === "single-shot") {
      throw new ProjectAgentSubscriptionError("Single-shot requests must use ephemeral execution, not a persisted Host turn");
    }
    const turnId = input.mutation.payload.turn.turnId;
    for (const claimedProjectId of [input.request.projectId, input.request.canvasProjectId]) {
      if (claimedProjectId !== undefined && claimedProjectId !== record.binding.projectId) {
        throw new ProjectAgentSubscriptionError("Project Agent request project does not match its subscription");
      }
    }
    const target = input.mutation.payload.queueItem.target;
    const requestedProfile = resolveAgentToolProfile({ capability: input.request.capability, prompt: input.request.prompt, toolProfile: input.request.toolProfile });
    const stickyProfile = mergeAgentToolProfiles(partition.toolProfiles.get(input.mutation.payload.turn.threadId), requestedProfile);
    const request = captureAgentChatRequest({
      ...input.request,
      // The Host turn is the immutable source for execution posture.  Do not
      // let an untrusted/replayed renderer request drift from the queued
      // record; approval/spend remains Host-only and is never copied here.
      workMode: projectAgentWorkModeOf(input.mutation.payload.turn.workMode),
      toolProfile: stickyProfile,
      history: { kind: "ephemeral" },
      projectId: record.binding.projectId,
      ...(target.kind === "canvas"
        ? { canvasProjectId: record.binding.projectId, selectedNodeIds: [...target.nodeIds] }
        : { canvasProjectId: undefined, selectedNodeIds: [] }),
    });
    const requestMap = partition.requests;
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
    if (!previousRequest) {
      requestMap.set(turnId, reservation);
      partition.toolProfiles.set(input.mutation.payload.turn.threadId, stickyProfile);
    }
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
  const proposalPersistence: ProjectAgentProposalPersistenceContext = { now, queueExecutionMutation, dispatchFresh };
  const persistApprovedProposal = (
    partition: ExecutionPartition,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    decision: AgentChatToolDecision,
  ) => persistApprovedProposalIn(proposalPersistence, partition, execution, call, decision);
  const persistPreparedProposal = (
    partition: ExecutionPartition,
    execution: ActiveExecution,
    call: { toolCallId: string; toolName: string; args: unknown },
    decision: AgentChatToolDecision,
    prepared: { invocation: { target: ProjectAgentQueueItem["target"]; preconditions: ProjectAgentQueueItem["preconditions"]; policyRevision: number; inputHash: string; actionHash: string } },
  ) => persistPreparedProposalIn(proposalPersistence, partition, execution, call, decision, prepared);
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
    const workModeDecision = projectAgentWorkModeDecision(execution.turn.workMode, call.toolName, call.args);
    if (!workModeDecision.allowed) {
      return { ok: false, denied: true, message: workModeDecision.reason ?? "Agent work mode denied this action" };
    }
    const policy = execution.turn.approvalPolicy;
    // Renderer-owned storyboard proposals still need the renderer callback to
    // capture the parsed plan, even though their descriptor effect is a local
    // reversible write. A silent safe-auto decision would otherwise let the
    // model continue without populating the planner's returned plan.
    if (!isRendererOwnedStoryboardProposal(call.toolName, call.args)
      && projectAgentMayReuseSafeApproval(policy, call.toolName, call.args, execution.safeApprovalGranted === true)) {
      return { ok: true, silent: true };
    }
    const safeReversible = projectAgentExecutionRisk(call.toolName, call.args) === "safe-reversible";
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
        if (decision.ok && !decision.silent && safeReversible) execution.safeApprovalGranted = true;
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

  function productionRunFor(partition: ExecutionPartition): PiProductionRunTransportAdapter | undefined {
    const existing = productionRuns.get(partition.partitionKey);
    if (existing || !deps.productionRun) return existing;
    const adapter = deps.productionRun(partition.binding); productionRuns.set(partition.partitionKey, adapter); return adapter;
  }
  function generationFor(partition: ExecutionPartition): PiGenerationTransportAdapter | undefined { const existing = generationAdapters.get(partition.partitionKey); if (existing || !generationAdapterFactory) return existing; const adapter = generationAdapterFactory(partition.binding); generationAdapters.set(partition.partitionKey, adapter); return adapter; }
  const {
    canvasReadFor,
    documentReadFor,
    documentWriteFor,
    canvasWriteFor,
    timelineReadFor,
    timelineWriteFor,
    phase4SurfaceFor,
    skillReadFor,
    skillWriteFor,
    proposalReceiptReaderFor,
    proposalReceiptWriterFor,
  } = createProjectAgentAdapterResolvers({
    subscriptions,
    canvasReads,
    documentReads,
    documentWrites,
    canvasWrites,
    timelineReads,
    timelineWrites,
    phase4Surfaces,
    skillReads,
    skillWrites,
    proposalReceiptReaders,
    proposalReceiptWriters,
  });
  const turnExecutionContext: ProjectAgentTurnExecutionContext = {
    now,
    publish,
    dispatchPartition,
    dispatchFresh,
    queueExecutionMutation,
    recordProposalSettlement,
    cleanupExecution,
    reportInternalError,
    runAgent,
    onTurnCompleted,
    awaitToolDecision,
    persistApprovedProposal,
    persistPreparedProposal,
    rememberCanvasWriteOutcome,
    canvasReadFor,
    documentReadFor,
    documentWriteFor,
    canvasWriteFor,
    timelineReadFor,
    timelineWriteFor,
    phase4SurfaceFor,
    skillReadFor,
    skillWriteFor,
    productionRunFor,
    generationFor,
    proposalReceiptReaderFor,
    proposalReceiptWriterFor,
  };

  function scheduleDrain(partition: ExecutionPartition): void {
    if (partition.drain) return;
    const tail = Promise.resolve()
      .then(async () => {
        while (true) {
          if (partition.active.size) return;
          const state = partition.host.getSnapshot(partition.binding);
          const head = state.queue.find(
            (item) => ["queued", "proposed", "running"].includes(item.status) && item.paused !== true,
          );
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
            steering: partition.steering.get(turn.turnId),
          };
          partition.steering.delete(turn.turnId);
          partition.active.set(turn.turnId, execution);
          if ((await executeProjectAgentTurn(turnExecutionContext, partition, execution)) === "stop") return;
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

  async function steer(subscriptionId: string, turnId: string, instruction: string): Promise<void> {
    const partition = requirePartition(requireSubscription(subscriptionId));
    const fail = (message: string): never => { throw new ProjectAgentSubscriptionError(message); };
    const normalized = validateSteering(partition.host.getSnapshot(partition.binding), turnId, instruction, fail);
    const active = partition.active.get(turnId);
    if (active) {
      // Steering is deliberately non-aborting: the current tool/effect settles
      // first, then the instruction is included in the next model request.
      active.steering = normalized;
      return;
    }
    if (!partition.requests.has(turnId)) fail("Project Agent turn is not steerable");
    partition.steering.set(turnId, normalized);
  }

  async function interrupt(subscriptionId: string, turnId: string): Promise<void> {
    const partition = requirePartition(requireSubscription(subscriptionId));
    const current = partition.host.getSnapshot(partition.binding);
    const turn = current.turns.find((candidate) => candidate.turnId === turnId);
    if (!turnIsInterruptible(current, turnId, () => { throw new ProjectAgentSubscriptionError("Project Agent turn is unavailable"); })) return;
    await dispatchFresh(partition, (state) => ({
      commandId: `turn-interrupt-${turn!.executionToken}-${state.hostRevision}`,
      expectedRevision: state.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: subscriptionId },
      type: "turn.transition",
      payload: { turnId, status: "stopped", retryable: true, updatedAt: now() },
    }));
  }

  return Object.freeze({
    open,
    snapshot,
    dispatch,
    enqueue,
    runEphemeral,
    subscribe,
    resolveToolDecision,
    steer,
    interrupt,
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
      skillWrites.get(subscriptionId)?.dispose();
      skillWrites.delete(subscriptionId);
      if (![...subscriptions.values()].some((candidate) => candidate.partitionKey === subscription.partitionKey)) { productionRuns.get(subscription.partitionKey)?.dispose(); productionRuns.delete(subscription.partitionKey); generationAdapters.get(subscription.partitionKey)?.dispose(); generationAdapters.delete(subscription.partitionKey); }
      phase4Surfaces.get(subscriptionId)?.dispose();
      phase4Surfaces.delete(subscriptionId);
      skillReads.get(subscriptionId)?.dispose();
      skillReads.delete(subscriptionId);
      proposalReceiptReaders.delete(subscriptionId);
      proposalReceiptWriters.delete(subscriptionId);
    },
    setGenerationAdapterFactory: (factory) => { generationAdapterFactory = factory; for (const [partitionKey, adapter] of generationAdapters) { adapter?.dispose(); generationAdapters.delete(partitionKey); } },
    subscriptionCount: () => subscriptions.size,
  });
}
