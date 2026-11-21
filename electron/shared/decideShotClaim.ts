import type { ProductionJobStatus, ProductionRun } from "../productionRun/productionRunTypes";
import { currentShotAttempt, jobEndedBeforeAcceptance, latestJobForShot, shotIncluded } from "./productionShotJobs";
import { isStoppedRunStatus } from "./productionRunStop";
import { productionJobOpenAs } from "./productionJobOpenAs";
import { spendAuthorizationGates } from "./productionSpendAuthority";
import { currentPresentation, draftCardHidden, IN_APP_AGENT_ORIGIN_HOST, latestHandOver, offerShots } from "./productionGenerationPresentation";

export type ShotClaimRequester = "canvas" | "production";
export type ShotClaimHolder = "canvas" | "production" | "none";
export type ShotClaimReason =
  | "missing_run"
  | "missing_shot"
  | "plan_cancelled"
  | "shot_excluded"
  | "canvas_detached"
  | "awaiting_confirmation"
  /** 面板付费卡这一次出价摆着它、还没决定：节点上直接点生成就是用户的决定（卡随之变「生成剩下 N 段」）。 */
  | "offered"
  /** 付费卡 / 「直接生成」档已经把它交给画布（那一个画布 Run 在交，或已经交完）。 */
  | "handed_over"
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

/**
 * 面板付费卡那一次出价里这一镜归谁（D2 第③步：卡上点「生成」= 逐镜交给画布单节点提交，一台发动机）。
 * 只管 Agent 在面板里起的出价；外部宿主的出价照旧（它们的确认在它们自己那边）。`undefined` = 出价说明不了，往下照旧判。
 *
 *   · 正在交给画布：只有交接绑着的那一个画布 Run 认领得到；别的（用户在节点上又点了一次）排在后面——同一镜只发一次；
 *   · 出价开着、还没决定：画布可以直接拿走（节点上点生成就是用户对这一镜的决定）；
 *   · 出价开着、交接已落定（交到了 / 结果未知 / 没发出去）：归画布（节点上重来由画布那一侧的在途准入兜住，不会叠单）；
 *   · 用户点了「不生成 ×」：归画布（他要在节点上自己生成随时可以）。
 */
function inAppOfferDecision(
  run: ProductionRun,
  shotId: string,
  requester: ShotClaimRequester,
  canvasRunId: string | undefined,
): ShotClaimDecision | undefined {
  if (run.origin.host !== IN_APP_AGENT_ORIGIN_HOST) return undefined;
  const presentation = currentPresentation(run.generationPlan);
  if (!presentation) return undefined;
  const shot = offerShots(run).find((entry) => entry.shotId === shotId);
  if (!shot) return undefined;
  if (shot.state === "handing_over") {
    return requester === "canvas" && canvasRunId !== undefined && shot.handOver?.canvasRunId === canvasRunId
      ? decision("canvas", "handed_over", requester)
      : decision("production", "queued", requester);
  }
  if (presentation.closed) return undefined;
  switch (shot.state) {
    case "undecided": return decision("canvas", "offered", requester);
    case "removed": return decision("canvas", "shot_excluded", requester);
    case "sent": case "unknown": case "not_sent": return decision("canvas", "handed_over", requester);
    case "taken_by_canvas": case "approved": return undefined;
  }
}

/**
 * The single durable, read-only claim decision shared by canvas and production callers.
 * `canvasRunId`：画布那一侧来要的时候，是哪一个画布单镜 Run（付费卡交接只认它绑着的那一个）。
 */
export function decideShotClaim(
  run: ProductionRun | null | undefined,
  shotId: string | undefined,
  requester: ShotClaimRequester,
  options: Readonly<{ canvasRunId?: string }> = {},
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
  const openAs = job ? productionJobOpenAs(job.status) : null;
  if (openAs) return decision("production", openAs, requester);
  // 最近一次尝试**确定**结束在被受理之前（证明过没离开本机 / 供应商当场明确拒绝）：没花钱、制作也不会再自己发它，
  // 这一镜立刻回到画布手里——不管计划有没有记成「已交」。以前这一条只在「已交」那一支里判，单镜 Run 在受理之前
  // 失败时计划还停在「已封」，于是落进下面的 awaiting_confirmation，画布永远认领不到（L-claim，2026-10-06）。
  if (job && jobEndedBeforeAcceptance(job)) return decision("canvas", "terminal", requester);
  // 面板付费卡那一次出价说了算的几种（排在旧认领之前：卡正把这一镜交给画布时，别的画布 Run 不许借旧认领抢）。
  const offer = inAppOfferDecision(run, shotId, requester, options.canvasRunId);
  if (offer) return offer;
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

/**
 * 这一镜**上一次**是哪台发动机跑的——它失败之后，节点上那颗「重试」照它走回原来那一台（D2 第③步：一台发动机）。
 *
 *   · 这一次出价把它交给了画布（付费卡 / 「直接生成」档，交接账上有它），或节点上认领了这一次尝试 → 画布；
 *   · 否则制作流程自己给它派过作业（外部宿主 / 调度器 / 升级前批过的旧卡）→ 制作（返工链）；
 *   · 一笔都没派过 → 画布（节点上生成的就是画布那一台）。
 *
 * 和 `decideShotClaim` 是两个问题：那个问「此刻谁能发」（失败之后两边都说归画布），这个问「刚才是谁发的」。
 * 只看「是不是多镜 Run」会把交给画布、在画布上失败的那一镜送回制作流程的付费门 + 调度器（第二台发动机）。
 */
export function lastShotEngine(run: ProductionRun, shotId: string): "production" | "canvas" {
  if (latestHandOver(currentPresentation(run.generationPlan), shotId)) return "canvas";
  const plan = run.generationPlan;
  const claim = plan?.shots?.length ? plan.shots.find((candidate) => candidate.shotId === shotId)?.claim : plan?.claim;
  if (claim?.by === "canvas" && claim.attempt === currentShotAttempt(run, shotId)) return "canvas";
  return latestJobForShot(run, shotId) ? "production" : "canvas";
}
