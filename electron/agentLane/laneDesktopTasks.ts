import type { LaneTaskCandidate, LaneTaskFacts, LaneTaskStatus } from '../shared/agentLane/laneContracts'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import { canAdoptArtifact } from '../productionRun/productionRunReducer'
import { getProductionRunService, subscribeProductionRunChanges } from '../productionRun/productionRunRuntime'
import { runStopReason } from '../shared/productionRunStop'

/**
 * needs_attention 在 Agent 任务列表里算「失败」还是「停了」：只读 Run 在停下那一刻记下的原因（runStopReason）。
 * 以前一律当失败。等用户再确认一次（consent_expired）是停着等他，不是失败。
 */
function attentionTaskStatus(run: ProductionRun): LaneTaskStatus {
  const reason = runStopReason(run)
  switch (reason) {
    case 'consent_expired':
    case 'landing_failed':
    case 'user_paused':
    case 'user_cancelled':
      return 'stopped'
    case 'failed':
    case 'restart_recovery':
    case 'unknown':
    case null:
      return 'failed'
    default:
      return ((value: never) => value)(reason)
  }
}

/** Domain events invalidate cached facts; token deltas only renew expired preview handles. */
export function createDesktopLaneTasks(projectId: string, refresh: () => void) {
  const facts = new Map<string, { value: LaneTaskFacts; expiresAt: number }>()
  function project(run: ProductionRun) {
    const stagesTotal = run.stages.length
    const stagesDone = run.stages.filter((stage) => stage.status === 'completed').length
    const status = run.status === 'completed' ? 'complete' : run.status === 'cancelled' || run.status === 'paused' ? 'stopped'
      : run.status === 'needs_attention' ? attentionTaskStatus(run) : run.status === 'running' || run.status === 'exporting' || run.status === 'pausing' ? 'running' : 'queued'
    const candidates: LaneTaskCandidate[] = []
    let expiresAt = Infinity
    for (const artifact of run.artifacts) {
      // Written plans have their own review UI. A media candidate needs real pixels.
      if (!['image', 'video', 'audio', 'model3d', 'export'].includes(artifact.kind) || artifact.status === 'rejected') continue
      try {
        const projected = getProductionRunService().readArtifactProjection(projectId, run.runId, artifact.artifactId)
        if (projected.projectId !== projectId || projected.runId !== run.runId || projected.artifactId !== artifact.artifactId) continue
        const preview = projected.poster ?? (artifact.kind === 'image' || artifact.thumbnailRelativePath ? projected.preview : undefined)
        if (!preview || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now()) continue
        candidates.push({ projectId, productionRunId: run.runId, artifactId: artifact.artifactId,
          thumbnailUrl: preview.nomiUrl, adopted: artifact.status === 'adopted', canAdopt: canAdoptArtifact(run, artifact.artifactId) })
        expiresAt = Math.min(expiresAt, Date.parse(preview.expiresAt))
      } catch { /* Missing files or changed ownership omit this preview; the task still exists. */ }
    }
    const value: LaneTaskFacts = { status, ...(stagesTotal ? { stagesDone, stagesTotal, progress: Math.round(stagesDone / stagesTotal * 100) } : {}),
      currency: run.budget.currency, spent: run.budget.actual, estimated: run.budget.reserved, candidates }
    const cached = { value, expiresAt }
    facts.set(run.runId, cached)
    return cached
  }
  const unsubscribe = subscribeProductionRunChanges((run) => {
    if (run.projectId !== projectId) return
    project(run)
    refresh()
  })
  return {
    resolve: (runId: string): LaneTaskFacts | undefined => {
      const cached = facts.get(runId)
      if (cached && cached.expiresAt > Date.now()) return cached.value
      try {
        const run = getProductionRunService().readFull(projectId, runId)
        if (run.projectId !== projectId || run.runId !== runId) return undefined
        return project(run).value
      } catch { return undefined }
    },
    dispose: () => { unsubscribe(); facts.clear() },
  }
}
