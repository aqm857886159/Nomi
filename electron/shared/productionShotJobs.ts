import { OUTPUT_RETRIEVAL_FAILED, type ProductionGenerationShot, type ProductionJob, type ProductionRun } from "../productionRun/productionRunTypes";

/** Statuses that have not crossed the provider submission boundary yet. */
export function isUnsubmittedJobStatus(status: ProductionJob["status"]): boolean {
  switch (status) {
    case "planned":
    case "authorization_required":
    case "authorized":
      return true;
    default:
      return false;
  }
}

/**
 * 这一个作业**有没有可能**已经被供应商受理（可能扣过钱）。「没有」只有三种证据：
 *   · 还没跨过提交边界（`isUnsubmittedJobStatus`：`submitOnce` 先落提交意图、再出站）；
 *   · 跨过之后被证明一个字节都没写出去（`markNotDispatched` → `provider_not_reached`，判据在 `outboundDispatchEvidence.ts`）；
 *   · 供应商当场明确拒绝（`markProviderRejected` → `provider_rejected`，同一个判据文件，2026-10-05 F3）。
 * 其余一律按「可能到过」——宁可让人多核对一次，也不许把一笔可能的扣费说成没花钱。
 *
 * 面板付费卡的失败文案、Agent `generate` 的失败码、这一次出价的逐镜结局，都只读这一个判据（付费卡① 23:30 第 3 点）。
 */
export function jobMayHaveReachedProvider(job: Pick<ProductionJob, "status" | "errorCode">): boolean {
  return !isUnsubmittedJobStatus(job.status) && !jobEndedBeforeAcceptance(job);
}

/**
 * 这一个作业已经结束、而且结束在被受理之前（证明过没写出去，或供应商当场明确拒绝）：没花钱，也不会再自己发。
 */
export function jobEndedBeforeAcceptance(job: Pick<ProductionJob, "status" | "errorCode">): boolean {
  return job.status === "needs_attention" && (job.errorCode === "provider_not_reached" || job.errorCode === "provider_rejected");
}

/**
 * 这一个作业已经结束、而且结束在供应商**答复之后**：供应商受理并给了结果，结果没能落进本机（`output_retrieval_failed`）。
 * 两种来路同一结局：引擎 B 取回失败（有任务号，`productionShotPhase.jobAwaitsRetrieval` 才给「重新取回」）；同步供应商
 * 答了、本机落地失败（`submissionOutbox.markResultLandingFailed`，没有任务号，只能再生成）。确定到过供应商（可能已扣钱），
 * 也确定不是「结果未知」——交接写回据此说「交到了」，不叫人去核对（2026-10-28）。
 */
export function jobEndedAfterProviderAnswer(job: Pick<ProductionJob, "status" | "errorCode">): boolean {
  return job.status === "needs_attention" && job.errorCode === OUTPUT_RETRIEVAL_FAILED;
}

/** 这些作业里有没有任何一笔可能到过供应商。一个作业都没有 = 没有。 */
export function anySubmissionMayHaveReachedProvider(jobs: readonly Pick<ProductionJob, "status" | "errorCode">[]): boolean {
  return jobs.some(jobMayHaveReachedProvider);
}

/** Stable shot address for both multi-shot metadata and legacy single-shot plans. */
export function productionShotId(run: Pick<ProductionRun, "generationPlan">, shotId: string): string | undefined {
  if (run.generationPlan?.shots?.length) return shotId;
  return run.generationPlan?.candidate.candidateId === shotId ? shotId : undefined;
}

/**
 * 画布节点 ↔ 镜的对应：单镜计划看 `generationPlan.nodeId`，多镜看 `shots[].nodeId`（「shot ↔ 画布节点」的单一真相）。
 * 返工要拿到 shotId 也走这里。
 */
export function productionShotIdForNode(run: Pick<ProductionRun, "generationPlan">, nodeId: string): string | undefined {
  const plan = run.generationPlan;
  if (!plan || !nodeId) return undefined;
  if (!plan.shots?.length) return plan.nodeId === nodeId ? plan.candidate.candidateId : undefined;
  return plan.shots?.find((shot) => shot.nodeId === nodeId)?.shotId;
}

/** Undefined addresses only the legacy single-shot Run; QA may address an old node-only record. */
export type ProductionShotAddress = string | Readonly<{ nodeId: string }>;

/** The one owner of the shot/node/legacy single-shot → generation job correspondence. */
export function jobsForShot(run: Pick<ProductionRun, "generationPlan" | "jobs">, address?: ProductionShotAddress): ProductionJob[] {
  if (typeof address === "object") {
    const shotId = productionShotIdForNode(run, address.nodeId);
    const addressed = shotId ? jobsForShot(run, shotId) : [];
    if (addressed.length) return addressed;
    return run.jobs.filter((job) => job.stageId === "generate" && job.nodeId === address.nodeId);
  }
  if (address === undefined) {
    if (run.generationPlan?.shots?.length) return [];
  } else if (!productionShotId(run, address)) return [];
  const multiShot = Boolean(run.generationPlan?.shots?.length);
  return run.jobs.filter((job) => job.stageId === "generate" && (!multiShot || job.metadata?.shotId === address));
}

export function latestJobForShot(run: ProductionRun, address?: ProductionShotAddress): ProductionJob | undefined {
  return jobsForShot(run, address)
    .slice()
    .sort((a, b) => (b.attempt - a.attempt) || (Date.parse(b.createdAt) - Date.parse(a.createdAt)))[0];
}

/** Unaddressable legacy records cannot grant permission to send the same shot again. */
export function hasUnresolvedShotSubmission(run: ProductionRun, address?: string): boolean {
  if (run.generationPlan?.shots?.length || run.jobs.length === 0) return false;
  return jobsForShot(run, address).length === 0;
}

/**
 * 这一镜此刻是第几次尝试（最新那个 job 的 attempt；一个 job 都没有 = 第 1 次）。画布认领记在哪一次、判定口拿认领比哪一次、
 * 认领命令号带哪一次，都读这一个值——三处各算一遍，就会出现「记的是第 2 次、号还是第 1 次的」那种漂移。
 */
export function currentShotAttempt(run: ProductionRun, shotId: string): number {
  return latestJobForShot(run, shotId)?.attempt ?? 1;
}

/** 这一镜勾没勾进这一批（`included` 缺省 = 勾进了）。 */
export function shotIncluded(shot: Pick<ProductionGenerationShot, "included">): boolean {
  return shot.included !== false;
}

/**
 * 这一镜还算不算这一批要交的活——批次「做完没有」和排队「第 n / N」都按它数，唯一的判据。三种情况不算：
 * - 没勾进这一批（`included:false`）；
 * - 从没被批过（一次任务都没有）：调度器只派有任务的镜（`batchScheduleDerivation.needsDispatch`），没被批的镜
 *   不是这一批的活——把它数进来，排队会说「第 1/2」而第 2 镜永远不会来，批次也永远凑不满（付费卡① 第 12 条）；
 * - 这一镜最新那次尝试已经被制作放手（`detached`：画布上删了它的节点、画布接手了它、返工门被拒）。制作不会再派它，
 *   这一批也等不到它的结果。以前它被数成「在跑」，批次永远凑不满完成数，Run 一直停在 running（2026-09-29 #921 彩排）。
 * 已经交给供应商的那次（在跑 / 已出片）照样算：钱花了，结果要收尾。
 */
export function shotCountsTowardBatch(run: ProductionRun, shot: Pick<ProductionGenerationShot, "shotId" | "included">): boolean {
  const latest = latestJobForShot(run, shot.shotId);
  return shotIncluded(shot) && latest !== undefined && latest.status !== "detached";
}
