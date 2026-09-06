import type { TargetRef } from "../shared/capabilityTargeting";
import {
  PROJECT_AGENT_PROPOSAL_LIFECYCLES,
  type ProjectAgentProposalLifecycle,
} from "../shared/projectAgentContracts";
import type { ProjectAgentReducerErrorCode } from "./projectAgentReducerContract";

/**
 * The Host proposal ledger as one explicit table.
 *
 * Every admissible move is a cell of
 *   (source domain × target domain × current state × action) → next state,
 * and anything the table does not name is rejected with its own coordinate.
 * The reducer only looks cells up; it never re-derives a transition from a
 * chain of `if`s, so a new domain or action is a data change with a compiler
 * check behind it rather than a new branch in an 800-line switch.
 */

/**
 * The ledger coordinate before any approval record exists. It composes with the
 * owning `PROJECT_AGENT_PROPOSAL_LIFECYCLES` vocabulary instead of copying it.
 */
export const PROPOSAL_LEDGER_ABSENT = "absent" as const;

export type ProposalTransitionState = typeof PROPOSAL_LEDGER_ABSENT | ProjectAgentProposalLifecycle;

export const PROPOSAL_TRANSITION_ACTIONS = ["put", "claim", "expire"] as const;

export type ProposalTransitionAction = (typeof PROPOSAL_TRANSITION_ACTIONS)[number];

/** A proposal domain is the capability target kind; the union stays the one owner. */
export type ProposalTransitionDomain = TargetRef["kind"];

export const PROPOSAL_TRANSITION_DOMAINS = [
  "document",
  "canvas",
  "canvas-result",
  "asset",
  "timeline",
  "export",
  "artifact",
  "production",
] as const;

/** Compile-time proof that a new TargetRef kind cannot silently skip the table. */
type UncoveredProposalDomain = Exclude<
  ProposalTransitionDomain,
  (typeof PROPOSAL_TRANSITION_DOMAINS)[number]
>;
const _everyProposalDomainIsTabled: UncoveredProposalDomain extends never ? true : never = true;
void _everyProposalDomainIsTabled;

export type ProposalAdmissionRule =
  /** The durable ref must equal the queue item's frozen target and preconditions. */
  | "queue-identity"
  /** A canvas turn queued with no preconditions adopts the ref's edge preconditions. */
  | "deferred-canvas-edges"
  /**
   * A timeline turn is queued from the user's *selection*, but the plan the user
   * approves names its own clips and its own base revision — a trim may ripple
   * into neighbours the selection never mentioned. Freezing the selection as the
   * write scope would reject every approved plan, so the queue item adopts the
   * ref's plan scope instead. What guards the write is not the frozen selection
   * but the plan's compare-and-swap `baseRevision` plus the approval card, which
   * spells out every operation before the user says yes.
   */
  | "deferred-timeline-plan"
  /**
   * Cross-surface write whose Host ledger entry must be re-anchored to the queue
   * target by its caller before it reaches the reducer. The reducer stays closed.
   */
  | "host-anchored-upstream";

export type ProposalTransitionRejection =
  | "cross_domain_admission_absent"
  | "host_anchor_required"
  | "lifecycle_action_unavailable"
  | "approval_already_recorded"
  | "approval_not_recorded";

export type ProposalTransitionCoordinate = Readonly<{
  sourceDomain: ProposalTransitionDomain;
  targetDomain: ProposalTransitionDomain;
  fromState: ProposalTransitionState;
  action: ProposalTransitionAction;
}>;

export type ProposalTransitionResolution =
  | Readonly<{
      ok: true;
      coordinate: ProposalTransitionCoordinate;
      toState: ProjectAgentProposalLifecycle;
      admission: readonly ProposalAdmissionRule[];
    }>
  | Readonly<{
      ok: false;
      coordinate: ProposalTransitionCoordinate;
      code: ProjectAgentReducerErrorCode;
      reason: ProposalTransitionRejection;
    }>;

/**
 * `put` is the only action that admits a domain pair; `claim` and `expire` act on
 * an entry whose domains were already frozen at admission, so they never re-open
 * the domain axis.
 */
type AdmissionScope = "queue-admission" | "recorded-anchor";

type LifecycleCell = Readonly<{
  fromState: ProposalTransitionState;
  action: ProposalTransitionAction;
  toState: ProjectAgentProposalLifecycle;
  scope: AdmissionScope;
}>;

const LIFECYCLE_TABLE: readonly LifecycleCell[] = [
  { fromState: PROPOSAL_LEDGER_ABSENT, action: "put", toState: "pending", scope: "queue-admission" },
  { fromState: "pending", action: "claim", toState: "claimed", scope: "recorded-anchor" },
  { fromState: "pending", action: "expire", toState: "expired", scope: "recorded-anchor" },
];

type AdmissionCell = Readonly<{
  sourceDomain: ProposalTransitionDomain;
  targetDomain: ProposalTransitionDomain;
  rules: readonly ProposalAdmissionRule[];
}>;

const sameDomainCell = (domain: ProposalTransitionDomain): AdmissionCell => ({
  sourceDomain: domain,
  targetDomain: domain,
  rules: ["queue-identity"],
});

const ADMISSION_TABLE: readonly AdmissionCell[] = [
  sameDomainCell("document"),
  {
    sourceDomain: "canvas",
    targetDomain: "canvas",
    rules: ["queue-identity", "deferred-canvas-edges"],
  },
  sameDomainCell("canvas-result"),
  sameDomainCell("asset"),
  {
    sourceDomain: "timeline",
    targetDomain: "timeline",
    rules: ["queue-identity", "deferred-timeline-plan"],
  },
  sameDomainCell("export"),
  sameDomainCell("artifact"),
  sameDomainCell("production"),
  /**
   * Renderer-owned storyboard writes reach the canvas capability from a creation
   * document turn. This cell is named so the boundary is visible, and it is a
   * closed one: the caller re-anchors the ledger entry to its queue target, which
   * then resolves as `document → document`.
   */
  { sourceDomain: "document", targetDomain: "canvas", rules: ["host-anchored-upstream"] },
];

const REJECTION_CODES: Readonly<Record<ProposalTransitionRejection, ProjectAgentReducerErrorCode>> = {
  cross_domain_admission_absent: "proposal_transition_invalid",
  host_anchor_required: "proposal_transition_invalid",
  lifecycle_action_unavailable: "proposal_transition_invalid",
  approval_already_recorded: "record_exists",
  approval_not_recorded: "record_not_found",
};

function reject(
  coordinate: ProposalTransitionCoordinate,
  reason: ProposalTransitionRejection,
): ProposalTransitionResolution {
  return Object.freeze({ ok: false as const, coordinate, code: REJECTION_CODES[reason], reason });
}

function lifecycleRejection(coordinate: ProposalTransitionCoordinate): ProposalTransitionRejection {
  if (coordinate.action === "put") return "approval_already_recorded";
  if (coordinate.fromState === PROPOSAL_LEDGER_ABSENT) return "approval_not_recorded";
  return "lifecycle_action_unavailable";
}

/** Maps a requested durable lifecycle onto its table action. `pending` is not reachable by transition. */
export function resolveProposalTransitionAction(lifecycle: unknown): ProposalTransitionAction | undefined {
  if (lifecycle === "claimed") return "claim";
  if (lifecycle === "expired") return "expire";
  return undefined;
}

export function isProposalTransitionDomain(value: unknown): value is ProposalTransitionDomain {
  return (PROPOSAL_TRANSITION_DOMAINS as readonly string[]).includes(value as string);
}

/** Enumerates every ledger state, including the pre-record coordinate. */
export function proposalTransitionStates(): readonly ProposalTransitionState[] {
  return [PROPOSAL_LEDGER_ABSENT, ...PROJECT_AGENT_PROPOSAL_LIFECYCLES];
}

/**
 * The single lookup the reducer performs. Returns the next durable state and the
 * admission rules the caller still has to satisfy, or the rejection reason with
 * the exact cell coordinate that was missing.
 */
export function resolveTransition(input: ProposalTransitionCoordinate): ProposalTransitionResolution {
  const coordinate = Object.freeze({ ...input });
  const cell = LIFECYCLE_TABLE.find(
    (value) => value.fromState === coordinate.fromState && value.action === coordinate.action,
  );
  if (!cell) return reject(coordinate, lifecycleRejection(coordinate));
  if (cell.scope === "recorded-anchor") {
    return Object.freeze({ ok: true as const, coordinate, toState: cell.toState, admission: [] });
  }
  const admission = ADMISSION_TABLE.find(
    (value) =>
      value.sourceDomain === coordinate.sourceDomain && value.targetDomain === coordinate.targetDomain,
  );
  if (!admission) return reject(coordinate, "cross_domain_admission_absent");
  if (admission.rules.includes("host-anchored-upstream")) {
    return reject(coordinate, "host_anchor_required");
  }
  return Object.freeze({ ok: true as const, coordinate, toState: cell.toState, admission: admission.rules });
}
