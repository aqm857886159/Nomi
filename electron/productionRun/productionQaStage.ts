// QA orchestration stays on the existing Run repository/renderer boundaries.
import { areRequestedShotsAssessed } from '../shared/shotReviewEvidence'
import { adoptedGenerationShotNodeIds, buildQaRetryPlans, buildQaStageOutcome, qaVerdictsForRequestedShots, type QaVerifyResponse } from './productionQaVerdict'
import { logError } from '../logging/logger'
import type { DriverOpsDeps } from './productionRunDriverOps'
import type { ProductionRun } from './productionRunTypes'

/** Review belongs to the exact generation jobs and landed artifact versions it observed. */
function qaInputSnapshot(run: ProductionRun): string {
  return JSON.stringify({ jobs: run.jobs.filter(job => job.stageId === 'generate'), artifacts: run.artifacts.filter(artifact => artifact.stageId === 'generate') })
}

export function createQaStageRunner(deps: Pick<DriverOpsDeps, 'requireRun' | 'executeInternal' | 'requestRenderer' | 'stageValue'> & { isSemanticMultiShotRun: (run: ProductionRun) => boolean }) {
  const { requireRun, executeInternal, requestRenderer, stageValue, isSemanticMultiShotRun } = deps
  /**
   * W1.5 qa 阶段：对本次已 adopted 的生成镜头发 production.verify-shots 给渲染层（复用现成
   * verifyShotsAndReport 判分+对账闭环），把 per-shot 判决落成 qa.verdict 事件 + qa 阶段摘要。
   * qa 是「生成后判分呈现」不是新门：不弹确认、不改状态机。旧
   * direction/legacy 流程在渲染层不可达时可记录「审片跳过」；语义多镜
   * 交付则必须拿到验证结果，失败进入 needs_attention，禁止假装完成。
   */
  async function runQaStage(projectId: string, runId: string, incoming: ProductionRun): Promise<{ run: ProductionRun; accepted: boolean }> {
    let current = incoming
    const reviewedSnapshot = qaInputSnapshot(current)
    const shotNodeIds = adoptedGenerationShotNodeIds(current)
    let response: QaVerifyResponse | null = null
    let verificationFailed = false
    if (shotNodeIds.length > 0) {
      try {
        response = await requestRenderer('production.verify-shots', { projectId, runId, shotNodeIds }, 10 * 60_000) as QaVerifyResponse
        response = { ...response, requestedShotIds: shotNodeIds, verdicts: qaVerdictsForRequestedShots(response, shotNodeIds) }
        verificationFailed = !areRequestedShotsAssessed(shotNodeIds, response.verdicts!.flatMap(item => item.assessment ? [item.assessment] : []))
      } catch (error) {
        verificationFailed = true
        logError('production-run', 'shot-verify-failed-qa-skipped', error)
        response = null
      }
    }
    current = requireRun(projectId, runId)
    if (current.status !== 'running' || current.stageId !== 'qa' || qaInputSnapshot(current) !== reviewedSnapshot) return { run: current, accepted: false }
    if (verificationFailed && isSemanticMultiShotRun(current)) {
      current = requireRun(projectId, runId)
      current = executeInternal(projectId, runId, current, 'stage.upsert', {
        stage: stageValue(current, 'qa', { status: 'needs_attention', qaSummary: '审片服务不可用，未继续组装；请重试审片' }),
      }, `driver-${runId}-qa-attention-${current.revision}`).run
      if (current.status === 'running') {
        current = executeInternal(projectId, runId, current, 'run.status', { status: 'needs_attention', reason: 'failed' }, `driver-${runId}-qa-attention-run-${current.revision}`).run
      }
      return { run: current, accepted: false }
    }
    const outcome = buildQaStageOutcome(shotNodeIds.length === 0 ? { skipped: true, skipReason: '本次没有可审片的已生成镜头' } : response)
    current = requireRun(projectId, runId)
    const retryPlans = Array.isArray(response?.verdicts) ? buildQaRetryPlans(current, response.verdicts) : []
    let verdictIndex = 0
    for (const event of outcome.events) {
      const verdict = response?.verdicts?.[verdictIndex]
      const retry = verdict ? retryPlans.find((plan) => plan.shotNodeId === verdict.shotNodeId) : undefined
      const retrySuffix = retry
        ? retry.eligible
          ? `；已安排定向重滚（第 ${retry.retryCount} 次）：${retry.retryReason}`
          : `；未重滚（${retry.blockedReason === 'budget_exhausted' ? '重试预算已用尽' : '已达到重试上限'}）`
        : ''
      // The same shot can be reviewed again after a targeted retry. Include the current
      // revision in this durable command id so a later QA pass cannot replay an old verdict
      // snapshot and then hit a revision conflict while appending the stage summary.
      current = executeInternal(projectId, runId, current, 'qa.verdict', { summary: `${event.summary}${retrySuffix}` }, `driver-${runId}-qa-verdict-${verdictIndex}-${current.revision}`).run
      verdictIndex += 1
    }
    // Persist retry decisions as new jobs. Keeping the original job immutable makes the first
    // result and the targeted retry independently inspectable; the driver re-enters generation
    // only for these authorized retry jobs, never for passing shots.
    for (const retry of retryPlans.filter((plan) => plan.eligible)) {
      const parent = current.jobs.find((job) => job.jobId === retry.parentJobId)
      if (!parent || current.jobs.some((job) => job.parentJobId === retry.parentJobId && job.retryCount === retry.retryCount)) continue
      const retryJob = {
        ...parent,
        jobId: `${parent.jobId}:retry-${retry.retryCount}`,
        status: 'authorized' as const,
        attempt: retry.nextAttempt,
        idempotencyKey: `${parent.idempotencyKey}:retry-${retry.retryCount}`,
        parentJobId: parent.jobId,
        retryCount: retry.retryCount,
        retryReason: retry.retryReason,
        metadata: {
          ...(parent.metadata || {}),
          retryCount: retry.retryCount,
          retryReason: retry.retryReason,
          retryDirective: retry.retryDirective,
          parentJobId: parent.jobId,
        },
        providerTaskId: undefined,
        errorCode: undefined,
        errorMessage: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      current = executeInternal(projectId, runId, current, 'qa.retry.schedule', { job: retryJob }, `driver-${runId}-qa-retry-${retry.shotNodeId}-${retry.retryCount}`).run
    }
    const retrySummary = retryPlans.filter((plan) => plan.eligible).length
    const stageSummary = retrySummary > 0
      ? `${outcome.stageSummary}；已安排 ${retrySummary} 镜定向重滚`
      : outcome.stageSummary
    const completed = executeInternal(projectId, runId, current, 'stage.upsert', {
      stage: stageValue(current, 'qa', {
        status: retrySummary > 0 ? 'running' : 'completed',
        ...(retrySummary > 0 ? {} : { completedAt: new Date().toISOString() }),
        qaSummary: stageSummary,
      }),
    }, `driver-${runId}-stage-qa-${current.revision}`).run
    return { run: completed, accepted: true }
  }

  return runQaStage
}
