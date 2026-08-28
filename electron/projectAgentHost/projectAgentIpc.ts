import { ipcMain } from "electron";
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import type { AgentChatRequest, AgentChatToolDecision } from "../harness/agentChatContracts";
import type { ProjectAgentExecutionEvent, ProjectAgentMutation, ProjectBinding } from "../shared/projectAgentContracts";
import { assertProjectAgentBinding } from "./projectAgentIdentity";
import type { ProjectAgentProductionRuntime } from "./projectAgentProductionRuntime";
import type { CanvasReadSurfaceIpcCapture } from "../capabilityCore/canvasReadSurfaceIpc";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";

export const PROJECT_AGENT_OPEN_CHANNEL = "nomi:projectAgent:open";
export const PROJECT_AGENT_SNAPSHOT_CHANNEL = "nomi:projectAgent:snapshot";
export const PROJECT_AGENT_COMMAND_CHANNEL = "nomi:projectAgent:command";
export const PROJECT_AGENT_RELEASE_CHANNEL = "nomi:projectAgent:release";
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
  "revision_conflict",
]);

type WireCommand = Readonly<{
  subscriptionId: string;
  clientCommandId: string;
  knownRevision: number;
  type: ProjectAgentMutation["type"] | "tool.decision";
  payload: unknown;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAgentIpcInputError("Project Agent IPC payload must be an object");
  }
  return value as Record<string, unknown>;
}

type SubscriptionOwner = Readonly<{ sender: WebContents | undefined; frame: WebFrameMain | undefined }>;

function executionEnqueueField(value: unknown): Readonly<{
  payload: Extract<ProjectAgentMutation, { type: "turn.enqueue" }>["payload"];
  request: AgentChatRequest;
}> {
  const record = asRecord(value);
  exactKeys(record, ["thread", "turn", "userItem", "queueItem", "request"]);
  return Object.freeze({
    payload: {
      thread: record.thread,
      turn: record.turn,
      userItem: record.userItem,
      queueItem: record.queueItem,
    } as Extract<ProjectAgentMutation, { type: "turn.enqueue" }>["payload"],
    request: record.request as AgentChatRequest,
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
    /** Main-only migration hook; it runs after sender/binding verification and before open. */
    prepareProject?: (binding: ProjectBinding) => void | Promise<void>;
  }>,
): void {
  const subscriptionOwners = new Map<string, SubscriptionOwner>();
  const unsubscribeEvents = new Map<string, () => void>();
  const assertSubscriptionOwner = (event: IpcMainInvokeEvent, subscriptionId: string): void => {
    const owner = subscriptionOwners.get(subscriptionId);
    if (!owner || event.sender !== owner.sender || event.senderFrame !== owner.frame) {
      throw new ProjectAgentIpcInputError("Project Agent subscription owner mismatch");
    }
  };
  registerHandler(PROJECT_AGENT_OPEN_CHANNEL, async (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["binding"]);
    const binding = bindingField(request.binding);
    // Surface capture proves the binding belongs to this live main-frame
    // owner. The opaque port remains owned by the app-main lifecycle.
    let canvasRead: PiCanvasReadTransportAdapter | undefined;
    let subscription;
    try {
      canvasRead = input.captureCanvasRead
        ? input.captureCanvasRead(event, binding, `project-agent-open-${binding.projectId}`)
        : (input.surfaceCapture.captureCanvasReadPort(event, binding), undefined);
      await input.prepareProject?.(binding);
      subscription = input.runtime.executionCoordinator.open(binding, canvasRead ? { canvasRead } : undefined);
    } catch (error) {
      canvasRead?.dispose();
      throw error;
    }
    subscriptionOwners.set(subscription.subscriptionId, {
      sender: event.sender,
      frame: event.senderFrame ?? undefined,
    });
    const subscribe = input.runtime.executionCoordinator.subscribe;
    if (subscribe) {
      const unsubscribe = subscribe.call(
        input.runtime.executionCoordinator,
        subscription.subscriptionId,
        (notification: ProjectAgentExecutionEvent) => {
          const frame = event.senderFrame;
          if (!frame || frame.detached || frame.isDestroyed()) return;
          if (notification.type === "patch") frame.send(PROJECT_AGENT_PATCH_CHANNEL, notification.patch);
          else frame.send(PROJECT_AGENT_EVENT_CHANNEL, notification);
        },
      );
      unsubscribeEvents.set(subscription.subscriptionId, unsubscribe);
    }
    return { subscriptionId: subscription.subscriptionId, snapshot: subscription.snapshot };
  });

  registerHandler(PROJECT_AGENT_SNAPSHOT_CHANNEL, (event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    assertSubscriptionOwner(event, subscriptionId);
    return input.runtime.executionCoordinator.snapshot(subscriptionId);
  });

  registerHandler(PROJECT_AGENT_COMMAND_CHANNEL, (event, raw) => {
    const command = commandField(raw);
    assertSubscriptionOwner(event, command.subscriptionId);
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
      return input.runtime.executionCoordinator.enqueue(command.subscriptionId, {
        mutation: { ...mutation, payload: execution.payload } as Extract<
          ProjectAgentMutation,
          { type: "turn.enqueue" }
        >,
        request: execution.request,
      });
    }
    return input.runtime.executionCoordinator.dispatch(command.subscriptionId, mutation);
  });

  registerHandler(PROJECT_AGENT_RELEASE_CHANNEL, (_event, raw) => {
    const request = asRecord(raw);
    exactKeys(request, ["subscriptionId"]);
    const subscriptionId = stringField(request.subscriptionId, "subscriptionId");
    assertSubscriptionOwner(_event, subscriptionId);
    unsubscribeEvents.get(subscriptionId)?.();
    unsubscribeEvents.delete(subscriptionId);
    subscriptionOwners.delete(subscriptionId);
    input.runtime.executionCoordinator.release(subscriptionId);
    return { released: true };
  });

  // Patch delivery is command-result based in the first transport slice. The
  // channel is reserved so later streaming subscribers cannot create a second
  // writer or invent a parallel state protocol.
  void PROJECT_AGENT_PATCH_CHANNEL;
}
