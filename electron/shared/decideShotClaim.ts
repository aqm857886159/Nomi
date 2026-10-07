import type { ProductionJob, ProductionJobStatus, ProductionRun } from "../productionRun/productionRunTypes";
import { currentShotAttempt, jobEndedBeforeAcceptance, latestJobForShot, shotIncluded } from "./productionShotJobs";
import { isStoppedRunStatus } from "./productionRunStop";
import { spendAuthorizationGates } from "./productionSpendAuthority";
import { draftCardHidden } from "./productionGenerationPresentation";

export type ShotClaimRequester = "canvas" | "production";
export type ShotClaimHolder = "canvas" | "production" | "none";
export type ShotClaimReason =
  | "missing_run"
  | "missing_shot"
  | "plan_cancelled"
  | "shot_excluded"
  | "canvas_detached"
  | "awaiting_confirmation"
  | "gate_rejected"
  | "queued"
  | "canvas_claimed"
  | "in_flight"
  | "needs_reconcile"
  | "run_stopped"
  | "terminal";

export type ShotClaimDecision = {
  granted: boolean;
  holder: ShotClaimHolder;
  reason: ShotClaimReason;
};

const IN_FLIGHT: ReadonlySet<ProductionJob["status"]> = new Set([
  "submit_intent_persisted", "submitting", "provider_accepted", "polling", "retry_wait",
  "downloading", "validating_technical", "validating_content",
]);
const NEEDS_RECONCILE: ReadonlySet<ProductionJob["status"]> = new Set(["submission_unknown", "reconciling"]);

function terminalStatus(status: ProductionJobStatus): boolean {
  switch (status) {
    case "ready": case "adopted": case "needs_attention": case "cancelled_remote":
    case "detached": case "too_late": case "cancel_requested": return true;
    case "planned": case "authorization_required": case "authorized":
    case "submit_intent_persisted": case "submitting": case "provider_accepted":
    case "polling": case "retry_wait": case "downloading": case "validating_technical":
    case "validating_content": case "submission_unknown": case "reconciling": return false;
    default: return ((status: never) => status)(status);
  }
}

function decision(holder: ShotClaimHolder, reason: ShotClaimReason, requester: ShotClaimRequester): ShotClaimDecision {
  // A canvas node with no production Run is an ordinary canvas generation. The
  // absence of a production owner is therefore an explicit canvas grant.
  return { granted: holder === requester || (holder === "none" && requester === "canvas"), holder, reason };
}

/** The single durable, read-only claim decision shared by canvas and production callers. */
export function decideShotClaim(
  run: ProductionRun | null | undefined,
  shotId: string | undefined,
  requester: ShotClaimRequester,
): ShotClaimDecision {
  if (!run) return decision("none", "missing_run", requester);
  const plan = run.generationPlan;
  if (!plan || !shotId) return decision("none", "missing_shot", requester);
  if (plan.state === "cancelled") return decision("canvas", "plan_cancelled", requester);

  const single = !plan.shots?.length;
  // A single-shot plan has one canonical identity: its candidate ID. Treat a
  // different binding as missing instead of applying a plan-level claim to it.
  if (single && shotId !== plan.candidate?.candidateId) return decision("none", "missing_shot", requester);
  const shot = single ? undefined : plan.shots?.find((candidate) => candidate.shotId === shotId);
  if (!single && !shot) return decision("none", "missing_shot", requester);
  if (shot && !shotIncluded(shot)) return decision("canvas", "shot_excluded", requester);

  const detached = plan.canvasDetached === true || shot?.canvasDetached === true;
  // 最近一份盖着这一镜的授权（每点一次一份，住在各自那道门上）；它被拒 / 过期 / 撤回，这一镜就回到画布手里。
  const gate = spendAuthorizationGates(run).filter((candidate) => candidate.authorizationEnvelope.jobs.some((job) => job.shotId === shotId)).at(-1);
  const gateRejected = gate?.status === "rejected" || gate?.status === "expired" || gate?.status === "revoked";
  const job = latestJobForShot(run, shotId);
  const claim = single ? plan.claim : shot?.claim;

  // Money that may already be spent outranks every other signal, including a canvas claim record:
  // a detached or claimed shot may finish an already-paid attempt, but never starts a new one.
  if (job && NEEDS_RECONCILE.has(job.status)) return decision("production", "needs_reconcile", requester);
  if (job && IN_FLIGHT.has(job.status)) return decision("production", "in_flight", requester);
  // 最近一次尝试**确定**结束在被受理之前（证明过没离开本机 / 供应商当场明确拒绝）：没花钱、制作也不会再自己发它，
  // 这一镜立刻回到画布手里——不管计划有没有记成「已交」。以前这一条只在「已交」那一支里判，单镜 Run 在受理之前
  // 失败时计划还停在「已封」，于是落进下面的 awaiting_confirmation，画布永远认领不到（L-claim，2026-10-06）。
  if (job && jobEndedBeforeAcceptance(job)) return decision("canvas", "terminal", requester);
  if (claim?.by === "canvas" && claim.attempt === currentShotAttempt(run, shotId)) {
    return decision("canvas", "canvas_claimed", requester);
  }
  if (detached) return decision("canvas", "canvas_detached", requester);

  if (plan.state !== "submitted") {
    if (draftCardHidden(plan)) return decision("canvas", "shot_excluded", requester);
    if (gateRejected) return decision("canvas", "gate_rejected", requester);
    return isStoppedRunStatus(run.status)
      ? decision("canvas", "run_stopped", requester)
      : decision("production", "awaiting_confirmation", requester);
  }
  if (gateRejected) return decision("canvas", "gate_rejected", requester);
  if (gate && gate.status !== "approved") {
    return isStoppedRunStatus(run.status)
      ? decision("canvas", "run_stopped", requester)
      : decision("production", "awaiting_confirmation", requester);
  }
  if (job && terminalStatus(job.status)) return decision("canvas", "terminal", requester);
  if (job && (job.status === "planned" || job.status === "authorization_required" || job.status === "authorized")) {
    return isStoppedRunStatus(run.status)
      ? decision("canvas", "run_stopped", requester)
      : decision("production", "queued", requester);
  }
  if (!job) return isStoppedRunStatus(run.status)
    ? decision("canvas", "run_stopped", requester)
    : decision("production", "queued", requester);
  return isStoppedRunStatus(run.status)
    ? decision("canvas", "run_stopped", requester)
    : decision("production", "queued", requester);
}
