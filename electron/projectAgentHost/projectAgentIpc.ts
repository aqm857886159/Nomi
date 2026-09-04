import { ipcMain } from "electron";
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import type { AgentChatRequest, AgentChatToolDecision } from "../harness/agentChatContracts";
import type {
  ProjectAgentHostState,
  ProjectAgentAttachmentRef,
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import {
  parseProjectAgentCommittedProposal,
  type ProjectAgentCommittedProposalRecord,
  type ProjectAgentProposalReceiptTransition,
  type ProjectAgentProposalReceiptWrite,
} from "../shared/projectAgentProposalReceipt";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "./projectAgentIdentity";
import type { ProjectAgentProductionRuntime } from "./projectAgentProductionRuntime";
import type { ProjectAgentProposalReceiptService } from "./projectAgentProposalReceiptStore";
import type { CanvasReadSurfaceIpcCapture } from "../capabilityCore/canvasReadSurfaceIpc";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter } from "../capabilityCore/documentWriteTransportAdapters";
import type { PiCanvasWriteTransportAdapter } from "../capabilityCore/canvasWriteTransportAdapters";
import type {
  PiTimelineReadTransportAdapter,
  PiTimelineWriteTransportAdapter,
} from "../capabilityCore/timelineTransportAdapters";
import type { PiPhase4SurfaceTransportAdapter } from "../capabilityCore/phase4SurfaceTransportAdapters";
import type { PiSkillWriteTransportAdapter } from "../capabilityCore/skillWriteTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import type { CapturedCanvasReadSnapshotHandleWire } from "../shared/surfacePortBinding";
import { ProjectAgentSubscriptionError } from "./projectAgentExecutionCoordinator";
import { projectAgentProposalMatchesApproval } from "./projectAgentProposalReceiptCorrelation";

export const PROJECT_AGENT_OPEN_CHANNEL = "nomi:projectAgent:open";
export const PROJECT_AGENT_SNAPSHOT_CHANNEL = "nomi:projectAgent:snapshot";
export const PROJECT_AGENT_COMMAND_CHANNEL = "nomi:projectAgent:command";
export const PROJECT_AGENT_RELEASE_CHANNEL = "nomi:projectAgent:release";
export const PROJECT_AGENT_PROPOSAL_RECEIPT_READ_CHANNEL = "nomi:projectAgent:proposalReceipt:read";
export const PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL = "nomi:projectAgent:proposalReceipt:write";
export const PROJECT_AGENT_PROPOSAL_RECEIPT_TRANSITION_CHANNEL = "nomi:projectAgent:proposalReceipt:transition";
export const PROJECT_AGENT_PROPOSAL_RECEIPT_CLEAR_CHANNEL = "nomi:projectAgent:proposalReceipt:clear";
export const PROJECT_AGENT_PATCH_CHANNEL = "nomi:projectAgent:patch";
export const PROJECT_AGENT_EVENT_CHANNEL = "nomi:projectAgent:event";

export class ProjectAgentIpcInputError extends Error {
  readonly code = "project_agent_invalid_request" as const;
}

const PUBLIC_PROJECT_AGENT_ERROR_CODES = new Set([
  "project_agent_invalid_request",
  "project_identity_unavailable",
  "project_binding_stale",
  "project_agent_owner_conflict",
  "project_agent_subscription_invalid",
  "project_agent_receipt_invalid",
  "project_agent_attachment_invalid",
  "revision_conflict",
]);

type WireCommand = Readonly<{
  subscriptionId: string;
  clientCommandId: string;
  knownRevision: number;
  type: ProjectAgentMutation["type"] | "tool.decision" | "turn.steer" | "turn.interrupt";
  payload: unknown;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAgentIpcInputError("Project Agent IPC payload must be an object");
  }
  return value as Record<string, unknown>;
}

type SubscriptionOwner = Readonly<{
  subscriptionId: string;
  subscriptionEpoch: number;
  sender: WebContents | undefined;
  frame: WebFrameMain | undefined;
  cleanup: () => void;
}>;

export type ProjectAgentPreparedProject = Readonly<{
  proposalReceipts?: ProjectAgentProposalReceiptService;
  resolveAttachmentClaims?: (claims: readonly unknown[]) => readonly ProjectAgentAttachmentRef[];
}>;

function executionEnqueueField(value: unknown): Readonly<{
  payload: Extract<ProjectAgentMutation, { type: "turn.enqueue" }>["payload"];
  request: AgentChatRequest;
  attachmentClaims: readonly unknown[];
  capturedCanvasReadSnapshot?: CapturedCanvasReadSnapshotHandleWire;
}> {
  const record = asRecord(value);
  exactKeys(record, ["thread", "turn", "userItem", "queueItem", "request", "attachmentClaims", "capturedCanvasReadSnapshot"]);
  if (!Array.isArray(record.attachmentClaims)) throw new ProjectAgentIpcInputError("Project Agent attachments are invalid");
  return Object.freeze({
    payload: {
      thread: record.thread,
      turn: record.turn,
      userItem: record.userItem,
      queueItem: record.queueItem,
    } as Extract<ProjectAgentMutation, { type: "turn.enqueue" }>["payload"],
    request: record.request as AgentChatRequest,
    attachmentClaims: record.attachmentClaims,
    ...(record.capturedCanvasReadSnapshot !== undefined
      ? { capturedCanvasReadSnapshot: record.capturedCanvasReadSnapshot as CapturedCanvasReadSnapshotHandleWire }
      : {}),
  });
}

function toolDecisionField(
  value: unknown,
): Readonly<{ turnId: string; toolCallId: string; decision: AgentChatToolDecision }> {
  const record = asRecord(value);
  exactKeys(record, ["turnId", "toolCallId", "decision"]);
  return Object.freeze({
    turnId: stringField(record.turnId, "turnId"),
    toolCallId: stringField(record.toolCallId, "toolCallId"),
    decision: record.decision as AgentChatToolDecision,
  });
}

function turnControlField(value: unknown, type: "turn.steer" | "turn.interrupt"): Readonly<{ turnId: string; instruction?: string }> {
  const record = asRecord(value);
  exactKeys(record, type === "turn.steer" ? ["turnId", "instruction"] : ["turnId"]);
  return Object.freeze({
    turnId: stringField(record.turnId, "turnId"),
    ...(type === "turn.steer" ? { instruction: stringField(record.instruction, "instruction") } : {}),
  });
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) {
    throw new ProjectAgentIpcInputError("Project Agent IPC payload contains an unexpected field");
  }
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectAgentIpcInputError(`Project Agent IPC ${field} is invalid`);
  }
  return value;
}

function revisionField(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProjectAgentIpcInputError("Project Agent IPC expectedRevision is invalid");
  }
  return value as number;
}

function bindingField(value: unknown): ProjectBinding {
  const record = asRecord(value);
  exactKeys(record, ["projectId", "immutableProjectUuid", "projectGeneration"]);
  try {
    assertProjectAgentBinding(record as ProjectBinding);
  } catch {
    throw new ProjectAgentIpcInputError("Project Agent IPC binding is invalid");
  }
  return Object.freeze({ ...(record as ProjectBinding) });
}

function commandField(value: unknown): WireCommand {
  const record = asRecord(value);
  exactKeys(record, ["subscriptionId", "clientCommandId", "knownRevision", "type", "payload"]);
  const subscriptionId = stringField(record.subscriptionId, "subscriptionId");
  const clientCommandId = stringField(record.clientCommandId, "clientCommandId");
  if (!Number.isSafeInteger(record.knownRevision) || (record.knownRevision as number) < 0) {
    throw new ProjectAgentIpcInputError("Project Agent IPC knownRevision is invalid");
  }
  if (typeof record.type !== "string" || !record.type.trim()) {
    throw new ProjectAgentIpcInputError("Project Agent IPC command type is invalid");
  }
  return Object.freeze({
    subscriptionId,
    clientCommandId,
    knownRevision: record.knownRevision as number,
    type: record.type as ProjectAgentMutation["type"],
    payload: record.payload,
  });
}

function errorEnvelope(error: unknown): Readonly<{ ok: false; error: { code: string } }> {
  const explicitCode =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  const message = error instanceof Error ? error.message : undefined;
  const code =
    (explicitCode && PUBLIC_PROJECT_AGENT_ERROR_CODES.has(explicitCode) ? explicitCode : undefined) ??
    (message && PUBLIC_PROJECT_AGENT_ERROR_CODES.has(message) ? message : undefined) ??
    "project_agent_unavailable";
  return { ok: false, error: { code } };
}

function registerHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (event, input) => {
    try {
      assertTrustedSender(event);
      return { ok: true, value: await handler(event, input) } as const;
    } catch (error) {
      return errorEnvelope(error);
    }
  });
}

/** Registers the only renderer-facing ProjectAgentHost transport. */
export function registerProjectAgentIpc(
  input: Readonly<{
    runtime: ProjectAgentProductionRuntime;
    surfaceCapture: CanvasReadSurfaceIpcCapture;
    captureCanvasRead?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiCanvasReadTransportAdapter;
    captureCanvasReadSnapshot?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      handle: CapturedCanvasReadSnapshotHandleWire,
      requestId: string,
    ) => PiCanvasReadTransportAdapter;
    captureDocumentRead?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiDocumentReadTransportAdapter;
    captureDocumentWrite?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiDocumentWriteTransportAdapter;
    captureCanvasWrite?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiCanvasWriteTransportAdapter;
    captureTimelineRead?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiTimelineReadTransportAdapter;
    captureTimelineWrite?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiTimelineWriteTransportAdapter;
    capturePhase4Surface?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiPhase4SurfaceTransportAdapter;
    captureSkillWrite?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiSkillWriteTransportAdapter;
    captureSkillRead?: (
      event: IpcMainInvokeEvent,
      binding: ProjectBinding,
      requestId: string,
    ) => PiSkillReadTransportAdapter;
    /** Main-only migration hook; it runs after sender/binding verification and before open. */
    prepareProject?: (
      binding: ProjectBinding,
    ) => ProjectAgentPreparedProject | void | Promise<ProjectAgentPreparedProject | void>;
  }>,
): void {
  const subscriptionOwners = new Map<string, SubscriptionOwner>();
  const subscriptionProposalReceipts = new Map<string, ProjectAgentProposalReceiptService>();
  const subscriptionAttachmentResolvers = new Map<
    string,
    (claims: readonly unknown[]) => readonly ProjectAgentAttachmentRef[]
  >();
  const unsubscribeEvents = new Map<string, () => void>();
  const openAttempts = new Map<WebContents, Readonly<{ id: number; frame: WebFrameMain | undefined }>>();
  let nextOpenAttemptId = 0;
  const revokeSubscription = (subscriptionId: string): void => {
    const owner = subscriptionOwners.get(subscriptionId);
    if (!owner) return;
    subscriptionOwners.delete(subscriptionId);
    owner.cleanup();
    unsubscribeEvents.get(subscriptionId)?.();
    unsubscribeEvents.delete(subscriptionId);
    subscriptionProposalReceipts.delete(subscriptionId);
    subscriptionAttachmentResolvers.delete(subscriptionId);
    input.runtime.executionCoordinator.release(subscriptionId);
  };
  const assertSubscriptionOwner = (event: IpcMainInvokeEvent, subscriptionId: string): void => {
    const owner = subscriptionOwners.get(subscriptionId);
    if (!owner || event.sender !== owner.sender || event.senderFrame !== owner.frame) {
      throw new ProjectAgentSubscriptionError("Project Agent subscription owner mismatch");
    }
  };
  const receiptService = (
    event: IpcMainInvokeEvent,
    subscriptionId: string,
  ): ProjectAgentProposalReceiptService => {
    assertSubscriptionOwner(event, subscriptionId);
    const service = subscriptionProposalReceipts.get(subscriptionId);
    if (!service) throw new ProjectAgentIpcInputError("Project Agent proposal receipt is unavailable");
    const snapshot = input.runtime.executionCoordinator.snapshot(subscriptionId);
    if (!sameProjectAgentBinding(snapshot.binding, service.binding)) {
      throw new ProjectAgentIpcInputError("Project Agent proposal receipt binding mismatch");
    }
    return service;
  };
  const receiptView = (service: ProjectAgentProposalReceiptService) => service.read();
  const assertHostReceiptCorrelation = (
    subscriptionId: string,
    service: ProjectAgentProposalReceiptService,
    proposalId: string,
    value: unknown,
  ): ProjectAgentCommittedProposalRecord => {
    const proposal = parseProjectAgentCommittedProposal(value);
    if (!proposal || proposal.proposalId !== proposalId) {
      throw new ProjectAgentIpcInputError("Project Agent proposal receipt is invalid");
    }
    const snapshot = input.runtime.executionCoordinator.snapshot(subscriptionId) as ProjectAgentHostState;
    if (!sameProjectAgentBinding(snapshot.binding, service.binding)) {
      throw new ProjectAgentIpcInputError("Project Agent proposal receipt binding mismatch");
    }
    const claimed = (snapshot.proposalApprovals ?? []).filter(
      (approval) => approval.lifecycle === "claimed" && approval.ref.receiptProposalId === proposalId,
    );
    const correlated = proposal.hostApprovalId !== undefined && proposal.hostActionHash !== undefined;
    if (!correlated) {
      if (claimed.length > 0) {
        throw new ProjectAgentIpcInputError("Project Agent proposal receipt is missing Host correlation");
      }
      return proposal;
    }
    if (
      claimed.length !== 1 ||
      !projectAgentProposalMatchesApproval(proposalId, proposal, claimed[0].ref)
    ) {
      throw new ProjectAgentIpcInputError("Project Agent proposal receipt Host correlation mismatch");
    }
    return proposal;
  };
  registerHandler(PROJECT_AGENT_OPEN_CHANNEL, async (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["binding"]);
    const binding = bindingField(request.binding);
    // Surface capture proves the binding belongs to this live main-frame
    // owner. The opaque port remains owned by the app-main lifecycle.
    let canvasRead: PiCanvasReadTransportAdapter | undefined;
    let documentRead: PiDocumentReadTransportAdapter | undefined;
    let documentWrite: PiDocumentWriteTransportAdapter | undefined;
    let canvasWrite: PiCanvasWriteTransportAdapter | undefined;
    let timelineRead: PiTimelineReadTransportAdapter | undefined;
    let timelineWrite: PiTimelineWriteTransportAdapter | undefined;
    let phase4Surface: PiPhase4SurfaceTransportAdapter | undefined;
    let skillRead: PiSkillReadTransportAdapter | undefined;
    let skillWrite: PiSkillWriteTransportAdapter | undefined;
    let subscription;
    let prepared: ProjectAgentPreparedProject | void;
    const sender = event.sender;
    const frame = event.senderFrame ?? undefined;
    const attempt = Object.freeze({ id: ++nextOpenAttemptId, frame });
    openAttempts.set(sender, attempt);
    let attemptAlive = true;
    const invalidateAttempt = (): void => {
      attemptAlive = false;
      if (openAttempts.get(sender) === attempt) openAttempts.delete(sender);
    };
    const navigateAttempt = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) invalidateAttempt();
    };
    sender?.on?.("did-start-navigation", navigateAttempt);
    sender?.on?.("render-process-gone", invalidateAttempt);
    sender?.on?.("destroyed", invalidateAttempt);
    const cleanupAttempt = (): void => {
      sender?.removeListener?.("did-start-navigation", navigateAttempt);
      sender?.removeListener?.("render-process-gone", invalidateAttempt);
      sender?.removeListener?.("destroyed", invalidateAttempt);
    };
    const assertCurrentAttempt = (): void => {
      if (!attemptAlive || openAttempts.get(sender) !== attempt || event.senderFrame !== frame) {
        throw new ProjectAgentSubscriptionError("Project Agent open attempt was superseded");
      }
    };
    try {
      canvasRead = input.captureCanvasRead
        ? input.captureCanvasRead(event, binding, `project-agent-open-${binding.projectId}`)
        : (input.surfaceCapture.captureCanvasReadPort(event, binding), undefined);
      documentRead = input.captureDocumentRead?.(event, binding, `project-agent-open-${binding.projectId}`);
      documentWrite = input.captureDocumentWrite?.(event, binding, `project-agent-open-${binding.projectId}`);
      canvasWrite = input.captureCanvasWrite?.(event, binding, `project-agent-open-${binding.projectId}`);
      timelineRead = input.captureTimelineRead?.(event, binding, `project-agent-open-${binding.projectId}`);
      timelineWrite = input.captureTimelineWrite?.(event, binding, `project-agent-open-${binding.projectId}`);
      phase4Surface = input.capturePhase4Surface?.(event, binding, `project-agent-open-${binding.projectId}`);
      skillRead = input.captureSkillRead?.(event, binding, `project-agent-open-${binding.projectId}`);
      skillWrite = input.captureSkillWrite?.(event, binding, `project-agent-open-${binding.projectId}`);
      prepared = await input.prepareProject?.(binding);
      assertCurrentAttempt();
      const proposalReceipts = prepared?.proposalReceipts;
      if (proposalReceipts && !sameProjectAgentBinding(proposalReceipts.binding, binding)) {
        throw new ProjectAgentIpcInputError("Project Agent prepared receipt binding mismatch");
      }
      subscription = await input.runtime.executionCoordinator.open(
        binding,
        canvasRead || documentRead || documentWrite || canvasWrite || timelineRead || timelineWrite || phase4Surface || skillRead || skillWrite || proposalReceipts
          ? {
              ...(canvasRead ? { canvasRead } : {}),
              ...(documentRead ? { documentRead } : {}),
              ...(documentWrite ? { documentWrite } : {}),
              ...(canvasWrite ? { canvasWrite } : {}),
              ...(timelineRead ? { timelineRead } : {}),
              ...(timelineWrite ? { timelineWrite } : {}),
              ...(phase4Surface ? { phase4Surface } : {}),
              ...(skillRead ? { skillRead } : {}),
              ...(skillWrite ? { skillWrite } : {}),
              ...(proposalReceipts
                ? {
                    proposalReceipt: () => proposalReceipts.read(),
                    // The renderer may read/transition recovery evidence, but
                    // only this main-owned service is handed to Host execution
                    // for prepare/commit receipt ownership.
                    proposalReceiptWriter: proposalReceipts,
                  }
                : {}),
            }
          : undefined,
      );
      assertCurrentAttempt();
    } catch (error) {
      if (subscription) input.runtime.executionCoordinator.release(subscription.subscriptionId);
      else {
        canvasRead?.dispose();
        documentRead?.dispose();
        documentWrite?.dispose();
        canvasWrite?.dispose();
        timelineRead?.dispose();
        timelineWrite?.dispose();
        phase4Surface?.dispose();
        skillRead?.dispose();
        skillWrite?.dispose();
      }
      cleanupAttempt();
      if (openAttempts.get(sender) === attempt) openAttempts.delete(sender);
      throw error;
    }
    cleanupAttempt();
    if (openAttempts.get(sender) === attempt) openAttempts.delete(sender);
    for (const [existingId, owner] of subscriptionOwners) {
      if (owner.sender === sender && owner.frame === frame) revokeSubscription(existingId);
    }
    let owner!: SubscriptionOwner;
    const revoke = (): void => revokeSubscription(subscription.subscriptionId);
    const navigate = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) revoke();
    };
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      sender?.removeListener?.("did-start-navigation", navigate);
      sender?.removeListener?.("render-process-gone", revoke);
      sender?.removeListener?.("destroyed", revoke);
    };
    owner = Object.freeze({
      subscriptionId: subscription.subscriptionId,
      subscriptionEpoch: subscription.subscriptionEpoch,
      sender,
      frame,
      cleanup,
    });
    subscriptionOwners.set(subscription.subscriptionId, owner);
    sender?.on?.("did-start-navigation", navigate);
    sender?.on?.("render-process-gone", revoke);
    sender?.on?.("destroyed", revoke);
    if (prepared?.proposalReceipts) {
      if (!sameProjectAgentBinding(prepared.proposalReceipts.binding, subscription.snapshot.binding)) {
        revokeSubscription(subscription.subscriptionId);
        throw new ProjectAgentIpcInputError("Project Agent prepared receipt binding mismatch");
      }
      subscriptionProposalReceipts.set(subscription.subscriptionId, prepared.proposalReceipts);
    }
    if (prepared?.resolveAttachmentClaims) {
      subscriptionAttachmentResolvers.set(subscription.subscriptionId, prepared.resolveAttachmentClaims);
    }
    const subscribe = input.runtime.executionCoordinator.subscribe;
    if (subscribe) {
      const unsubscribe = subscribe.call(
        input.runtime.executionCoordinator,
        subscription.subscriptionId,
        (notification: ProjectAgentExecutionEvent) => {
          const current = subscriptionOwners.get(subscription.subscriptionId);
          if (
            current !== owner ||
            notification.subscriptionId !== owner.subscriptionId ||
            notification.subscriptionEpoch !== owner.subscriptionEpoch ||
            !frame ||
            frame.detached ||
            frame.isDestroyed()
          ) return;
          if (notification.type === "patch") frame.send(PROJECT_AGENT_PATCH_CHANNEL, notification.patch);
          else frame.send(PROJECT_AGENT_EVENT_CHANNEL, notification);
        },
      );
      unsubscribeEvents.set(subscription.subscriptionId, unsubscribe);
    }
    return {
      subscriptionId: subscription.subscriptionId,
      subscriptionEpoch: subscription.subscriptionEpoch,
      snapshot: subscription.snapshot,
      proposalReceipt: prepared?.proposalReceipts ? receiptView(prepared.proposalReceipts) : null,
    };
  });

  registerHandler(PROJECT_AGENT_SNAPSHOT_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    assertSubscriptionOwner(event, subscriptionId);
    return input.runtime.executionCoordinator.snapshot(subscriptionId);
  });

  registerHandler(PROJECT_AGENT_COMMAND_CHANNEL, async (event, raw) => {
    const command = commandField(raw);
    assertSubscriptionOwner(event, command.subscriptionId);
    if (command.type === "turn.steer" || command.type === "turn.interrupt") {
      const control = turnControlField(command.payload, command.type);
      if (command.type === "turn.steer") {
        await input.runtime.executionCoordinator.steer(command.subscriptionId, control.turnId, control.instruction!);
      } else {
        await input.runtime.executionCoordinator.interrupt(command.subscriptionId, control.turnId);
      }
      return {
        state: input.runtime.executionCoordinator.snapshot(command.subscriptionId),
        patch: null,
        replayed: false,
      };
    }
    if (command.type === "tool.decision") {
      const decision = toolDecisionField(command.payload);
      return input.runtime.executionCoordinator
        .resolveToolDecision(command.subscriptionId, decision.turnId, decision.toolCallId, decision.decision)
        .then(() => ({
          state: input.runtime.executionCoordinator.snapshot(command.subscriptionId),
          patch: null,
          replayed: false,
        }));
    }
    const binding = input.runtime.executionCoordinator.snapshot(command.subscriptionId).binding;
    const mutation = {
      commandId: command.clientCommandId,
      expectedRevision: command.knownRevision,
      binding,
      sender: { kind: "renderer" as const, senderId: command.subscriptionId },
      type: command.type,
      payload: command.payload,
    } as ProjectAgentMutation;
    if (
      command.type === "turn.enqueue" &&
      command.payload &&
      typeof command.payload === "object" &&
      !Array.isArray(command.payload) &&
      Object.prototype.hasOwnProperty.call(command.payload, "request")
    ) {
      const execution = executionEnqueueField(command.payload);
      const resolver = subscriptionAttachmentResolvers.get(command.subscriptionId);
      if (execution.attachmentClaims.length > 0 && !resolver) throw new Error("project_agent_attachment_invalid");
      const attachmentRefs = resolver ? resolver(execution.attachmentClaims) : Object.freeze([]);
      const request = {
        ...execution.request,
        history: { kind: "ephemeral" as const },
        attachments: attachmentRefs.flatMap((ref) => ref.display ? [{
          url: ref.display.url,
          contentType: ref.display.contentType,
          fileName: ref.display.fileName,
          kind: ref.display.kind,
        }] : []),
      };
      let canvasRead: PiCanvasReadTransportAdapter | undefined;
      try {
        if (execution.capturedCanvasReadSnapshot !== undefined) {
          if (!input.captureCanvasReadSnapshot) throw new Error("surface_port_unavailable");
          canvasRead = input.captureCanvasReadSnapshot(
            event,
            binding,
            execution.capturedCanvasReadSnapshot,
            `project-agent-turn-${command.subscriptionId}-${execution.payload.turn.turnId}`,
          );
        }
        return await input.runtime.executionCoordinator.enqueue(command.subscriptionId, {
          mutation: {
            ...mutation,
            payload: {
              ...execution.payload,
              queueItem: { ...execution.payload.queueItem, attachmentRefs },
            },
          } as Extract<
            ProjectAgentMutation,
            { type: "turn.enqueue" }
          >,
          request,
          ...(canvasRead ? { canvasRead } : {}),
        });
      } catch (error) {
        canvasRead?.dispose();
        throw error;
      }
    }
    return input.runtime.executionCoordinator.dispatch(command.subscriptionId, mutation);
  });

  registerHandler(PROJECT_AGENT_RELEASE_CHANNEL, (_event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    assertSubscriptionOwner(_event, subscriptionId);
    revokeSubscription(subscriptionId);
    return { released: true };
  });

  registerHandler(PROJECT_AGENT_PROPOSAL_RECEIPT_READ_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    return receiptView(receiptService(event, subscriptionId));
  });

  registerHandler(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId", "expectedRevision", "proposalId", "operationId", "lifecycle", "proposal"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    const service = receiptService(event, subscriptionId);
    const proposalId = stringField(request.proposalId, "proposalId");
    const proposal = assertHostReceiptCorrelation(subscriptionId, service, proposalId, request.proposal);
    return service.write(Object.freeze({
      expectedRevision: revisionField(request.expectedRevision),
      proposalId,
      operationId: stringField(request.operationId, "operationId"),
      lifecycle: request.lifecycle as ProjectAgentProposalReceiptWrite["lifecycle"],
      proposal,
    }) as ProjectAgentProposalReceiptWrite);
  });

  registerHandler(PROJECT_AGENT_PROPOSAL_RECEIPT_TRANSITION_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId", "expectedRevision", "proposalId", "operationId", "lifecycle"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    return receiptService(event, subscriptionId).transition(Object.freeze({
      expectedRevision: revisionField(request.expectedRevision),
      proposalId: stringField(request.proposalId, "proposalId"),
      operationId: stringField(request.operationId, "operationId"),
      lifecycle: request.lifecycle as ProjectAgentProposalReceiptTransition["lifecycle"],
    }));
  });

  registerHandler(PROJECT_AGENT_PROPOSAL_RECEIPT_CLEAR_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId", "expectedRevision", "proposalId", "operationId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    return receiptService(event, subscriptionId).clear(Object.freeze({
      expectedRevision: revisionField(request.expectedRevision),
      proposalId: stringField(request.proposalId, "proposalId"),
      operationId: stringField(request.operationId, "operationId"),
    }));
  });

  // Patch delivery is command-result based in the first transport slice. The
  // channel is reserved so later streaming subscribers cannot create a second
  // writer or invent a parallel state protocol.
  void PROJECT_AGENT_PATCH_CHANNEL;
}
