import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { isNodeSubmitInFlight } from '../generationCanvas/runner/nodeSubmitInFlight'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import { canvasOpenRuns } from '../api/taskApi'
import type { DesktopProductionRunBridge } from '../../desktop/productionRunBridgeTypes'
import { executeProductionRunCommand } from './productionRunCommands'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useProductionRunStore } from './productionRunStore'

type ReleaseUnknownApi = Pick<DesktopProductionRunBridge, 'read' | 'command'>

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
  /** 主进程这一次重发判定发的号：只有号里列出的那一笔，主进程才肯放。 */
  resendDecisionId: string,
): Promise<void> {
  const run = await api.read(projectId, runId)
  if (!run) throw new Error('Production run not found')
  const result = await executeProductionRunCommand(projectId, runId, {
    commandId: globalThis.crypto.randomUUID(),
    expectedRevision: run.revision,
    type: 'job.reconcile',
    payload: { jobId, outcome: 'user_checked_abandon', resendDecisionId },
    issuedAt: new Date().toISOString(),
  }, { read: api.read, execute: api.command })
  // 渲染层有两份这个 Run 的缓存（画布生成入口 / 组合框的「被制作流程占着」判据读它们）：不立刻换成放行后的新版，
  // 组合框会一直灰着、紧接着的重新生成也会被旧缓存拦下。主进程那份才是真相，这里只是同步缓存。
  const landing = useProductionCanvasLandingStore.getState()
  if (landing.projectId === projectId) landing.setRuns(projectId, { ...landing.runs, [runId]: result.run })
  await useProductionRunStore.getState().loadRun(projectId, runId).catch(() => undefined)
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

/** The host owns occupancy; this projection never rewrites a live renderer submit. */
export function synchronizeCanvasOpenRuns(entries: ReadonlyArray<Readonly<Awaited<ReturnType<typeof canvasOpenRuns>>[number]>>) {
  const store = useGenerationCanvasStore.getState()
  for (const entry of entries) {
    const node = store.nodes.find(value => value.id === entry.nodeId)
    if (isNodeSubmitInFlight(entry.nodeId) || !node || (entry.reason === 'in_flight' && node.status === 'recoverable')) continue
    if (entry.reason === 'needs_reconcile' && node.status === 'error' && node.error?.includes('NOMI_ERR::submission-unknown::')) continue
    store.setNodeRecoveryPresentation(entry.nodeId, entry.reason === 'needs_reconcile',
      entry.reason === 'needs_reconcile' ? tagNomiError('submission-unknown', 'Previous submission result was not received') : undefined)
  }
}
