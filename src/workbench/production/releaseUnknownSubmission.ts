import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { isNodeSubmitInFlight } from '../generationCanvas/runner/nodeSubmitInFlight'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import { canvasOpenRuns } from '../api/taskApi'
import type { DesktopProductionRunBridge } from '../../desktop/productionRunBridgeTypes'
import { deriveProductionShotState, productionShotIdForNode } from '../../../electron/shared/productionShotPhase'
import { executeProductionRunCommand } from './productionRunCommands'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useProductionRunStore } from './productionRunStore'

export type ReleaseUnknownApi = Pick<DesktopProductionRunBridge, 'read' | 'command'>

/**
 * 人确认可能再扣费后——把那次结果未知的尝试记成「用户核对后放弃」，释放这一镜的占用。
 *
 * 只是释放：不重发、不开拍。接下来的重新生成走 confirmAndRunNode：用户单张直接发，首次托管告知仍由既有判据决定。
 * 命令由主进程盖「真人手势章」后才生效（Agent / MCP 路径发不了）。失败照实抛给调用方，不吞。
 */
export async function releaseUnknownSubmission(
  projectId: string,
  runId: string,
  jobId: string,
  api: ReleaseUnknownApi,
): Promise<void> {
  const run = await api.read(projectId, runId)
  if (!run) throw new Error('Production run not found')
  const result = await executeProductionRunCommand(projectId, runId, {
    commandId: globalThis.crypto.randomUUID(),
    expectedRevision: run.revision,
    type: 'job.reconcile',
    payload: { jobId, outcome: 'user_checked_abandon' },
    issuedAt: new Date().toISOString(),
  }, { read: api.read, execute: api.command })
  // 渲染层有两份这个 Run 的缓存（画布生成入口 / 组合框的「被制作流程占着」判据读它们）：不立刻换成放行后的新版，
  // 组合框会一直灰着、紧接着的重新生成也会被旧缓存拦下。主进程那份才是真相，这里只是同步缓存。
  const landing = useProductionCanvasLandingStore.getState()
  if (landing.projectId === projectId) landing.setRuns(projectId, { ...landing.runs, [runId]: result.run })
  await useProductionRunStore.getState().loadRun(projectId, runId).catch(() => undefined)
}

/** 按画布节点找到它那一镜结果未知的任务并放行；这个节点那一镜当前不是「结果未知」就什么都不做、回 false。 */
export async function releaseUnknownSubmissionForNode(
  projectId: string,
  runId: string,
  nodeId: string,
  api: ReleaseUnknownApi,
): Promise<boolean> {
  const run = await api.read(projectId, runId)
  if (!run) return false
  const job = deriveProductionShotState(run, productionShotIdForNode(run, nodeId))?.job
  if (!job || (job.status !== 'submission_unknown' && job.status !== 'reconciling')) return false
  await releaseUnknownSubmission(projectId, runId, job.jobId, api)
  return true
}

/** 这个任务对应的画布节点：批次镜看 `shots[].nodeId`，单镜看计划的 `nodeId`，老数据才有 `job.nodeId`。 */
export function nodeIdOfJob(
  run: { origin?: { nodeId?: string }; generationPlan?: { nodeId?: string; shots?: ReadonlyArray<{ shotId: string; nodeId?: string }> } },
  job: { nodeId?: string; metadata?: Record<string, unknown> },
): string | undefined {
  if (job.nodeId) return job.nodeId
  const shotId = job.metadata?.shotId
  const plan = run.generationPlan
  if (typeof shotId === 'string' && plan?.shots?.length) return plan.shots.find((shot) => shot.shotId === shotId)?.nodeId
  return plan?.nodeId ?? run.origin?.nodeId
}

/** Query at the moment of release; a failed newer click must not hide the original occupancy. */
export async function releaseUnknownCanvasSubmissionsForNode(projectId: string, nodeId: string, api: ReleaseUnknownApi): Promise<string[]> {
  const open = await canvasOpenRuns({ projectId, nodeId })
  for (const entry of open) if (entry.reason === 'needs_reconcile' && entry.jobId) await releaseUnknownSubmission(projectId, entry.runId, entry.jobId, api)
  return open.filter(entry => entry.reason === 'in_flight').map(entry => entry.runId)
}

/** The host owns occupancy; this projection never rewrites a live renderer submit. */
export function synchronizeCanvasOpenRuns(entries: Awaited<ReturnType<typeof canvasOpenRuns>>) {
  const store = useGenerationCanvasStore.getState()
  for (const entry of entries) {
    const node = store.nodes.find(value => value.id === entry.nodeId)
    if (isNodeSubmitInFlight(entry.nodeId) || !node || (entry.reason === 'in_flight' && node.status === 'recoverable')) continue
    if (entry.reason === 'needs_reconcile' && node.status === 'error' && node.error?.includes('NOMI_ERR::submission-unknown::')) continue
    store.setNodeRecoveryPresentation(entry.nodeId, entry.reason === 'needs_reconcile' ? 'error' : 'recoverable',
      entry.reason === 'needs_reconcile' ? tagNomiError('submission-unknown', 'Previous submission result was not received') : undefined)
  }
}
