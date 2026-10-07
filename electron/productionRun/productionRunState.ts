import type {
  ProductionJob,
  ProductionJobStatus,
  ProductionRun,
  ProductionRunStatus,
} from "./productionRunTypes";

const JOB_TRANSITIONS: Record<ProductionJobStatus, readonly ProductionJobStatus[]> = {
  planned: ["authorization_required", "detached"],
  authorization_required: ["authorized", "detached"],
  authorized: ["submit_intent_persisted", "needs_attention", "detached"],
  submit_intent_persisted: ["submitting", "needs_attention"],
  // `needs_attention`：出站层能**证明**这次请求一个字节都没写出去时，这是一个确定的失败态。
  // 在这之前 `submitting` 只有「成了」和「不知道」两条出路，于是一次根本没发生过的提交
  // 也只能被记成 `submission_unknown`（见 `submissionOutbox.markNotDispatched`）。
  submitting: ["provider_accepted", "submission_unknown", "needs_attention"],
  provider_accepted: ["polling", "ready", "needs_attention", "cancel_requested"],
  polling: ["downloading", "ready", "retry_wait", "needs_attention", "cancel_requested"],
  retry_wait: ["polling", "needs_attention", "cancel_requested"],
  downloading: ["validating_technical", "needs_attention"],
  validating_technical: ["validating_content", "needs_attention"],
  validating_content: ["ready", "needs_attention"],
  ready: ["adopted"],
  adopted: [],
  submission_unknown: ["reconciling", "needs_attention", "cancel_requested", "submit_intent_persisted"],
  reconciling: ["provider_accepted", "needs_attention", "cancel_requested"],
  // `polling`：只给「已生成、取回失败」那一种 needs_attention 用（#975 A2）——供应商任务号还在、钱已经花了，
  // 回到轮询 = 免费再查一次、再取一次，永远不会重新提交。准不准由 productionRunService 的 job.retry_retrieval 判
  // （只认 errorCode output_retrieval_failed + 有任务号），这里只开这条边。
  needs_attention: ["reconciling", "polling", "cancel_requested"],
  cancel_requested: ["cancelled_remote", "detached", "too_late"],
  cancelled_remote: [],
  detached: [],
  too_late: [],
};

const RUN_TRANSITIONS: Record<ProductionRunStatus, readonly ProductionRunStatus[]> = {
  // P4 S4 adds `draft → running`: a semantic multi-shot batch (playbook `generation.single-shot`) has a
  // minimal lifecycle — it stays `draft` while the plan is edited/sealed, then the batch scheduler drives
  // it. To reuse Run pause/cancel (§3.3), the run must be `running` while the batch generates (pause
  // requires `running`). Single-shot runs never call the scheduler, so they never take this edge.
  draft: ["awaiting_direction", "awaiting_contract", "running", "cancelled"],
  awaiting_direction: ["running", "cancelled"],
  awaiting_script_review: ["running", "cancelled"],
  awaiting_storyboard_review: ["awaiting_script_review", "awaiting_contract", "cancelled"],
  awaiting_contract: ["ready", "cancelled"],
  ready: ["running", "cancelled"],
  // A semantic single-shot has no separate assemble/export stages: once its
  // one durable artifact is materialized it can truthfully settle from
  // running straight to completed. Multi-stage playbooks still use their
  // existing QA/assemble/export transitions.
  running: ["pausing", "needs_attention", "awaiting_script_review", "awaiting_storyboard_review", "awaiting_rough_cut_review", "awaiting_export", "completed", "cancelled"],
  // pausing → running：急停后、在跑的那一镜还没收尾就点了继续（不必先等它落到 paused）。
  pausing: ["paused", "needs_attention", "running"],
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
