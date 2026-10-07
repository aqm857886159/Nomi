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
// 渲染层只剩制作专属的小标（等你确认 / 还没生成 / 排队中 / 已停——它们没有普通生成的对应物），也读这里。
// 同一个输入，两端的判定逐字相同，不会一个说在生成、一个说已停。
//
// 真相源 = Run 的 jobs[] + status（纯派生，无第二份状态）。
import { OUTPUT_RETRIEVAL_FAILED, type ProductionJob, type ProductionJobStatus, type ProductionRun, type ProductionRunStopReason } from "../productionRun/productionRunTypes";
import { runStopReason } from "./productionRunStop";
import { tagNomiError } from "./nomiErrorCodes";
export { decideShotClaim } from "./decideShotClaim";
import { shotCountsTowardBatch, shotIncluded } from "./productionShotJobs";
import { removedShotIds, undecidedShotIds } from "./productionGenerationPresentation";

/**
 * - `awaiting_confirmation`：卡正摆着它 / 它那道付费门在等人——在等**用户**，不是在排队；
 * - `removed`：用户在卡上点了「去掉这张 / 这段」——不生成，占位留着（付费卡逐镜第 2 条）；
 * - `not_generated`：从没被批过（没有任何一次任务），此刻也没人在问——它不在任何队列里；
 * - `queued`：批过了（有任务、还没派出去），等轮到它；
 * - `stopped`：批过了、没派出去，而这次制作停着；
 * - `unretrieved`：供应商已经做完、钱已经花了，只是结果没能取回本机（#975 A2 / V-975）。**不是**失败：
 *   节点挂「可找回」，出路只有免费的「重新取回」；任何批量生成都不把它算进去（算进去就是让人再付一次钱）；
 * - `generating` / `failed` / `done` / `unretrieved`：由节点自己的运行记录画（主进程落地投影写进去）。
 */
export type ProductionShotPhase = "awaiting_confirmation" | "removed" | "not_generated" | "queued" | "generating" | "stopped" | "failed" | "unretrieved" | "done";

/**
 * 「这次任务已经生成、只差把结果取回来」——全仓唯一一处判据（#975 A2 / V-975）。
 * 写下它的是 productionGenerationSubmission.materialize（确定性取回失败）；读它的：镜头阶段投影（下面）、
 * 「重新取回」命令（productionRunService）、任务面板（productionRunView）。任何地方要问「这一镜能不能重新取回 /
 * 该不该进批量重生成」都只问这里，不许再拿 errorCode 自己比。
 */
export function jobAwaitsRetrieval(job: Pick<ProductionJob, "status" | "errorCode" | "providerTaskId"> | null | undefined): boolean {
  return Boolean(job && job.status === "needs_attention" && job.errorCode === OUTPUT_RETRIEVAL_FAILED && job.providerTaskId);
}

type ProductionShotStateFields = {
  /** 这一镜最新的那次任务（从没被批过时没有）。投影用它的 jobId 当节点运行记录的身份。 */
  job?: ProductionJob;
  /** 排队中：第 n / N（n=本镜在待生成序列里的位次，从 1 起；N=总镜数）。仅 queued 有。 */
  queueIndex?: number;
  queueTotal?: number;
  /** failed 的人话原因。 */
  failureMessage?: string;
};

/**
 * 一镜在画布上的运行状态。`stopped` **一定**带着停下的原因：停的那一刻记下的事实（`runStopReason`，
 * electron/shared/productionRunStop.ts），文案与入口据此选；上一版写下的 Run 没记原因 = `unknown`——绝不猜成预算
 * （以前 needs_attention 一律被说成「预算已用完」）。别的阶段没有这一格，读的人不用再兜底。
 */
export type ProductionShotState =
  | (ProductionShotStateFields & { phase: "stopped"; stoppedReason: ProductionRunStopReason | "unknown" })
  | (ProductionShotStateFields & { phase: Exclude<ProductionShotPhase, "stopped">; stoppedReason?: never });

/**
 * job.status → 这一镜落在哪一段。**穷尽**：ProductionJobStatus 新增一个状态而这里没给出归属，编译就过不去
 * （以前是三份手抄的 Set，新状态会静悄悄落进「排队中」）。
 * null = 这个状态本身说明不了什么（还没派发 / 身份待核），交给 Run 状态判「排队中」还是「已停」；
 * 已脱离（detached）也是 null，但 deriveProductionShotState 会先把它排除——制作不再拥有这一镜。
 * failed 是候选：随批次一起停下（急停 / 撤单）时再细分成 stopped（见下）。
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

function isSingleShotPlan(run: ProductionRun): boolean {
  return !run.generationPlan?.shots || run.generationPlan.shots.length === 0;
}

/**
 * 排队序列的分母 N 与位次按哪些镜算——**与调度器的 `progressShots` 同规则**
 * （`electron/productionRun/batchScheduleDerivation.ts`：`videoShots.length > 0 ? videoShots : anchors`）。
 * 视频镜按 `shotCountsTowardBatch` 数（被画布拿走的镜不再占一个位次），参考卡按勾没勾进这一批数。
 * 调度器为「只有参考卡」的批次留了那一支；少了它用户会看到一排「排队中 1/0」。
 */
function queueShotsOf(run: ProductionRun): { shotId: string }[] {
  const shots = run.generationPlan?.shots ?? [];
  const videoShots = shots.filter((shot) => shot.role !== "anchor" && shotCountsTowardBatch(run, shot));
  const anchors = shots.filter((shot) => shot.role === "anchor" && shotIncluded(shot));
  return (videoShots.length > 0 ? videoShots : anchors).map((shot) => ({ shotId: shot.shotId }));
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

const PRODUCTION_RUN_RECORD_PREFIX = "production-";

/** 制作投影写进画布节点的那条运行记录的身份：这一镜那次任务（同一任务反复投影幂等，返工 = 新任务 = 新记录）。 */
export function productionRunRecordId(jobId: string): string {
  return `${PRODUCTION_RUN_RECORD_PREFIX}${jobId}`;
}

/**
 * 这条节点运行记录是不是制作投影写的。它**只归制作投影管**（主进程 Run 才知道它在不在跑）：
 * 画布自己的重开收敛（「没任务号的生成中 = 幽灵转圈」）不许碰它——2026-09-26 真付费 T5：重开窗口后
 * 在跑的第 1 镜被收成空闲，看着像没在跑。主进程写 id、渲染层认 id 都经这两个函数，前缀不许各写一份。
 */
export function isProductionRunRecord(record: Readonly<{ id?: unknown }> | null | undefined): boolean {
  return typeof record?.id === "string" && record.id.startsWith(PRODUCTION_RUN_RECORD_PREFIX);
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
 * 一镜此刻的段。找不到这一镜 → null；制作已经放手（`detached`：画布接手 / 占位被删）→ null。其余每一种都有自己的段，
 * 不再用 null 表示「还没点头」——null 在画布上什么都不画，用户分不清「在等我」「没人管」还是「我们忘了」。
 *
 * **没点就不叫排队中**（付费卡① 第 12 条）。「排队」只说一件事：这一镜被批过、有任务、还没派出去。判据只看账本：
 * - 最新那次任务还停在人工门前（`jobAwaitsHuman`：报价卡 / 返工·续拍待授权）→ 等你确认；
 * - 一次任务都没有 = 从没被批过：这一次出价里还没决定它（卡正摆着它）→ 等你确认；用户在卡上去掉过它 → 已去掉，不生成；
 *   否则 → 还没生成（包括卡被 × 关掉时没决定的镜）。调度器只派有任务的镜
 *   （`batchScheduleDerivation.needsDispatch`），所以没有任务的镜说「排队中」是一句永远不会兑现的话
 *   （2026-09-25 走查：只确认了第 1 镜，第 2 镜一直挂着「排队中」；2026-09-30 用户实见：没确认的视频节点挂着「排队中 · 第 1/1」）；
 * - 有任务、还在派发前：Run 停着 → 已停（原因照 Run 记下的说）；否则 → 排队中（第 n/N）。
 * - 禁「永远等待生成」假进度：没有任务绝不显「生成中」。
 */
export function deriveProductionShotState(run: ProductionRun | null | undefined, shotId: string | undefined): ProductionShotState | null {
  if (!run || !shotId || !run.generationPlan) return null;
  const single = isSingleShotPlan(run);
  const shot = single ? undefined : run.generationPlan.shots?.find((candidate) => candidate.shotId === shotId);
  if (!single && !shot) return null;
  if (single && shotId !== run.generationPlan.candidate.candidateId) return null;
  const job = latestJob(jobsForShot(run, shotId));
  // 最新那次任务还停在人工门前（报价卡 / 返工·续拍待授权）：在等用户点头，供应商那边什么都还没发生。
  if (job && jobAwaitsHuman(job.status)) return { phase: "awaiting_confirmation", job };
  // 最新那次任务已脱离制作（画布认领了这一镜、计划被拒 / 脱离画布）：制作不会再派它，
  // 节点上既不是「排队中」也不是「已停 · 提额续拍」——点那个按钮续的会是别的镜头。
  if (job?.status === "detached") return null;
  // 提交结果未知（连接被重置 / 超时 / 提交途中重启）：供应商可能已经收下。这一镜**不是**「还没开拍」也不是「已停」，
  // 画成失败并带上机器码，节点按「结果没法确认」说话（与单镜生成同一句话），不给一键重试。
  if (job && (job.status === "submission_unknown" || job.status === "reconciling")) {
    return { phase: "failed", job, failureMessage: tagNomiError("submission-unknown", "The provider did not confirm this submission") };
  }
  const jobPhase = job ? productionJobPhase(job.status) : null;

  if (job && jobPhase === "done") return { phase: "done", job };
  // 已生成、取回失败：排在「失败 / 已停」之前——它不是失败，也不随批次一起停（钱已经花了，只差取回）。
  if (job && jobAwaitsRetrieval(job)) return { phase: "unretrieved", job, ...(job.errorMessage ? { failureMessage: job.errorMessage } : {}) };
  if (job && jobPhase === "failed") {
    // 「已停」vs「失败」：Run 停着，而这一镜是随批被停下的（cancelled_remote / too_late），或 job 没有真错因 = 已停；
    // 供应商拒（有真错因）或 Run 根本没停 = 失败。停下的原因只读 Run 记下的事实，不从错因码或 Run 状态猜（以前这里会猜成「预算」）。
    const stopReason = runStopReason(run);
    const stoppedWithBatch = job.status === "cancelled_remote" || job.status === "too_late" || (job.status === "needs_attention" && !job.errorCode);
    if (stopReason && stoppedWithBatch) return { phase: "stopped", job, stoppedReason: stopReason };
    return { phase: "failed", job, ...(job.errorMessage ? { failureMessage: job.errorMessage } : {}) };
  }
  if (job && jobPhase === "generating") return { phase: "generating", job };

  // 一次任务都没有 = 从没被批过：不在任何队列里。卡正摆着它就是在等用户；用户去掉过它就说去掉了；否则就是还没生成。
  // 「卡摆着哪几镜」只问这一次出价（`productionGenerationPresentation`），不从计划状态猜。
  if (!job) {
    if (undecidedShotIds(run).includes(shotId)) return { phase: "awaiting_confirmation" };
    if (removedShotIds(run).includes(shotId)) return { phase: "removed" };
    return { phase: "not_generated" };
  }
  // 有任务、还在派发前的档（批过了，等轮到它）：run 停着 → 显「已停」，原因照 Run 记下的说；否则「排队中（第 n/N）」。
  const stopReason = runStopReason(run);
  if (stopReason) return { phase: "stopped", job, stoppedReason: stopReason };
  // 排队位次：anchor 不进视频序列（它先于镜跑），显纯「排队中」；单镜也没有序列可言。
  if (single || shot?.role === "anchor") return { phase: "queued", job };
  const videoShots = queueShotsOf(run);
  const total = videoShots.length;
  const index = videoShots.findIndex((candidate) => candidate.shotId === shotId);
  return { phase: "queued", job, ...(index >= 0 && total > 0 ? { queueIndex: index + 1, queueTotal: total } : {}) };
}

/** 这个 Run 里提交结果未知的镜（供应商可能已经收下）：镜 id（没有就用任务 id）。常驻 Agent 读任务状态时据此被告知别再 generate。 */
export function unknownSubmissionShotLabels(run: Pick<ProductionRun, "jobs"> | null | undefined): string[] {
  return (run?.jobs ?? [])
    .filter((job) => job.status === "submission_unknown" || job.status === "reconciling")
    .map((job) => (typeof job.metadata?.shotId === "string" && job.metadata.shotId ? job.metadata.shotId : job.jobId));
}
