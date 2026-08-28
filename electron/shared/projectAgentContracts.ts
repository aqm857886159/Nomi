import type { PreconditionSet, TargetRef, TaskRef } from "./capabilityTargeting";
import type { ProjectBinding } from "./projectBinding";
import type { AgentChatResponse } from "../harness/agentChatContracts";

export type { DocumentAnchorRef, PreconditionSet, TargetRef, TaskRef } from "./capabilityTargeting";
export type { ProjectBinding } from "./projectBinding";

export const PROJECT_AGENT_STATUSES = [
  "drafting",
  "proposed",
  "declined",
  "queued",
  "running",
  "done",
  "failed",
  "stopped",
] as const;

export type ProjectAgentStatus = (typeof PROJECT_AGENT_STATUSES)[number];

export function isProjectAgentLiveStatus(status: ProjectAgentStatus): boolean {
  return status === "drafting" || status === "proposed" || status === "queued" || status === "running";
}

export const PROJECT_AGENT_ITEM_KINDS = [
  "user",
  "assistant",
  "tool",
  "proposal",
  "task",
  "artifact",
  "failure",
] as const;

export type ProjectAgentItemKind = (typeof PROJECT_AGENT_ITEM_KINDS)[number];

export const PROJECT_AGENT_PROPOSAL_LIFECYCLES = ["pending", "claimed", "expired"] as const;

export type ProjectAgentProposalLifecycle = (typeof PROJECT_AGENT_PROPOSAL_LIFECYCLES)[number];

export const PROJECT_AGENT_ORIGIN_SURFACE_KINDS = ["project", "document", "canvas", "preview", "timeline"] as const;

export type ProjectAgentOriginSurfaceKind = (typeof PROJECT_AGENT_ORIGIN_SURFACE_KINDS)[number];

export const PROJECT_AGENT_SENDER_KINDS = ["renderer", "embedded-agent", "internal"] as const;

export type ProjectAgentSenderKind = (typeof PROJECT_AGENT_SENDER_KINDS)[number];

export type ProjectAgentSender = Readonly<{
  kind: ProjectAgentSenderKind;
  senderId: string;
}>;

export const PROJECT_AGENT_MUTATION_TYPES = [
  "thread.put",
  "thread.remove",
  "thread.activate",
  "turn.enqueue",
  "queue.edit",
  "turn.start",
  "assistant.append",
  "turn.transition",
  "execution.recover",
  "item.put",
  "item.transition",
  "proposal.put",
  "proposal.transition",
  "async.result",
] as const;

export type ProjectAgentMutationType = (typeof PROJECT_AGENT_MUTATION_TYPES)[number];

export const PROJECT_AGENT_RECENT_COMMAND_LIMIT = 64;
export const PROJECT_AGENT_ASSISTANT_DELTA_MAX_CHARS = 16_384;

export type ProposalApprovalRef = Readonly<{
  approvalId: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  actionHash: string;
  target: TargetRef;
  preconditions: PreconditionSet;
  expiresAt: string;
}>;

/** Display-only reference. Receipt state remains owned by the existing authority/ProductionRun. */
export type HumanApprovalRef = Readonly<{
  challengeId: string;
  handoffId: string;
  binding: ProjectBinding;
  runId: string;
  gateId: string;
  contractHash: string;
}>;

export type ProjectAgentContextBinding = Readonly<{
  project: ProjectBinding;
  threadId: string;
  sessionKey: `nomi:project-agent:${string}:g${number}`;
}>;

export type ProjectAgentContextRef = Readonly<{
  binding: ProjectAgentContextBinding;
  contextRevision: number;
  recordId: string;
}>;

export type LegacyContextSourceRef = Readonly<{
  legacyArea: "creation" | "generation";
  legacySessionKey: string;
  legacyThreadId: string;
  sourceHash: string;
}>;

export type ProjectAgentThreadProvenance =
  | Readonly<{ kind: "canonical" }>
  | Readonly<{ kind: "legacy"; readOnly: true; source: LegacyContextSourceRef }>;

export type ProjectAgentVersionRef = Readonly<{
  id: string;
  version: string | number;
}>;

/** Untrusted renderer claim. Main resolves every other attachment field. */
export type ProjectAgentAttachmentClaim = Readonly<{
  assetId: string;
  version: number;
}>;

export type ProjectAgentAttachmentRef = Readonly<{
  assetId: string;
  contentHash: string;
  version?: number;
  /** Immutable display snapshot. Asset identity remains assetId + contentHash. */
  display?: Readonly<{
    url: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    kind: "image" | "file";
  }>;
}>;

export type ProjectAgentOriginSurfaceRef = Readonly<{
  surfaceId: string;
  kind: ProjectAgentOriginSurfaceKind;
}>;

type ProjectAgentRecordBase = Readonly<{
  status: ProjectAgentStatus;
  retryable: boolean;
  deviated: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ProjectAgentThread = Readonly<{
  threadId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy threads are immutable archive records; absence means a canonical thread. */
  provenance?: ProjectAgentThreadProvenance;
}>;

export type ProjectAgentTurn = ProjectAgentRecordBase &
  Readonly<{
    turnId: string;
    threadId: string;
    executionToken: string;
    model: ProjectAgentVersionRef;
    skillVersions: readonly ProjectAgentVersionRef[];
    capabilityVersions: readonly ProjectAgentVersionRef[];
    contextRef: ProjectAgentContextRef;
  }>;

type ProjectAgentItemBase = ProjectAgentRecordBase &
  Readonly<{
    itemId: string;
    threadId: string;
    turnId: string;
    parentItemId?: string;
    correlationId?: string;
  }>;

export type ProjectAgentUserItem = ProjectAgentItemBase & Readonly<{ kind: "user"; text: string }>;

export type ProjectAgentAssistantItem = ProjectAgentItemBase &
  Readonly<{ kind: "assistant"; text: string; textRevision: number }>;

export type ProjectAgentToolItem = ProjectAgentItemBase &
  Readonly<{
    kind: "tool";
    toolCallId: string;
    invocationId: string;
    /** Optional legacy transcript text; live tool results remain ref-only. */
    text?: string;
    capability: ProjectAgentVersionRef;
    resultRef?: string;
  }>;

export type ProjectAgentProposalItem =
  | (ProjectAgentItemBase & Readonly<{ kind: "proposal"; approval: ProposalApprovalRef; humanApproval?: never }>)
  | (Omit<ProjectAgentItemBase, "status" | "retryable" | "deviated"> &
      Readonly<{
        kind: "proposal";
        approval?: never;
        humanApproval: HumanApprovalRef;
        status: "done";
        retryable: false;
        deviated: false;
      }>);

/** Task truth remains in ProductionRun. This item intentionally owns only TaskRef. */
export type ProjectAgentTaskItem = Omit<ProjectAgentItemBase, "status" | "retryable" | "deviated"> &
  Readonly<{
    kind: "task";
    task: TaskRef;
    /** Local card creation is complete; ProductionRun status is read only from its projection. */
    status: "done";
    retryable: false;
    deviated: false;
  }>;

export type ProjectAgentArtifactRef = Readonly<{
  runId: string;
  artifactId: string;
  version: number;
  contentHash: string;
  resultId?: string;
}>;

export type ProjectAgentArtifactItem = ProjectAgentItemBase &
  Readonly<{ kind: "artifact"; artifact: ProjectAgentArtifactRef }>;

export type ProjectAgentFailureItem = ProjectAgentItemBase &
  Readonly<{
    kind: "failure";
    code: string;
    message: string;
    nextAction?: string;
  }>;

export type ProjectAgentItem =
  | ProjectAgentUserItem
  | ProjectAgentAssistantItem
  | ProjectAgentToolItem
  | ProjectAgentProposalItem
  | ProjectAgentTaskItem
  | ProjectAgentArtifactItem
  | ProjectAgentFailureItem;

export type ProjectAgentQueueItem = Omit<ProjectAgentRecordBase, "createdAt"> &
  Readonly<{
    queueItemId: string;
    threadId: string;
    turnId: string;
    binding: ProjectBinding;
    target: TargetRef;
    preconditions: PreconditionSet;
    contextRef: ProjectAgentContextRef;
    model: ProjectAgentVersionRef;
    skillVersions: readonly ProjectAgentVersionRef[];
    capabilityVersions: readonly ProjectAgentVersionRef[];
    policyRevision: number;
    attachmentRefs: readonly ProjectAgentAttachmentRef[];
    originSurface: ProjectAgentOriginSurfaceRef;
    enqueuedAt: string;
  }>;

export type ProjectAgentProposalApproval = Readonly<{
  ref: ProposalApprovalRef;
  lifecycle: ProjectAgentProposalLifecycle;
  claimedAt?: string;
  expiredAt?: string;
}>;

export type ProjectAgentChange =
  | Readonly<{ kind: "thread-upserted"; thread: ProjectAgentThread }>
  | Readonly<{ kind: "thread-removed"; threadId: string }>
  | Readonly<{ kind: "active-thread-changed"; activeThreadId: string | null }>
  | Readonly<{ kind: "turn-upserted"; turn: ProjectAgentTurn }>
  | Readonly<{ kind: "turn-removed"; turnId: string }>
  | Readonly<{ kind: "item-upserted"; item: ProjectAgentItem }>
  | Readonly<{ kind: "item-removed"; itemId: string }>
  | Readonly<{ kind: "queue-upserted"; queueItem: ProjectAgentQueueItem }>
  | Readonly<{ kind: "queue-removed"; queueItemId: string }>
  | Readonly<{ kind: "proposal-upserted"; approval: ProjectAgentProposalApproval }>
  | Readonly<{ kind: "proposal-removed"; approvalId: string }>;

export type ProjectAgentPatch = Readonly<{
  binding: ProjectBinding;
  hostRevision: number;
  previousRevision: number;
  changes: readonly ProjectAgentChange[];
}>;

export type ProjectAgentCompactCommandReceipt = Readonly<{
  commandId: string;
  mutationHash: string;
  appliedRevision: number;
}>;

export type ProjectAgentAppliedCommand = ProjectAgentCompactCommandReceipt &
  Readonly<{
    patch: ProjectAgentPatch;
  }>;

export type ProjectAgentHostState = Readonly<{
  binding: ProjectBinding;
  hostRevision: number;
  commandLedgerHighWater: number;
  activeThreadId: string | null;
  threads: readonly ProjectAgentThread[];
  turns: readonly ProjectAgentTurn[];
  items: readonly ProjectAgentItem[];
  queue: readonly ProjectAgentQueueItem[];
  proposalApprovals: readonly ProjectAgentProposalApproval[];
  recentAppliedCommands: readonly ProjectAgentAppliedCommand[];
}>;

export type ProjectAgentAssistantFinal = Readonly<{
  itemId: string;
  executionToken: string;
  expectedTextRevision: number;
  text: string;
}>;

export type ProjectAgentAsyncResultEnvelope = Readonly<{
  asyncToken: string;
  binding: ProjectBinding;
  threadId: string;
  turnId: string;
  queueItemId: string;
  target: TargetRef;
  preconditions: PreconditionSet;
  expectedRevision: number;
  items: readonly ProjectAgentItem[];
  turnStatus: ProjectAgentStatus;
  proposalApprovalId?: string;
  proposalStatus?: ProjectAgentStatus;
  assistantFinal?: ProjectAgentAssistantFinal;
  receivedAt: string;
}>;

/** Immutable UTF-16 position in the canonical Host Assistant Item. */
export type ProjectAgentAssistantTextAnchor = Readonly<{ itemId: string; textOffset: number }>;

export type ProjectAgentSubscriptionIdentity = Readonly<{
  subscriptionId: string;
  subscriptionEpoch: number;
}>;

/** Live execution notifications are transport events, not a second state owner. */
export type ProjectAgentExecutionEventPayload =
  | Readonly<{
      type: "patch";
      patch: ProjectAgentPatch;
    }>
  | Readonly<{
      type: "tool-call";
      binding: ProjectBinding;
      turnId: string;
      executionToken: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      /** Non-owning render anchor captured after all pre-tool deltas commit. */
      assistantTextAnchor?: ProjectAgentAssistantTextAnchor;
    }>
  | Readonly<{
      type: "execution-error";
      binding: ProjectBinding;
      turnId: string;
      executionToken: string;
      message: string;
    }>
  | Readonly<{
      /** Runtime metadata published only after the Host owns a terminal turn. */
      type: "execution-result";
      binding: ProjectBinding;
      turnId: string;
      executionToken: string;
      response: AgentChatResponse;
    }>;

type WithProjectAgentSubscriptionIdentity<Event> = Event extends unknown
  ? Readonly<Event & ProjectAgentSubscriptionIdentity>
  : never;

export type ProjectAgentExecutionEvent = WithProjectAgentSubscriptionIdentity<ProjectAgentExecutionEventPayload>;

type ProjectAgentMutationEnvelope<Type extends string, Payload> = Readonly<{
  commandId: string;
  expectedRevision: number;
  binding: ProjectBinding;
  sender: ProjectAgentSender;
  type: Type;
  payload: Payload;
}>;

export type ProjectAgentMutation =
  | ProjectAgentMutationEnvelope<"thread.put", Readonly<{ thread: ProjectAgentThread; makeActive?: boolean }>>
  | ProjectAgentMutationEnvelope<
      "thread.remove",
      Readonly<{
        threadId: string;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "thread.activate",
      Readonly<{
        threadId: string;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "turn.enqueue",
      Readonly<{
        thread: ProjectAgentThread;
        turn: ProjectAgentTurn;
        userItem: ProjectAgentUserItem;
        queueItem: ProjectAgentQueueItem;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "queue.edit",
      Readonly<{
        queueItemId: string;
        userItemId: string;
        text: string;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "turn.start",
      Readonly<{
        turnId: string;
        queueItemId: string;
        assistantItem: ProjectAgentAssistantItem;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "assistant.append",
      Readonly<{
        turnId: string;
        itemId: string;
        executionToken: string;
        expectedTextRevision: number;
        delta: string;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "turn.transition",
      Readonly<{
        turnId: string;
        status: ProjectAgentStatus;
        retryable?: boolean;
        deviated?: boolean;
        updatedAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "execution.recover",
      Readonly<{
        turnId: string;
        failure: ProjectAgentFailureItem;
        recoveredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<"item.put", Readonly<{ item: ProjectAgentItem }>>
  | ProjectAgentMutationEnvelope<
      "item.transition",
      Readonly<{
        itemId: string;
        status: ProjectAgentStatus;
        retryable?: boolean;
        deviated?: boolean;
        updatedAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "proposal.put",
      Readonly<{
        approval: ProjectAgentProposalApproval;
        item: ProjectAgentProposalItem;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<
      "proposal.transition",
      Readonly<{
        approvalId: string;
        lifecycle: ProjectAgentProposalLifecycle;
        occurredAt: string;
      }>
    >
  | ProjectAgentMutationEnvelope<"async.result", ProjectAgentAsyncResultEnvelope>;
