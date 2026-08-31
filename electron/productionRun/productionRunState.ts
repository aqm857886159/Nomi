import type {
  ProductionJob,
  ProductionJobStatus,
  ProductionRun,
  ProductionRunStatus,
} from "./productionRunTypes";

const JOB_TRANSITIONS: Record<ProductionJobStatus, readonly ProductionJobStatus[]> = {
  planned: ["authorization_required"],
  authorization_required: ["authorized"],
  authorized: ["submit_intent_persisted"],
  submit_intent_persisted: ["submitting"],
  submitting: ["provider_accepted", "submission_unknown"],
  provider_accepted: ["polling", "cancel_requested"],
  polling: ["downloading", "retry_wait", "needs_attention", "cancel_requested"],
  retry_wait: ["polling", "needs_attention", "cancel_requested"],
  downloading: ["validating_technical", "needs_attention"],
  validating_technical: ["validating_content", "needs_attention"],
  validating_content: ["ready", "needs_attention"],
  ready: ["adopted"],
  adopted: [],
  submission_unknown: ["reconciling", "needs_attention", "cancel_requested"],
  reconciling: ["provider_accepted", "needs_attention", "cancel_requested"],
  needs_attention: ["reconciling", "cancel_requested"],
  cancel_requested: ["cancelled_remote", "detached", "too_late"],
  cancelled_remote: [],
  detached: [],
  too_late: [],
};

const RUN_TRANSITIONS: Record<ProductionRunStatus, readonly ProductionRunStatus[]> = {
  draft: ["awaiting_direction", "awaiting_contract", "cancelled"],
  awaiting_direction: ["running", "cancelled"],
  awaiting_storyboard_review: ["awaiting_contract", "cancelled"],
  awaiting_contract: ["ready", "cancelled"],
  ready: ["running", "cancelled"],
  running: ["pausing", "needs_attention", "awaiting_storyboard_review", "awaiting_rough_cut_review", "awaiting_export", "cancelled"],
  pausing: ["paused", "needs_attention"],
  paused: ["running", "cancelled"],
  needs_attention: ["running", "paused", "cancelled"],
  awaiting_rough_cut_review: ["running", "awaiting_export", "cancelled"],
  awaiting_export: ["exporting", "running", "cancelled"],
  exporting: ["completed", "needs_attention"],
  completed: [],
  cancelled: [],
};

export class IllegalProductionTransitionError extends Error {
  constructor(entity: "job" | "run", from: string, to: string) {
    super(`Illegal ${entity} transition ${from} -> ${to}`);
    this.name = "IllegalProductionTransitionError";
  }
}

export function transitionJob(
  current: ProductionJob,
  status: ProductionJobStatus,
  updatedAt: string,
): ProductionJob {
  if (!JOB_TRANSITIONS[current.status].includes(status)) {
    throw new IllegalProductionTransitionError("job", current.status, status);
  }
  return { ...current, status, updatedAt };
}

export function transitionRun(
  current: ProductionRun,
  status: ProductionRunStatus,
  updatedAt: string,
): ProductionRun {
  if (!RUN_TRANSITIONS[current.status].includes(status)) {
    throw new IllegalProductionTransitionError("run", current.status, status);
  }
  return { ...current, status, updatedAt };
}
