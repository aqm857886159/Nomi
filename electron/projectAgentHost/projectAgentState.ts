import type { ProjectBinding } from "../shared/projectBinding";
import type {
  HumanApprovalRef,
  ProjectAgentAppliedCommand,
  ProjectAgentApprovalPolicy,
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentProposalApproval,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProposalApprovalRef,
  TaskRef,
} from "../shared/projectAgentContracts";
import {
  PROJECT_AGENT_ITEM_KINDS,
  PROJECT_AGENT_WORK_MODES,
  PROJECT_AGENT_APPROVAL_MODES,
  PROJECT_AGENT_SPEND_POLICIES,
  projectAgentApprovalPolicyOf,
  projectAgentWorkModeOf,
  PROJECT_AGENT_ORIGIN_SURFACE_KINDS,
  PROJECT_AGENT_PROPOSAL_LIFECYCLES,
  PROJECT_AGENT_RECENT_COMMAND_LIMIT,
} from "../shared/projectAgentContracts";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "./projectAgentIdentity";
import { ProjectAgentSnapshotError, freezeProjectAgentSnapshot, stableProjectAgentJson } from "./projectAgentSnapshot";
import { assertContextRef, assertPreconditions, assertTarget } from "./projectAgentReferenceValidation";
import { assertProjectAgentAssistantLifecycle } from "./projectAgentAssistantStateInvariant";
import { ProjectAgentStateError } from "./projectAgentStateError";
import {
  isProjectAgentClaimedProposalItemStatus,
  isProjectAgentLiveProposalItemStatus,
} from "./projectAgentStatusSemantics";
import { assertTrustedProjectAgentDelta } from "./projectAgentTrustedStateValidation";
import { assertTrustedProjectAgentDeltaCoverage } from "./projectAgentTrustedDeltaCoverage";
import {
  hasDuplicateProjectAgentApprovalIdentity,
  hasDuplicateProjectAgentArtifactIdentity,
  hasDuplicateProjectAgentProposalReceiptIdentity,
  hasDuplicateProjectAgentToolIdentity,
} from "./projectAgentSemanticIdentity";
import {
  asRecord,
  assertAllowedKeys,
  assertCanonicalTimestamp, assertCanonicalId, assertNonEmpty,
  assertSafeInteger, assertSkillLoadReference, assertProjectAgentUsage,
  assertStatusRecord,
  assertTimestampOrder,
  assertVersionRef,
  assertVersionRefs,
} from "./projectAgentStateValidationPrimitives";

export { assertProjectAgentBinding, projectAgentPartitionKey, sameProjectAgentBinding } from "./projectAgentIdentity";
export { freezeProjectAgentSnapshot, stableProjectAgentJson } from "./projectAgentSnapshot";
export { ProjectAgentStateError } from "./projectAgentStateError";
export { isProjectAgentStatus } from "./projectAgentStateValidationPrimitives";

const ITEM_KIND_SET = new Set<string>(PROJECT_AGENT_ITEM_KINDS);
const WORK_MODE_SET = new Set<string>(PROJECT_AGENT_WORK_MODES);
const ORIGIN_SURFACE_KIND_SET = new Set<string>(PROJECT_AGENT_ORIGIN_SURFACE_KINDS);
const PROPOSAL_LIFECYCLE_SET = new Set<string>(PROJECT_AGENT_PROPOSAL_LIFECYCLES);
const APPROVAL_MODE_SET = new Set<string>(PROJECT_AGENT_APPROVAL_MODES);
const SPEND_POLICY_SET = new Set<string>(PROJECT_AGENT_SPEND_POLICIES);
type TrustedCommandIndex = Map<string, ProjectAgentAppliedCommand>;
const trustedStates = new WeakSet<object>();
const trustedCommandIndexes = new WeakMap<object, TrustedCommandIndex>();
let fullValidationCount = 0;

function assertApprovalPolicy(value: unknown): asserts value is ProjectAgentApprovalPolicy {
  const policy = asRecord(value);
  assertAllowedKeys(policy, ["mode", "spend"]);
  if (!APPROVAL_MODE_SET.has(String(policy.mode)) || !SPEND_POLICY_SET.has(String(policy.spend))) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

function assertWorkMode(value: unknown): void {
  if (!WORK_MODE_SET.has(String(value))) throw new ProjectAgentStateError("invalid_state");
}

function assertThread(value: unknown): asserts value is ProjectAgentThread {
  const thread = asRecord(value);
  assertAllowedKeys(thread, ["threadId", "title", "createdAt", "updatedAt"]);
  assertCanonicalId(thread.threadId);
  if (thread.title !== undefined) assertNonEmpty(thread.title);
  assertCanonicalTimestamp(thread.createdAt);
  assertCanonicalTimestamp(thread.updatedAt);
  assertTimestampOrder(thread.createdAt, thread.updatedAt);
}

function assertTurn(
  value: unknown,
  binding: ProjectBinding,
  threadIds: ReadonlySet<string>,
): asserts value is ProjectAgentTurn {
  const turn = asRecord(value);
  assertAllowedKeys(turn, [
    "turnId",
    "threadId",
    "status",
    "retryable",
    "deviated",
    "executionToken",
    "model",
    "workMode",
    "approvalPolicy",
    "usage",
    "skillVersions",
    "capabilityVersions",
    "contextRef",
    "createdAt",
    "updatedAt",
  ]);
  assertCanonicalId(turn.turnId);
  assertCanonicalId(turn.threadId);
  if (!threadIds.has(turn.threadId)) throw new ProjectAgentStateError("invalid_state");
  assertStatusRecord(turn);
  assertCanonicalId(turn.executionToken);
  assertVersionRef(turn.model);
  if (turn.workMode !== undefined) assertWorkMode(turn.workMode);
  if (turn.approvalPolicy !== undefined) assertApprovalPolicy(turn.approvalPolicy);
  if (turn.usage !== undefined) assertProjectAgentUsage(turn.usage);
  assertVersionRefs(turn.skillVersions);
  assertVersionRefs(turn.capabilityVersions);
  assertContextRef(turn.contextRef, binding, turn.threadId);
  assertCanonicalTimestamp(turn.createdAt);
  assertCanonicalTimestamp(turn.updatedAt);
  assertTimestampOrder(turn.createdAt, turn.updatedAt);
}

function assertTaskRef(value: unknown): asserts value is TaskRef {
  const task = asRecord(value);
  if (task.kind === "production-run") {
    assertAllowedKeys(task, ["kind", "runId", "expectedRunRevision", "stageId", "jobId", "shotId"]);
    assertNonEmpty(task.runId);
    if (task.expectedRunRevision !== undefined) assertSafeInteger(task.expectedRunRevision);
    for (const key of ["stageId", "jobId", "shotId"] as const) {
      if (task[key] !== undefined) assertNonEmpty(task[key]);
    }
    return;
  }
  if (task.kind === "export-job") {
    assertAllowedKeys(task, ["kind", "jobId"]);
    assertNonEmpty(task.jobId);
    return;
  }
  throw new ProjectAgentStateError("invalid_state");
}

function assertHumanApprovalRef(value: unknown, binding: ProjectBinding): asserts value is HumanApprovalRef {
  const approval = asRecord(value);
  assertAllowedKeys(approval, ["challengeId", "handoffId", "binding", "runId", "gateId", "contractHash"]);
  for (const key of ["challengeId", "handoffId", "runId", "gateId", "contractHash"] as const) {
    assertNonEmpty(approval[key]);
  }
  assertProjectAgentBinding(approval.binding as ProjectBinding);
  if (!sameProjectAgentBinding(approval.binding as ProjectBinding, binding)) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

function assertProposalApprovalRef(value: unknown): asserts value is ProposalApprovalRef {
  const approval = asRecord(value);
  assertAllowedKeys(approval, [
    "approvalId",
    "receiptProposalId",
    "threadId",
    "turnId",
    "toolCallId",
    "policyRevision",
    "inputHash",
    "actionHash",
    "target",
    "preconditions",
    "expiresAt",
  ]);
  for (const key of [
    "approvalId",
    "receiptProposalId",
    "threadId",
    "turnId",
    "toolCallId",
    "inputHash",
    "actionHash",
  ] as const) {
    assertCanonicalId(approval[key]);
  }
  assertSafeInteger(approval.policyRevision);
  assertCanonicalTimestamp(approval.expiresAt);
  assertTarget(approval.target);
  assertPreconditions(approval.preconditions);
}

const ITEM_BASE_KEYS = [
  "kind",
  "itemId",
  "threadId",
  "turnId",
  "status",
  "retryable",
  "deviated",
  "parentItemId",
  "correlationId",
  "createdAt",
  "updatedAt",
] as const;

function assertItem(
  value: unknown,
  binding: ProjectBinding,
  threadIds: ReadonlySet<string>,
  turnIds: ReadonlySet<string>,
): asserts value is ProjectAgentItem {
  const item = asRecord(value);
  if (!ITEM_KIND_SET.has(String(item.kind))) throw new ProjectAgentStateError("invalid_state");
  const extraKeys: Record<string, readonly string[]> = {
    user: ["text"],
    assistant: ["text", "textRevision"],
    tool: ["toolCallId", "invocationId", "text", "capability", "resultRef", "skillLoad"],
    proposal: ["approval", "humanApproval"],
    task: ["task"],
    artifact: ["artifact"],
    failure: ["code", "message", "nextAction"],
  };
  assertAllowedKeys(item, [...ITEM_BASE_KEYS, ...extraKeys[String(item.kind)]!]);
  assertCanonicalId(item.itemId);
  assertCanonicalId(item.threadId);
  assertCanonicalId(item.turnId);
  if (!threadIds.has(item.threadId) || !turnIds.has(item.turnId)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertStatusRecord(item);
  if (item.parentItemId !== undefined) assertCanonicalId(item.parentItemId);
  if (item.correlationId !== undefined) assertCanonicalId(item.correlationId);
  assertCanonicalTimestamp(item.createdAt);
  assertCanonicalTimestamp(item.updatedAt);
  assertTimestampOrder(item.createdAt, item.updatedAt);
  switch (item.kind) {
    case "user":
      assertNonEmpty(item.text);
      break;
    case "assistant":
      if (typeof item.text !== "string") throw new ProjectAgentStateError("invalid_state");
      assertSafeInteger(item.textRevision);
      break;
    case "tool":
      assertNonEmpty(item.toolCallId);
      assertNonEmpty(item.invocationId);
      if (item.text !== undefined && typeof item.text !== "string") throw new ProjectAgentStateError("invalid_state"); assertVersionRef(item.capability);
      if (item.resultRef !== undefined) assertNonEmpty(item.resultRef);
      if (item.skillLoad !== undefined) { if ((item.capability as { id?: unknown }).id !== "skill.read") throw new ProjectAgentStateError("invalid_state"); assertSkillLoadReference(item.skillLoad); }
      break;
    case "proposal":
      if ((item.approval === undefined) === (item.humanApproval === undefined)) {
        throw new ProjectAgentStateError("invalid_state");
      }
      if (item.approval !== undefined) assertProposalApprovalRef(item.approval);
      if (item.humanApproval !== undefined) assertHumanApprovalRef(item.humanApproval, binding);
      if (item.humanApproval !== undefined && (item.status !== "done" || item.retryable || item.deviated)) {
        throw new ProjectAgentStateError("invalid_state");
      }
      break;
    case "task":
      assertTaskRef(item.task);
      if (item.status !== "done" || item.retryable || item.deviated) {
        throw new ProjectAgentStateError("invalid_state");
      }
      break;
    case "artifact": {
      const artifact = asRecord(item.artifact);
      assertAllowedKeys(artifact, ["runId", "artifactId", "version", "contentHash", "resultId"]);
      assertNonEmpty(artifact.runId);
      assertNonEmpty(artifact.artifactId);
      assertSafeInteger(artifact.version, 1);
      assertNonEmpty(artifact.contentHash);
      if (artifact.resultId !== undefined) assertNonEmpty(artifact.resultId);
      break;
    }
    case "failure":
      assertNonEmpty(item.code);
      assertNonEmpty(item.message);
      if (item.nextAction !== undefined) assertNonEmpty(item.nextAction);
      break;
  }
}

function assertQueueItem(
  value: unknown,
  binding: ProjectBinding,
  threadIds: ReadonlySet<string>,
  turnIds: ReadonlySet<string>,
): asserts value is ProjectAgentQueueItem {
  const item = asRecord(value);
  assertAllowedKeys(item, [
    "queueItemId",
    "threadId",
    "turnId",
    "status",
    "retryable",
    "deviated",
    "binding",
    "target",
    "preconditions",
    "contextRef",
    "model",
    "workMode",
    "approvalPolicy",
    "skillVersions",
    "capabilityVersions",
    "policyRevision",
    "attachmentRefs",
    "originSurface",
    "enqueuedAt",
    "updatedAt",
    "paused",
  ]);
  assertCanonicalId(item.queueItemId);
  assertCanonicalId(item.threadId);
  assertCanonicalId(item.turnId);
  if (!threadIds.has(item.threadId) || !turnIds.has(item.turnId)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertStatusRecord(item);
  assertProjectAgentBinding(item.binding as ProjectBinding);
  if (!sameProjectAgentBinding(item.binding as ProjectBinding, binding)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertTarget(item.target);
  assertPreconditions(item.preconditions);
  assertContextRef(item.contextRef, binding, item.threadId);
  assertVersionRef(item.model);
  if (item.workMode !== undefined) assertWorkMode(item.workMode);
  if (item.approvalPolicy !== undefined) assertApprovalPolicy(item.approvalPolicy);
  assertVersionRefs(item.skillVersions);
  assertVersionRefs(item.capabilityVersions);
  assertSafeInteger(item.policyRevision);
  if (!Array.isArray(item.attachmentRefs)) throw new ProjectAgentStateError("invalid_state");
  for (const raw of item.attachmentRefs) {
    const attachment = asRecord(raw);
    assertAllowedKeys(attachment, ["assetId", "contentHash", "version", "display"]);
    assertNonEmpty(attachment.assetId);
    assertNonEmpty(attachment.contentHash);
    if (attachment.version !== undefined) assertSafeInteger(attachment.version, 1);
    if (attachment.display !== undefined) {
      const display = asRecord(attachment.display);
      assertAllowedKeys(display, ["url", "fileName", "contentType", "sizeBytes", "kind"]);
      assertNonEmpty(display.url);
      assertNonEmpty(display.fileName);
      assertNonEmpty(display.contentType);
      assertSafeInteger(display.sizeBytes, 0);
      if (display.kind !== "image" && display.kind !== "file") {
        throw new ProjectAgentStateError("invalid_state");
      }
    }
  }
  const origin = asRecord(item.originSurface);
  assertAllowedKeys(origin, ["surfaceId", "kind"]);
  assertNonEmpty(origin.surfaceId);
  if (!ORIGIN_SURFACE_KIND_SET.has(String(origin.kind))) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertCanonicalTimestamp(item.enqueuedAt);
  assertCanonicalTimestamp(item.updatedAt);
  if (item.paused !== undefined && typeof item.paused !== "boolean") {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (item.paused === true && item.status !== "queued") {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertTimestampOrder(item.enqueuedAt, item.updatedAt);
}

function assertProposalApproval(
  value: unknown,
  threadIds: ReadonlySet<string>,
  turnIds: ReadonlySet<string>,
): asserts value is ProjectAgentProposalApproval {
  const approval = asRecord(value);
  assertAllowedKeys(approval, ["ref", "lifecycle", "claimedAt", "expiredAt"]);
  assertProposalApprovalRef(approval.ref);
  const ref = approval.ref as ProposalApprovalRef;
  if (!threadIds.has(ref.threadId) || !turnIds.has(ref.turnId)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (!PROPOSAL_LIFECYCLE_SET.has(String(approval.lifecycle))) {
    throw new ProjectAgentStateError("invalid_state");
  }
  if (approval.claimedAt !== undefined) assertCanonicalTimestamp(approval.claimedAt);
  if (approval.expiredAt !== undefined) assertCanonicalTimestamp(approval.expiredAt);
  if (
    (approval.lifecycle === "pending" && (approval.claimedAt !== undefined || approval.expiredAt !== undefined)) ||
    (approval.lifecycle === "claimed" &&
      (approval.claimedAt === undefined ||
        approval.expiredAt !== undefined ||
        new Date(approval.claimedAt).getTime() >= new Date(ref.expiresAt).getTime())) ||
    (approval.lifecycle === "expired" &&
      (approval.expiredAt === undefined ||
        approval.claimedAt !== undefined ||
        new Date(approval.expiredAt).getTime() < new Date(ref.expiresAt).getTime()))
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

function assertUniqueIds(values: readonly unknown[], readId: (value: unknown) => string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = readId(value);
    if (seen.has(id)) throw new ProjectAgentStateError("invalid_state");
    seen.add(id);
  }
}

function assertPatchChange(
  value: unknown,
  binding: ProjectBinding,
  threadIds: ReadonlySet<string>,
  turnIds: ReadonlySet<string>,
  turnThreadById: ReadonlyMap<string, string>,
  itemTurnById: ReadonlyMap<string, string>,
): asserts value is ProjectAgentChange {
  const change = asRecord(value);
  switch (change.kind) {
    case "thread-upserted":
      assertAllowedKeys(change, ["kind", "thread"]);
      assertThread(change.thread);
      break;
    case "thread-removed":
      assertAllowedKeys(change, ["kind", "threadId"]);
      assertCanonicalId(change.threadId);
      break;
    case "active-thread-changed":
      assertAllowedKeys(change, ["kind", "activeThreadId"]);
      if (change.activeThreadId !== null) {
        assertCanonicalId(change.activeThreadId);
        if (!threadIds.has(change.activeThreadId)) throw new ProjectAgentStateError("invalid_state");
      }
      break;
    case "turn-upserted":
      assertAllowedKeys(change, ["kind", "turn"]);
      assertTurn(change.turn, binding, threadIds);
      break;
    case "turn-removed":
      assertAllowedKeys(change, ["kind", "turnId"]);
      assertCanonicalId(change.turnId);
      break;
    case "item-upserted":
      assertAllowedKeys(change, ["kind", "item"]);
      assertItem(change.item, binding, threadIds, turnIds);
      assertTurnThreadLink(
        (change.item as ProjectAgentItem).threadId,
        (change.item as ProjectAgentItem).turnId,
        turnThreadById,
      );
      assertParentItemLink(change.item as ProjectAgentItem, itemTurnById);
      break;
    case "item-removed":
      assertAllowedKeys(change, ["kind", "itemId"]);
      assertCanonicalId(change.itemId);
      break;
    case "queue-upserted":
      assertAllowedKeys(change, ["kind", "queueItem"]);
      assertQueueItem(change.queueItem, binding, threadIds, turnIds);
      assertTurnThreadLink(
        (change.queueItem as ProjectAgentQueueItem).threadId,
        (change.queueItem as ProjectAgentQueueItem).turnId,
        turnThreadById,
      );
      break;
    case "queue-removed":
      assertAllowedKeys(change, ["kind", "queueItemId"]);
      assertCanonicalId(change.queueItemId);
      break;
    case "queue-reordered": {
      assertAllowedKeys(change, ["kind", "queueItemIds"]);
      if (!Array.isArray(change.queueItemIds)) throw new ProjectAgentStateError("invalid_state");
      assertUniqueIds(change.queueItemIds, (entry) => {
        assertCanonicalId(entry);
        return entry as string;
      });
      break;
    }
    case "proposal-upserted":
      assertAllowedKeys(change, ["kind", "approval"]);
      assertProposalApproval(change.approval, threadIds, turnIds);
      assertTurnThreadLink(
        (change.approval as ProjectAgentProposalApproval).ref.threadId,
        (change.approval as ProjectAgentProposalApproval).ref.turnId,
        turnThreadById,
      );
      break;
    case "proposal-removed":
      assertAllowedKeys(change, ["kind", "approvalId"]);
      assertNonEmpty(change.approvalId);
      break;
    default:
      throw new ProjectAgentStateError("invalid_state");
  }
}

function assertTurnThreadLink(threadId: string, turnId: string, turnThreadById: ReadonlyMap<string, string>): void {
  if (turnThreadById.get(turnId) !== threadId) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

function assertParentItemLink(item: ProjectAgentItem, itemTurnById: ReadonlyMap<string, string>): void {
  if (item.parentItemId !== undefined && itemTurnById.get(item.parentItemId) !== item.turnId) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertProjectAgentHostState(value: unknown): asserts value is ProjectAgentHostState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  const raw = value as Record<string, unknown>;
  assertAllowedKeys(raw, [
    "binding",
    "hostRevision",
    "commandLedgerHighWater",
    "activeThreadId",
    "threads",
    "turns",
    "items",
    "queue",
    "proposalApprovals",
    "recentAppliedCommands",
  ]);
  try {
    assertProjectAgentBinding(raw.binding as ProjectBinding);
    stableProjectAgentJson(value);
  } catch (error) {
    if (error instanceof ProjectAgentSnapshotError) {
      throw new ProjectAgentStateError("invalid_json_snapshot");
    }
    throw new ProjectAgentStateError("invalid_state");
  }
  const state = value as ProjectAgentHostState;
  if (
    !Number.isSafeInteger(state.hostRevision) ||
    state.hostRevision < 0 ||
    state.commandLedgerHighWater !== state.hostRevision ||
    (state.activeThreadId !== null && typeof state.activeThreadId !== "string") ||
    !Array.isArray(state.threads) ||
    !Array.isArray(state.turns) ||
    !Array.isArray(state.items) ||
    !Array.isArray(state.queue) ||
    !Array.isArray(state.proposalApprovals) ||
    !Array.isArray(state.recentAppliedCommands)
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }

  state.threads.forEach(assertThread);
  assertUniqueIds(state.threads, (entry) => (entry as ProjectAgentThread).threadId);
  const threadIds = new Set(state.threads.map((thread) => thread.threadId));
  if (state.activeThreadId !== null && !threadIds.has(state.activeThreadId)) {
    throw new ProjectAgentStateError("invalid_state");
  }

  state.turns.forEach((turn) => assertTurn(turn, state.binding, threadIds));
  assertUniqueIds(state.turns, (entry) => (entry as ProjectAgentTurn).turnId);
  assertUniqueIds(state.turns, (entry) => (entry as ProjectAgentTurn).executionToken);
  const turnIds = new Set(state.turns.map((turn) => turn.turnId));
  const turnThreadById = new Map(state.turns.map((turn) => [turn.turnId, turn.threadId]));
  const runningTurns = state.turns.filter((turn) => turn.status === "running");
  if (runningTurns.length > 1) throw new ProjectAgentStateError("invalid_state");

  state.items.forEach((item) => assertItem(item, state.binding, threadIds, turnIds));
  assertUniqueIds(state.items, (entry) => (entry as ProjectAgentItem).itemId);
  if (hasDuplicateProjectAgentToolIdentity(state.items)) throw new ProjectAgentStateError("invalid_state");
  if (hasDuplicateProjectAgentArtifactIdentity(state.items)) throw new ProjectAgentStateError("invalid_state");
  if (hasDuplicateProjectAgentProposalReceiptIdentity(state.items)) throw new ProjectAgentStateError("invalid_state");
  const itemTurnById = new Map(state.items.map((item) => [item.itemId, item.turnId]));
  const proposalItemsByApprovalId = new Map<string, Extract<ProjectAgentItem, { kind: "proposal" }>>();
  const userItemTurnIds = new Set<string>();
  const assistantItemTurnIds = new Set<string>();
  const taskRefKeys = new Set<string>();
  const humanApprovalKeys = new Set<string>();
  state.items.forEach((item) => {
    assertTurnThreadLink(item.threadId, item.turnId, turnThreadById);
    assertParentItemLink(item, itemTurnById);
    if (item.kind === "user") {
      if (userItemTurnIds.has(item.turnId)) throw new ProjectAgentStateError("invalid_state");
      userItemTurnIds.add(item.turnId);
    }
    if (item.kind === "assistant") {
      if (assistantItemTurnIds.has(item.turnId)) throw new ProjectAgentStateError("invalid_state");
      assistantItemTurnIds.add(item.turnId);
    }
    if (item.kind === "task") {
      const key = stableProjectAgentJson(item.task);
      if (taskRefKeys.has(key)) throw new ProjectAgentStateError("invalid_state");
      taskRefKeys.add(key);
    }
    if (item.kind === "proposal" && item.approval) {
      if (proposalItemsByApprovalId.has(item.approval.approvalId)) {
        throw new ProjectAgentStateError("invalid_state");
      }
      proposalItemsByApprovalId.set(item.approval.approvalId, item);
    }
    if (item.kind === "proposal" && item.humanApproval) {
      const key = `${item.humanApproval.challengeId}\0${item.humanApproval.handoffId}`;
      if (humanApprovalKeys.has(key)) throw new ProjectAgentStateError("invalid_state");
      humanApprovalKeys.add(key);
    }
  });
  for (const turnId of turnIds) {
    if (!userItemTurnIds.has(turnId)) throw new ProjectAgentStateError("invalid_state");
  }
  assertProjectAgentAssistantLifecycle(state.turns, state.items);

  state.queue.forEach((item) => assertQueueItem(item, state.binding, threadIds, turnIds));
  assertUniqueIds(state.queue, (entry) => (entry as ProjectAgentQueueItem).queueItemId);
  state.queue.forEach((item) => assertTurnThreadLink(item.threadId, item.turnId, turnThreadById));
  const queueTurnIds = new Set<string>();
  for (const item of state.queue) {
    if (queueTurnIds.has(item.turnId)) throw new ProjectAgentStateError("invalid_state");
    queueTurnIds.add(item.turnId);
    const turn = state.turns.find((candidate) => candidate.turnId === item.turnId);
    if (
      !turn ||
      item.status !== turn.status ||
      item.retryable !== turn.retryable ||
      item.deviated !== turn.deviated ||
      item.updatedAt !== turn.updatedAt ||
      stableProjectAgentJson(item.contextRef) !== stableProjectAgentJson(turn.contextRef) ||
      stableProjectAgentJson(item.model) !== stableProjectAgentJson(turn.model) ||
      projectAgentWorkModeOf(item.workMode) !== projectAgentWorkModeOf(turn.workMode) ||
      stableProjectAgentJson(projectAgentApprovalPolicyOf(item.approvalPolicy)) !==
        stableProjectAgentJson(projectAgentApprovalPolicyOf(turn.approvalPolicy)) ||
      stableProjectAgentJson(item.skillVersions) !== stableProjectAgentJson(turn.skillVersions) ||
      stableProjectAgentJson(item.capabilityVersions) !== stableProjectAgentJson(turn.capabilityVersions)
    ) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
  if (queueTurnIds.size !== turnIds.size) throw new ProjectAgentStateError("invalid_state");

  state.proposalApprovals.forEach((approval) => assertProposalApproval(approval, threadIds, turnIds));
  state.proposalApprovals.forEach((approval) =>
    assertTurnThreadLink(approval.ref.threadId, approval.ref.turnId, turnThreadById),
  );
  assertUniqueIds(state.proposalApprovals, (entry) => (entry as ProjectAgentProposalApproval).ref.approvalId);
  if (hasDuplicateProjectAgentApprovalIdentity(state.proposalApprovals)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  const approvalsById = new Map(state.proposalApprovals.map((approval) => [approval.ref.approvalId, approval]));
  for (const turn of state.turns) {
    const pendingCount = state.proposalApprovals.filter(
      (approval) => approval.ref.turnId === turn.turnId && approval.lifecycle === "pending",
    ).length;
    if ((turn.status === "proposed" && pendingCount !== 1) || (turn.status !== "proposed" && pendingCount !== 0)) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
  for (const approval of state.proposalApprovals) {
    const item = proposalItemsByApprovalId.get(approval.ref.approvalId);
    const queueItem = state.queue.find((candidate) => candidate.turnId === approval.ref.turnId);
    const turn = state.turns.find((candidate) => candidate.turnId === approval.ref.turnId);
    const lifecycleAt = approval.claimedAt ?? approval.expiredAt;
    if (
      !item ||
      !queueItem ||
      !turn ||
      stableProjectAgentJson(item.approval) !== stableProjectAgentJson(approval.ref) ||
      stableProjectAgentJson(approval.ref.target) !== stableProjectAgentJson(queueItem.target) ||
      stableProjectAgentJson(approval.ref.preconditions) !== stableProjectAgentJson(queueItem.preconditions) ||
      new Date(approval.ref.expiresAt).getTime() <= new Date(item.createdAt).getTime() ||
      (lifecycleAt !== undefined &&
        (new Date(lifecycleAt).getTime() < new Date(item.createdAt).getTime() ||
          new Date(lifecycleAt).getTime() > new Date(turn.updatedAt).getTime())) ||
      (approval.lifecycle === "pending" && item.status !== "proposed") ||
      (approval.lifecycle === "claimed" && !isProjectAgentClaimedProposalItemStatus(item.status)) ||
      (approval.lifecycle === "expired" && item.status !== "stopped")
    ) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
  for (const [approvalId, item] of proposalItemsByApprovalId) {
    if (isProjectAgentLiveProposalItemStatus(item.status) && !approvalsById.has(approvalId)) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }

  if (state.recentAppliedCommands.length !== Math.min(PROJECT_AGENT_RECENT_COMMAND_LIMIT, state.hostRevision)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertUniqueIds(state.recentAppliedCommands, (entry) => String((entry as Record<string, unknown>).commandId));
  const firstRecentRevision = state.hostRevision - state.recentAppliedCommands.length + 1;
  state.recentAppliedCommands.forEach((command, index) => {
    const record = asRecord(command);
    assertAllowedKeys(record, ["commandId", "mutationHash", "appliedRevision", "patch"]);
    assertCanonicalId(record.commandId);
    if (typeof record.mutationHash !== "string" || !/^[a-f0-9]{64}$/.test(record.mutationHash)) {
      throw new ProjectAgentStateError("invalid_state");
    }
    const expectedRevision = firstRecentRevision + index;
    if (record.appliedRevision !== expectedRevision) throw new ProjectAgentStateError("invalid_state");
    const patch = asRecord(record.patch);
    assertAllowedKeys(patch, ["binding", "hostRevision", "previousRevision", "changes"]);
    assertProjectAgentBinding(patch.binding as ProjectBinding);
    if (!sameProjectAgentBinding(patch.binding as ProjectBinding, state.binding)) {
      throw new ProjectAgentStateError("invalid_state");
    }
    if (patch.hostRevision !== expectedRevision || patch.previousRevision !== expectedRevision - 1) {
      throw new ProjectAgentStateError("invalid_state");
    }
    if (!Array.isArray(patch.changes)) throw new ProjectAgentStateError("invalid_state");
    patch.changes.forEach((change) =>
      assertPatchChange(change, state.binding, threadIds, turnIds, turnThreadById, itemTurnById),
    );
  });
}

export function snapshotProjectAgentHostState(value: unknown): ProjectAgentHostState {
  if (value && typeof value === "object" && trustedStates.has(value)) {
    return value as ProjectAgentHostState;
  }
  fullValidationCount += 1;
  assertProjectAgentHostState(value);
  const state = freezeProjectAgentSnapshot(value);
  const index: TrustedCommandIndex = new Map();
  for (const command of state.recentAppliedCommands) index.set(command.commandId, command);
  trustedStates.add(state);
  trustedCommandIndexes.set(state, index);
  return state;
}

export function findTrustedProjectAgentAppliedCommand(
  state: ProjectAgentHostState,
  commandId: string,
): ProjectAgentAppliedCommand | undefined {
  const index = trustedCommandIndexes.get(state);
  if (!index) throw new ProjectAgentStateError("invalid_state");
  return index.get(commandId);
}

export function appendTrustedProjectAgentHostState(
  previous: ProjectAgentHostState,
  next: Omit<ProjectAgentHostState, "hostRevision" | "commandLedgerHighWater" | "recentAppliedCommands">,
  receipt: ProjectAgentAppliedCommand,
): ProjectAgentHostState {
  const index = trustedCommandIndexes.get(previous);
  if (
    !index ||
    !sameProjectAgentBinding(previous.binding, next.binding) ||
    receipt.appliedRevision !== previous.hostRevision + 1 ||
    receipt.patch.previousRevision !== previous.hostRevision ||
    receipt.patch.hostRevision !== receipt.appliedRevision ||
    !sameProjectAgentBinding(receipt.patch.binding, previous.binding)
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }
  const activeChanges = receipt.patch.changes.filter((change) => change.kind === "active-thread-changed");
  if (
    (previous.activeThreadId !== next.activeThreadId &&
      (activeChanges.length !== 1 || activeChanges[0]?.activeThreadId !== next.activeThreadId)) ||
    (previous.activeThreadId === next.activeThreadId && activeChanges.length !== 0)
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertTrustedProjectAgentDeltaCoverage(previous, next, receipt.patch.changes);
  assertTrustedProjectAgentDelta(next, receipt.patch.changes, assertThread, assertPatchChange);
  const state = Object.freeze({
    ...next,
    threads: Object.isFrozen(next.threads) ? next.threads : Object.freeze(next.threads),
    turns: Object.isFrozen(next.turns) ? next.turns : Object.freeze(next.turns),
    items: Object.isFrozen(next.items) ? next.items : Object.freeze(next.items),
    queue: Object.isFrozen(next.queue) ? next.queue : Object.freeze(next.queue),
    proposalApprovals: Object.isFrozen(next.proposalApprovals)
      ? next.proposalApprovals
      : Object.freeze(next.proposalApprovals),
    hostRevision: receipt.appliedRevision,
    commandLedgerHighWater: receipt.appliedRevision,
    recentAppliedCommands: Object.freeze(
      [...previous.recentAppliedCommands, receipt].slice(-PROJECT_AGENT_RECENT_COMMAND_LIMIT),
    ),
  }) as ProjectAgentHostState;
  const nextIndex: TrustedCommandIndex = new Map(
    state.recentAppliedCommands.map((command) => [command.commandId, command]),
  );
  trustedStates.add(state);
  trustedCommandIndexes.set(state, nextIndex);
  return state;
}

export function __projectAgentFullValidationCountForTests(): number {
  return fullValidationCount;
}

export function createInitialProjectAgentState(binding: ProjectBinding): ProjectAgentHostState {
  assertProjectAgentBinding(binding);
  return snapshotProjectAgentHostState({
    binding,
    hostRevision: 0,
    commandLedgerHighWater: 0,
    activeThreadId: null,
    threads: [],
    turns: [],
    items: [],
    queue: [],
    proposalApprovals: [],
    recentAppliedCommands: [],
  });
}
