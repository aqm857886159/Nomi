import type {
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentMutation,
  ProjectAgentProposalApproval,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentTurn,
} from "../shared/projectAgentContracts";
import { reduceProjectAgentAssistantTerminal } from "./projectAgentAssistantFinalReduction";
import { assertCanAppendProjectAgentItem } from "./projectAgentItemSemantics";
import {
  assertCanonicalMutationTimestamp,
  assertExactMutationKeys,
} from "./projectAgentMutationValidation";
import {
  PROPOSAL_LEDGER_ABSENT,
  resolveProposalTransitionAction,
  resolveTransition,
  type ProposalTransitionResolution,
} from "./projectAgentProposalTransitions";
import {
  assertSingleRunningTurn,
  findQueueForTurn,
  findTurn,
  replaceById,
  transitionRecord,
  updateProposalItems,
} from "./projectAgentRecordReduction";
import { ProjectAgentReducerError, type ProjectAgentReducerErrorCode } from "./projectAgentReducerContract";
import {
  hasDuplicateProjectAgentApprovalIdentity,
  hasDuplicateProjectAgentProposalReceiptIdentity,
} from "./projectAgentSemanticIdentity";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";
import { stableProjectAgentJson } from "./projectAgentState";

/**
 * The two proposal ledger commands. Both are pure table lookups plus the
 * payload/timestamp guards the table deliberately does not own; see
 * `projectAgentProposalTransitions.ts` for the machine itself.
 */
export type ProjectAgentProposalReduction = Readonly<{
  turns: readonly ProjectAgentTurn[];
  items: readonly ProjectAgentItem[];
  queue: readonly ProjectAgentQueueItem[];
  proposalApprovals: readonly ProjectAgentProposalApproval[];
  changes: readonly ProjectAgentChange[];
}>;

function fail(code: ProjectAgentReducerErrorCode): never {
  throw new ProjectAgentReducerError(code);
}

/** Rejections coming out of the proposal table always name their own cell. */
function failTransition(rejected: Extract<ProposalTransitionResolution, { ok: false }>): never {
  throw new ProjectAgentReducerError(rejected.code, { ...rejected.coordinate, reason: rejected.reason });
}

export function reduceProjectAgentProposalPut(
  current: ProjectAgentHostState,
  mutation: Extract<ProjectAgentMutation, { type: "proposal.put" }>,
): ProjectAgentProposalReduction {
  let turns = current.turns;
  let items = current.items;
  let queue = current.queue;
  let proposalApprovals = current.proposalApprovals;
  const changes: ProjectAgentChange[] = [];
  assertExactMutationKeys(mutation.payload, ["approval", "item", "occurredAt"]);
  const { approval, item, occurredAt } = mutation.payload;
  assertCanonicalMutationTimestamp(occurredAt);
  if (
    !approval ||
    typeof approval !== "object" ||
    !approval.ref ||
    typeof approval.ref !== "object" ||
    !item ||
    typeof item !== "object"
  ) {
    fail("invalid_mutation");
  }
  if (
    approval.lifecycle !== "pending" ||
    hasDuplicateProjectAgentApprovalIdentity([...proposalApprovals, approval])
  ) {
    fail("record_exists");
  }
  const turn = findTurn(current, approval.ref.turnId);
  const queueItem = findQueueForTurn(queue, turn.turnId);
  const recorded = proposalApprovals.find(
    (value) => value.ref.approvalId === approval.ref.approvalId,
  );
  const admission = resolveTransition({
    sourceDomain: queueItem.target.kind,
    targetDomain: approval.ref.target.kind,
    fromState: recorded?.lifecycle ?? PROPOSAL_LEDGER_ABSENT,
    action: "put",
  });
  if (!admission.ok) failTransition(admission);
  // The only admission rule that may re-anchor the frozen queue item: a canvas
  // turn queued without preconditions adopts the ref's edge preconditions.
  const deferredCanvasAdmission =
    admission.admission.includes("deferred-canvas-edges") &&
    Object.keys(queueItem.preconditions).length === 0 &&
    Array.isArray(approval.ref.preconditions.edges) &&
    approval.ref.preconditions.edges.length > 0;
  if (
    turn.threadId !== approval.ref.threadId ||
    turn.status !== "running" ||
    item.kind !== "proposal" ||
    !item.approval ||
    item.status !== "proposed" ||
    item.threadId !== turn.threadId ||
    item.turnId !== turn.turnId ||
    items.some((value) => value.itemId === item.itemId) ||
    stableProjectAgentJson(item.approval) !== stableProjectAgentJson(approval.ref) ||
    (!deferredCanvasAdmission &&
      (stableProjectAgentJson(approval.ref.target) !== stableProjectAgentJson(queueItem.target) ||
        stableProjectAgentJson(approval.ref.preconditions) !== stableProjectAgentJson(queueItem.preconditions))) ||
    new Date(occurredAt).getTime() < new Date(turn.updatedAt).getTime() ||
    new Date(approval.ref.expiresAt).getTime() <= new Date(occurredAt).getTime()
  ) {
    fail("proposal_transition_invalid");
  }
  if (hasDuplicateProjectAgentProposalReceiptIdentity([...items, item])) fail("record_exists");
  assertCanAppendProjectAgentItem(items, item, true);
  assertCanonicalMutationTimestamp(approval.ref.expiresAt);
  const updatedTurn = transitionRecord(turn, {
    status: "proposed",
    updatedAt: occurredAt,
  });
  const updatedQueue = transitionRecord(deferredCanvasAdmission
    ? { ...queueItem, target: approval.ref.target, preconditions: approval.ref.preconditions }
    : queueItem, { status: "proposed", updatedAt: occurredAt });
  proposalApprovals = [...proposalApprovals, approval];
  items = [...items, item];
  turns = replaceById(
    turns,
    turn.turnId,
    (value) => value.turnId,
    () => updatedTurn,
  );
  queue = replaceById(
    queue,
    queueItem.queueItemId,
    (value) => value.queueItemId,
    () => updatedQueue,
  );
  changes.push(
    { kind: "proposal-upserted", approval },
    { kind: "item-upserted", item },
    { kind: "turn-upserted", turn: updatedTurn },
    { kind: "queue-upserted", queueItem: updatedQueue },
  );
  return { turns, items, queue, proposalApprovals, changes };
}

export function reduceProjectAgentProposalTransition(
  current: ProjectAgentHostState,
  mutation: Extract<ProjectAgentMutation, { type: "proposal.transition" }>,
): ProjectAgentProposalReduction {
  let turns = current.turns;
  let items = current.items;
  let queue = current.queue;
  let proposalApprovals = current.proposalApprovals;
  const changes: ProjectAgentChange[] = [];
  assertExactMutationKeys(mutation.payload, ["approvalId", "lifecycle", "occurredAt"]);
  assertCanonicalMutationTimestamp(mutation.payload.occurredAt);
  const existingApproval = proposalApprovals.find(
    (value) => value.ref.approvalId === mutation.payload.approvalId,
  );
  if (!existingApproval) fail("record_not_found");
  const turn = findTurn(current, existingApproval.ref.turnId);
  const queueItem = findQueueForTurn(queue, turn.turnId);
  // `pending` is not reachable by transition, so an unmapped lifecycle has no
  // action and therefore no cell at all.
  const requestedAction = resolveProposalTransitionAction(mutation.payload.lifecycle);
  if (!requestedAction) fail("proposal_transition_invalid");
  const settlement = resolveTransition({
    sourceDomain: queueItem.target.kind,
    targetDomain: existingApproval.ref.target.kind,
    fromState: existingApproval.lifecycle,
    action: requestedAction,
  });
  if (!settlement.ok) failTransition(settlement);
  const claimed = settlement.toState === "claimed";
  const occurredAtMs = new Date(mutation.payload.occurredAt).getTime();
  const expiresAtMs = new Date(existingApproval.ref.expiresAt).getTime();
  if (claimed ? occurredAtMs >= expiresAtMs : occurredAtMs < expiresAtMs) {
    fail("proposal_transition_invalid");
  }
  const proposalItem = items.find(
    (item) => item.kind === "proposal" && item.approval?.approvalId === existingApproval.ref.approvalId,
  );
  if (
    turn.status !== "proposed" ||
    queueItem.status !== "proposed" ||
    !proposalItem ||
    occurredAtMs < new Date(turn.updatedAt).getTime() ||
    occurredAtMs < new Date(proposalItem.updatedAt).getTime()
  ) {
    fail("proposal_transition_invalid");
  }
  if (claimed) assertSingleRunningTurn(current, turn.turnId);
  const status: ProjectAgentStatus = claimed ? "running" : "stopped";
  const updatedApproval: ProjectAgentProposalApproval = freezeProjectAgentIncremental({
    ...existingApproval,
    lifecycle: settlement.toState,
    ...(claimed ? { claimedAt: mutation.payload.occurredAt } : { expiredAt: mutation.payload.occurredAt }),
  });
  const updatedTurn = transitionRecord(turn, {
    status,
    updatedAt: mutation.payload.occurredAt,
  });
  const updatedQueue = transitionRecord(queueItem, {
    status,
    updatedAt: mutation.payload.occurredAt,
  });
  const proposalItems = updateProposalItems(
    items,
    existingApproval.ref.approvalId,
    status,
    mutation.payload.occurredAt,
  );
  items = proposalItems.items;
  const terminalAssistant = claimed
    ? { items, changes: [] }
    : reduceProjectAgentAssistantTerminal(items, turn.turnId, status, mutation.payload.occurredAt);
  items = terminalAssistant.items;
  proposalApprovals = replaceById(
    proposalApprovals,
    existingApproval.ref.approvalId,
    (value) => value.ref.approvalId,
    () => updatedApproval,
  );
  turns = replaceById(
    turns,
    turn.turnId,
    (value) => value.turnId,
    () => updatedTurn,
  );
  queue = replaceById(
    queue,
    queueItem.queueItemId,
    (value) => value.queueItemId,
    () => updatedQueue,
  );
  changes.push(
    { kind: "proposal-upserted", approval: updatedApproval },
    { kind: "turn-upserted", turn: updatedTurn },
    { kind: "queue-upserted", queueItem: updatedQueue },
    ...proposalItems.changes,
    ...terminalAssistant.changes,
  );
  return { turns, items, queue, proposalApprovals, changes };
}
