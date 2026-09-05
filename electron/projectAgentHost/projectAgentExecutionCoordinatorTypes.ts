import type { AgentChatRequest, AgentChatResponse, AgentChatToolDecision, AgentToolProfile } from "../harness/agentChatContracts";
import type { ProjectAgentExecutionRequest } from "../shared/contracts/agentChatContracts";
export type { ProjectAgentExecutionRequest };
import type { AgentChatV2Hooks } from "../ai/agentChatV2";
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentMutation,
  ProjectAgentHostState,
  ProjectAgentTurn,
  ProjectAgentQueueItem,
  ProjectBinding,
  ProjectAgentStatus,
  ProjectAgentAssistantTextAnchor,
} from "../shared/projectAgentContracts";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter } from "../capabilityCore/documentWriteTransportAdapters";
import type { PiCanvasWriteTransportAdapter } from "../capabilityCore/canvasWriteTransportAdapters";
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter } from "../capabilityCore/timelineTransportAdapters";
import type { PiPhase4SurfaceTransportAdapter } from "../capabilityCore/phase4SurfaceTransportAdapters";
import type { PiSkillWriteTransportAdapter } from "../capabilityCore/skillWriteTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import type { PiProductionRunTransportAdapter } from "../capabilityCore/productionRunTransportAdapters";
import type { PiGenerationTransportAdapter } from "../capabilityCore/generationTransportAdapters";
import type {
  ProjectAgentProposalReceiptView,
} from "../shared/projectAgentProposalReceipt";
import type { ProjectAgentProposalReceiptService } from "./projectAgentProposalReceiptStore";

export type ProjectAgentSubscription = Readonly<{
  subscriptionId: string;
  subscriptionEpoch: number;
  binding: ProjectBinding;
  snapshot: ProjectAgentHostState;
}>;
export type ProjectAgentProposalReceiptReader = () => ProjectAgentProposalReceiptView | null;
export type ProjectAgentProposalReceiptWriter = Pick<ProjectAgentProposalReceiptService, "read" | "write" | "transition">;
export type ProjectAgentExecutionOpenOptions = Readonly<{
  canvasRead?: PiCanvasReadTransportAdapter;
  documentRead?: PiDocumentReadTransportAdapter;
  documentWrite?: PiDocumentWriteTransportAdapter;
  canvasWrite?: PiCanvasWriteTransportAdapter;
  timelineRead?: PiTimelineReadTransportAdapter;
  timelineWrite?: PiTimelineWriteTransportAdapter;
  phase4Surface?: PiPhase4SurfaceTransportAdapter;
  skillRead?: PiSkillReadTransportAdapter;
  skillWrite?: PiSkillWriteTransportAdapter;
  proposalReceipt?: ProjectAgentProposalReceiptReader;
  /** Main-owned writer. Renderer clients only receive the read/undo IPC seam. */
  proposalReceiptWriter?: ProjectAgentProposalReceiptWriter;
}>;
export type ProjectAgentTurnCompletedInput = Readonly<{
  binding: ProjectBinding;
  turnId: string;
  executionToken: string;
  request: AgentChatRequest;
  response: AgentChatResponse;
  state: ProjectAgentHostState;
  completedAt: string;
}>;
export type ProjectAgentExecutionCoordinatorDeps = Readonly<{
  runAgent?: (request: AgentChatRequest, hooks: AgentChatV2Hooks) => Promise<AgentChatResponse>;
  /** Local-only observer invoked after Host commits a terminal successful turn. */
  onTurnCompleted?: (input: ProjectAgentTurnCompletedInput) => void | Promise<void>;
  now?: () => string;
  reportInternalError?: (
    error: unknown,
    context: Readonly<{ phase: "start" | "terminalize-runtime-failure"; turnId: string; message: string }>,
  ) => void;
  productionRun?: (binding: ProjectBinding) => PiProductionRunTransportAdapter;
  generation?: (binding: ProjectBinding) => PiGenerationTransportAdapter;
}>;
export function readProposalReceiptSafely(
  reader: ProjectAgentProposalReceiptReader | undefined,
): ProjectAgentProposalReceiptView | null {
  try {
    return reader?.() ?? null;
  } catch {
    return null;
  }
}
export type ProjectAgentExecutionEnqueue = Readonly<{
  mutation: Extract<ProjectAgentMutation, { type: "turn.enqueue" }>;
  request: ProjectAgentExecutionRequest;
  canvasRead?: PiCanvasReadTransportAdapter;
}>;
export type ProjectAgentExecutionListener = (event: ProjectAgentExecutionEvent) => void;
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};
export type PendingToolDecision = Readonly<{
  turnId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  assistantTextAnchor?: ProjectAgentAssistantTextAnchor;
  resolve: (decision: AgentChatToolDecision) => void;
  signal: AbortSignal;
}>;
export type ActiveExecution = {
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
  /** Latched only after the user approves one reversible write in this turn. */
  safeApprovalGranted?: boolean;
  canvasRead?: PiCanvasReadTransportAdapter;
  /** Latest user steering instruction, consumed before the next model request. */
  steering?: string;
};
export function recordProposalSettlement(
  execution: ActiveExecution,
  approvalId: string,
  status: ProjectAgentStatus,
): void {
  execution.proposalSettlementStatuses ??= new Map();
  execution.proposalSettlementStatuses.set(approvalId, status);
}

export function proposalSettlementsFor(
  execution: ActiveExecution,
  fallbackStatus: ProjectAgentStatus,
): readonly Readonly<{ approvalId: string; status: ProjectAgentStatus }>[] {
  return (execution.approvedProposalIds ?? []).map((approvalId) => Object.freeze({
    approvalId,
    status: execution.proposalSettlementStatuses?.get(approvalId) ?? fallbackStatus,
  }));
}

export const CANVAS_WRITE_OUTCOMES = Object.freeze({
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
  capability_input_invalid: {
    status: "failed",
    retryable: true,
    nextAction: "correct the proposal parameters and submit it again",
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
  capability_execution_failed: {
    status: "failed",
    retryable: true,
    nextAction: "review the error and submit the capability again",
  },
  capability_authority_invalid: {
    status: "failed",
    retryable: false,
    nextAction: "start a new approved proposal",
  },
} as const);

export type CanvasWriteCapabilityOutcomeCode = keyof typeof CANVAS_WRITE_OUTCOMES;
export type CanvasWriteCapabilityOutcome = Readonly<{
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
export function rememberCanvasWriteOutcome(
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
export type FrozenExecutionRequest = Readonly<{
  request: AgentChatRequest;
  requestDigest: string;
  preferredSubscriptionId: string;
  canvasRead?: PiCanvasReadTransportAdapter;
}>;
export type SubscriptionDelivery = {
  phase: "pre-live" | "activating" | "live";
  listeners: Set<ProjectAgentExecutionListener>;
  buffered: ProjectAgentExecutionEvent[];
};
export type ExecutionPartition = {
  partitionKey: string;
  binding: ProjectBinding;
  host: OfflineProjectAgentHost;
  subscriptionIds: Set<string>;
  requests: Map<string, FrozenExecutionRequest>;
  toolProfiles: Map<string, AgentToolProfile>;
  active: Map<string, ActiveExecution>;
  completions: Map<string, Deferred<ProjectAgentHostState>>;
  initialization: Promise<void>;
  drain?: Promise<void>;
  steering: Map<string, string>;
};
export function deferred<T>(): Deferred<T> {
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
  /** Queue a direction change for the current turn; it never rewrites a committed effect. */
  steer: (subscriptionId: string, turnId: string, instruction: string) => Promise<void>;
  /** Interrupt a turn through the Host transition and abort the replaceable loop. */
  interrupt: (subscriptionId: string, turnId: string) => Promise<void>;
  waitForTurn: (subscriptionId: string, turnId: string) => Promise<ProjectAgentHostState>;
  release: (subscriptionId: string) => void;
  setGenerationAdapterFactory: (factory: ((binding: ProjectBinding) => PiGenerationTransportAdapter) | undefined) => void;
  subscriptionCount: () => number;
}>;

export class ProjectAgentSubscriptionError extends Error {
  readonly code = "project_agent_subscription_invalid" as const;
}
export type SubscriptionRecord = ProjectAgentSubscription & Readonly<{ partitionKey: string }>;
