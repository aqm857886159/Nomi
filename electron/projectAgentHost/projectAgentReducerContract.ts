import type { ProjectAgentStatus } from "../shared/projectAgentContracts";

export const PROJECT_AGENT_REDUCER_ERROR_CODES = [
  "project_binding_mismatch",
  "revision_conflict",
  "command_id_conflict",
  "record_exists",
  "record_not_found",
  "invalid_mutation",
  "area_identity_forbidden",
  "status_transition_invalid",
  "proposal_transition_invalid",
  "running_turn_exists",
  "queue_order_violation",
  "async_result_stale",
  "foreign_domain_state",
  "thread_read_only",
] as const;

export type ProjectAgentReducerErrorCode = (typeof PROJECT_AGENT_REDUCER_ERROR_CODES)[number];

/**
 * The exact table cell a rejected proposal move landed on. Structural on purpose:
 * the transition table owns the vocabularies, this contract only carries them out
 * so the failure receipt names the cell instead of an anonymous code.
 */
export type ProjectAgentTransitionCoordinate = Readonly<{
  sourceDomain: string;
  targetDomain: string;
  fromState: string;
  action: string;
  reason: string;
}>;

export class ProjectAgentReducerError extends Error {
  constructor(
    readonly code: ProjectAgentReducerErrorCode,
    readonly transition?: ProjectAgentTransitionCoordinate,
  ) {
    super(code);
    this.name = "ProjectAgentReducerError";
  }
}

export function isProjectAgentStatusTransition(from: ProjectAgentStatus, to: ProjectAgentStatus): boolean {
  switch (from) {
    case "drafting":
      return to === "proposed" || to === "queued" || to === "failed" || to === "stopped";
    case "proposed":
      return to === "declined" || to === "queued" || to === "running" || to === "failed" || to === "stopped";
    case "queued":
      return to === "running" || to === "declined" || to === "failed" || to === "stopped";
    case "running":
      return to === "proposed" || to === "declined" || to === "done" || to === "failed" || to === "stopped";
    case "declined":
    case "done":
    case "failed":
    case "stopped":
      return false;
  }
}
