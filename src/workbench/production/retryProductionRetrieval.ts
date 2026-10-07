import type { DesktopProductionRunBridge } from '../../desktop/productionRunBridgeTypes'
import { deriveProductionShotState, productionShotIdForNode } from '../../../electron/shared/productionShotPhase'
import { executeProductionRunCommand } from './productionRunCommands'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useProductionRunStore } from './productionRunStore'

export type RetryRetrievalApi = Pick<DesktopProductionRunBridge, 'read' | 'command'>

/**
 * 画布节点 / 分镜表上那枚「重新拉取」落到制作的镜头上时（#975 V-975）：这一镜是制作派出去的、已经生成、
 * 只是结果没能取回——重新取回走 Run 的 `job.retry_retrieval`（主进程放回轮询、再查一次再取一次），
 * 不走画布自己的任务查询（那会让 Run 里这一镜永远停在「取回失败」，两份真相）。
 *
 * 判据只问 `deriveProductionShotState`（底下是 `jobAwaitsRetrieval`，全仓唯一一处）。这一镜不在「待取回」→ 回 false，
 * 调用方照旧走画布自己的找回。不重新生成、不弹付费卡。失败照实抛给调用方，不吞。
 */
export async function retryProductionRetrievalForNode(
  projectId: string,
  runId: string,
  nodeId: string,
  api: RetryRetrievalApi,
): Promise<boolean> {
  const run = await api.read(projectId, runId)
  if (!run) return false
  const state = deriveProductionShotState(run, productionShotIdForNode(run, nodeId))
  if (state?.phase !== 'unretrieved' || !state.job) return false
  const result = await executeProductionRunCommand(projectId, runId, {
    commandId: globalThis.crypto.randomUUID(),
    expectedRevision: run.revision,
    type: 'job.retry_retrieval',
    payload: { jobId: state.job.jobId },
    issuedAt: new Date().toISOString(),
  }, { read: api.read, execute: api.command })
  // 渲染层两份 Run 缓存（画布落地 / 任务面板）同步成主进程这份，节点与分镜表立刻看到「在取回」。
  const landing = useProductionCanvasLandingStore.getState()
  if (landing.projectId === projectId) landing.setRuns(projectId, { ...landing.runs, [runId]: result.run })
  await useProductionRunStore.getState().loadRun(projectId, runId).catch(() => undefined)
  return true
}
