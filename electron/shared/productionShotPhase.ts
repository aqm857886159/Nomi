// 制作（ProductionRun）里「一镜现在处在哪一段」的**唯一判定**（2026-09-25 从渲染层搬到中立层）。
//
// 为什么搬：以前只有渲染层的占位组件读它（`shotPlaceholderState`），主进程一侧看不到；于是「一镜在生成中」
// 在画布上有两个 owner——普通生成写的是节点自己的状态（NodeGeneratingOverlay 画等待动画），
// Agent 付费卡建出的镜头却由渲染层轮询一份 Run 快照、另画一套「整卡模糊 + N 字标」。两份真相各判各的，
// 供应商那边早出片了，节点还在转（用户 2026-09-25 原话：「没有复用逻辑，视频早就生产出来了，
// 他这里一直显示生成中」）。
//
// 现在：主进程的画布落地投影（`multiShotCanvasLanding.buildMaterializeShotsPayload`）用这里判出每一镜的段，
// 把「生成中 / 失败 / 结束」写进节点自己的运行记录——和普通生成同一份状态、同一套画法；
// 渲染层只剩「排队中 / 已停」两块制作专属的小标（它们没有普通生成的对应物），也读这里。
// 同一个输入，两端的判定逐字相同，不会一个说在生成、一个说已停。
//
// 真相源 = Run 的 jobs[] + status（纯派生，无第二份状态）。
import type { ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus } from "../productionRun/productionRunTypes";

export type ProductionShotPhase = "queued" | "generating" | "stopped" | "failed" | "done";

export type ProductionShotState = {
  phase: ProductionShotPhase;
  /** 这一镜最新的那次任务（排队中且还没派发时没有）。投影用它的 jobId 当节点运行记录的身份。 */
  job?: ProductionJob;
  /** 排队中：第 n / N（n=本镜在待生成序列里的位次，从 1 起；N=总镜数）。仅 queued 有。 */
  queueIndex?: number;
  queueTotal?: number;
  /** stopped 的原因：预算触顶(halt) 还是用户急停(stop)。文案据此选（提额续拍 / 继续剩余）。 */
  stoppedReason?: "budget" | "stopped";
  /** failed 的人话原因。 */
  failureMessage?: string;
};

/**
 * job.status → 这一镜落在哪一段。**穷尽**：ProductionJobStatus 新增一个状态而这里没给出归属，编译就过不去
 * （以前是三份手抄的 Set，新状态会静悄悄落进「排队中」）。
 * null = 这个状态本身说明不了什么（还没派发 / 身份待核 / 已脱离画布），交给 Run 状态判「排队中」还是「已停」。
 * failed 是候选：有预算/急停错因时再细分成 stopped（见下）。
 */
export function productionJobPhase(status: ProductionJobStatus): ProductionShotPhase | null {
  switch (status) {
    case "submitting":
    case "provider_accepted":
    case "polling":
    case "retry_wait":
    case "downloading":
    case "validating_technical":
    case "validating_content":
      return "generating";
    case "ready":
    case "adopted":
      return "done";
    case "needs_attention":
    case "cancelled_remote":
    case "too_late":
      return "failed";
    case "planned":
    case "authorization_required":
    case "authorized":
    case "submit_intent_persisted":
    case "submission_unknown":
    case "reconciling":
    case "cancel_requested":
    case "detached":
      return null;
  }
}

/**
 * 这个 job 是不是还停在人工门前：报价卡 / 逐镜确认在等，供应商那边什么都没发生。
 * 写成 `Record<ProductionJobStatus, boolean>` 让编译器拦：新长一个状态而这里没表态，类型检查当场红——
 * 不会静默落进「排队中」（调度器的「authorization_required is still waiting for a human」也读这一张）。
 */
const AWAITS_HUMAN: Readonly<Record<ProductionJobStatus, boolean>> = {
  planned: true, authorization_required: true,
  authorized: false, submit_intent_persisted: false, submitting: false, provider_accepted: false, polling: false,
  retry_wait: false, downloading: false, validating_technical: false, validating_content: false, ready: false,
  adopted: false, submission_unknown: false, reconciling: false, needs_attention: false, cancel_requested: false,
  cancelled_remote: false, detached: false, too_late: false,
};

export function jobAwaitsHuman(status: ProductionJobStatus): boolean {
  return AWAITS_HUMAN[status];
}

/** 这次任务是不是已经交给供应商、还在等结论（观察者据此判断还要不要再去问）。 */
export function isProductionJobInFlight(job: Pick<ProductionJob, "status" | "providerTaskId">): boolean {
  return Boolean(job.providerTaskId) && productionJobPhase(job.status) === "generating";
}

/**
 * 这一镜此刻是否归制作流程生成——画布再发一次同一镜就是重复生成、重复扣费，所以画布的「能不能生成」「生成全部」都读它。
 * 与「节点上显示哪一段」（deriveProductionShotState）是两件事，分开判，改显示不许顺带改归属：
 * - Agent 拟好、报价卡还没摆出来（cardHidden 草稿）→ 不归，用户可在画布上自己生成；
 * - 报价卡摆在用户面前等确认 → 归（用户会在卡上决定；画布先发 + 再确认 = 两次）；
 * - 已确认：排队 / 生成中 → 归；已停 / 失败 / 完成 → 不归；丢掉的计划、不在付费范围里的镜 → 不归。
 * （2026-09-25：Agent 起草的镜头卡片等确认时，底栏仍把它算进「生成全部」。）
 */
export function productionShotOwnsGeneration(run: ProductionRun | null | undefined, shotId: string | undefined): boolean {
  const plan = run?.generationPlan;
  if (!run || !plan || !shotId || plan.state === "cancelled") return false;
  if (plan.state !== "submitted") return plan.cardHidden !== true && planIncludesShot(run, shotId);
  const phase = deriveProductionShotState(run, shotId)?.phase;
  return phase === "queued" || phase === "generating";
}

function planIncludesShot(run: ProductionRun, shotId: string): boolean {
  if (isSingleShotPlan(run)) return shotId === run.generationPlan?.candidate.candidateId;
  const shot = run.generationPlan?.shots?.find((candidate) => candidate.shotId === shotId);
  return Boolean(shot && shot.included !== false);
}

// 「已停」而非「失败」的 job 错因：预算触顶 / 急停到达这镜（可续拍，warning 非 danger）。provider 拒 = 真失败。
const HALT_ERROR_CODES = new Set(["budget_exhausted", "budget_halt", "batch_stopped", "restart_recovery_required"]);

/** run 整体处于「停」的态：急停(pausing/paused/cancelled) 或预算 halt(needs_attention)。 */
function runIsStopped(status: ProductionRunStatus): boolean {
  return status === "pausing" || status === "paused" || status === "cancelled" || status === "needs_attention";
}

function isSingleShotPlan(run: ProductionRun): boolean {
  return !run.generationPlan?.shots || run.generationPlan.shots.length === 0;
}

/**
 * 排队序列的分母 N 与位次按哪些镜算——**与调度器的 `progressShots` 同规则**
 * （`electron/productionRun/batchScheduleDerivation.ts`：`videoShots.length > 0 ? videoShots : anchors`）。
 * 调度器为「只有参考卡」的批次留了那一支；少了它用户会看到一排「排队中 1/0」。
 */
function includedVideoShots(run: ProductionRun): { shotId: string }[] {
  const included = (run.generationPlan?.shots ?? []).filter((shot) => shot.included !== false);
  const nonAnchors = included.filter((shot) => shot.role !== "anchor");
  return (nonAnchors.length > 0 ? nonAnchors : included).map((shot) => ({ shotId: shot.shotId }));
}

/**
 * 这一镜的全部任务（含返工 attempt）。多镜按 `job.metadata.shotId` 认；单镜计划没有 shots[]，
 * 它唯一那一镜的身份就是候选 id（与落地投影 `buildMaterializeShotsPayload` 同一个约定），生成段的每个 job 都属于它。
 */
function jobsForShot(run: ProductionRun, shotId: string): ProductionJob[] {
  if (isSingleShotPlan(run)) {
    return shotId === run.generationPlan?.candidate.candidateId ? run.jobs.filter((job) => job.stageId === "generate") : [];
  }
  return run.jobs.filter((job) => typeof job.metadata?.shotId === "string" && job.metadata.shotId === shotId);
}

function latestJob(jobs: readonly ProductionJob[]): ProductionJob | undefined {
  if (jobs.length === 0) return undefined;
  return jobs.reduce((latest, job) => (Date.parse(job.createdAt) >= Date.parse(latest.createdAt) ? job : latest));
}

/**
 * 画布节点 ↔ 镜的对应：单镜计划看 `generationPlan.nodeId`，多镜看 `shots[].nodeId`（「shot ↔ 画布节点」的单一真相）。
 * 返工要拿到 shotId 也走这里。
 */
export function productionShotIdForNode(run: ProductionRun, nodeId: string): string | undefined {
  const plan = run.generationPlan;
  if (!plan || !nodeId) return undefined;
  if (isSingleShotPlan(run)) return plan.nodeId === nodeId ? plan.candidate.candidateId : undefined;
  return plan.shots?.find((shot) => shot.nodeId === nodeId)?.shotId;
}

/**
 * 一镜此刻的段。找不到这一镜 → null。
 *
 * - 没派发、run 也没停：本次付费范围里的镜「排队中（第 n/N）」；**不在本次付费范围里（`included:false`）
 *   又从没派发过的镜不属于任何队列**——返回 null。以前它们也显「排队中」，而这批跑完了它们还在「排队」，
 *   是一句永远不会兑现的话（2026-09-25 走查：只确认了第 1 镜，第 2 镜一直挂着「排队中」）。
 * - 禁「永远等待生成」假进度：没有 job 绝不显「生成中」。
 * - **用户还没点头 = 什么都不说**（2026-09-24）：草稿（`draft_shots` 建的、报价卡还在等）、job 还停在人工门前、
 *   没点头就取消——返回 null。以前这些都落到「排队中」：Agent 按「先别生成」建的草稿挂着「排队中 · 第 1/1」，
 *   读起来像已经在排队花钱（那一刻 0 job、0 请求）。「派出去了没有」只看两件事：`jobAwaitsHuman`（人工门表），与没有 job 时计划是否已提交、这一镜是否勾进了这一批。
 */
export function deriveProductionShotState(run: ProductionRun | null | undefined, shotId: string | undefined): ProductionShotState | null {
  if (!run || !shotId || !run.generationPlan) return null;
  const single = isSingleShotPlan(run);
  const shot = single ? undefined : run.generationPlan.shots?.find((candidate) => candidate.shotId === shotId);
  if (!single && !shot) return null;
  if (single && shotId !== run.generationPlan.candidate.candidateId) return null;
  const job = latestJob(jobsForShot(run, shotId));
  // 最新那次任务还停在人工门前（报价卡 / 返工·续拍待授权）：什么都还没发生。
  if (job && jobAwaitsHuman(job.status)) return null;
  const jobPhase = job ? productionJobPhase(job.status) : null;

  if (job && jobPhase === "done") return { phase: "done", job };
  if (job && jobPhase === "failed") {
    // 区分「已停」vs「失败」：预算/急停错因（HALT_ERROR_CODES）或批被停/取消到达这镜 = 已停（可续拍，warning）；
    // provider 拒（有真错因）= 失败（danger）。run 整体已停 + 无真错因也算已停。
    const haltedByCode = job.errorCode !== undefined && HALT_ERROR_CODES.has(job.errorCode);
    const batchStopped = job.status === "cancelled_remote" || job.status === "too_late";
    if (haltedByCode || batchStopped || (job.status === "needs_attention" && !job.errorCode && runIsStopped(run.status))) {
      return { phase: "stopped", job, stoppedReason: haltedByCode && job.errorCode !== "batch_stopped" ? "budget" : run.status === "needs_attention" ? "budget" : "stopped" };
    }
    return { phase: "failed", job, ...(job.errorMessage ? { failureMessage: job.errorMessage } : {}) };
  }
  if (job && jobPhase === "generating") return { phase: "generating", job };

  // 没有 job 时，只有计划已提交、这一镜又勾进了这一批，它才真的在排队（批次会自己轮到它）。
  // 否则是用户还没点头（草稿 / 报价卡在等 / 没点头就取消），或者这镜没被勾进这一批：它不在任何队列里。
  if (!job && (run.generationPlan.state !== "submitted" || shot?.included === false)) return null;
  // 无 job 或 job 还在派发前的档：run 已停 → 显「已停」；否则「排队中（第 n/N）」。
  if (runIsStopped(run.status)) {
    return { phase: "stopped", ...(job ? { job } : {}), stoppedReason: run.status === "needs_attention" ? "budget" : "stopped" };
  }
  // 排队位次：anchor 不进视频序列（它先于镜跑），显纯「排队中」；单镜也没有序列可言。
  if (single || shot?.role === "anchor") return { phase: "queued", ...(job ? { job } : {}) };
  const videoShots = includedVideoShots(run);
  const total = videoShots.length;
  const index = videoShots.findIndex((candidate) => candidate.shotId === shotId);
  return { phase: "queued", ...(job ? { job } : {}), ...(index >= 0 && total > 0 ? { queueIndex: index + 1, queueTotal: total } : {}) };
}
