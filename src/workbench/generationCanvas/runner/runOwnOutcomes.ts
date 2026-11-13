import type { GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import { narrateProgress } from '../../observability/narrate'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { NodeProgressInput } from '../store/runRecordHelpers'
import { deliverRunOutcome, whenRunTargetLoaded, type RunProjectTarget } from './runProjectDelivery'

type RunOutcome = Parameters<typeof deliverRunOutcome>[2]

// 本窗口里点下去的先后 = 开始时间的先后（同一毫秒里连点两下也分得出谁先谁后）：
// 花钱的那次要等主进程准入才进运行记录，记录按开始时间插入，所以开始时间不能撞。
let lastRunStartedAt = 0
export function nextRunStartedAt(): number {
  lastRunStartedAt = Math.max(Date.now(), lastRunStartedAt + 1)
  return lastRunStartedAt
}

/**
 * 一次运行自己的结局怎么投（docs/plan/2026-11-07-shot-result-ownership.md D1 / D3）。
 * 运行身份由主进程准入给：花钱的那条路点下去只在节点显示上「排队中」，不写运行记录；
 * 准入回执到了（第一个带任务号的进度 = 提交已返回；或结果；或除被拒以外的任何结局）才把这次写进记录。
 * 不花钱的本地 / 文本运行没有主进程准入，渲染层就是唯一权威，开始即写。
 * 每个结局都带这次自己的运行记录号，由 nodeRunOutcome 按号收账。
 */
export function createRunOwnOutcomes(target: RunProjectTarget, nodeId: string, run: GenerationNodeRunRecord, paidRun: boolean) {
  let admitted = false
  let delivery: Promise<void> = Promise.resolve()
  let deliveryFailure: unknown
  let persistedTaskId = ''
  const queue = (outcome: RunOutcome): void => {
    // Existing delivery serializes writes; retain rejection for this run's awaited completion.
    const next = deliverRunOutcome(target, nodeId, outcome).then(() => undefined, (error: unknown) => { deliveryFailure ??= error })
    delivery = delivery.then(() => next)
  }
  const admit = (patch: { taskId?: string } = {}): void => {
    if (admitted) return
    admitted = true
    queue({ kind: 'run-started', run: { ...run, status: 'running', updatedAt: Date.now(), ...patch } })
  }
  const reportProgress = (progress: NodeProgressInput): void => {
    if (paidRun && !admitted && progress.taskId) admit({ taskId: progress.taskId })
    // 前台看进度；不在前台只把首次拿到的 taskId 写进原项目（找回靠它），其余瞬态不写盘。
    if (whenRunTargetLoaded(target, () => useGenerationCanvasStore.getState().setNodeProgress(nodeId, progress))) return
    if (progress.taskId && progress.taskId !== persistedTaskId) {
      persistedTaskId = progress.taskId
      queue({ kind: 'progress', progress, runId: run.id })
    }
  }
  /** 这次的结局要落之前：没拿到回执的先写进记录（主进程可能已经收下了，记录号要留着对账），再按号结掉。 */
  const deliverOwn = async (outcome: RunOutcome): Promise<boolean> => {
    admit()
    await delivery
    return deliverRunOutcome(target, nodeId, outcome)
  }
  return {
    reportProgress,
    deliverOwn,
    async start(): Promise<void> {
      const queuedProgress = { runId: run.id, phase: 'queued', message: narrateProgress('queued') } as const
      if (paidRun) await deliverRunOutcome(target, nodeId, { kind: 'attempt-started', runId: run.id, progress: queuedProgress })
      else {
        await deliverRunOutcome(target, nodeId, { kind: 'run-started', run })
        admitted = true
      }
      reportProgress(queuedProgress)
    },
    /** 等排着的写都落完；返回其中第一个失败（没有就是 undefined）。 */
    async drained(): Promise<unknown> {
      await delivery
      return deliveryFailure
    },
    /**
     * 主进程拒了 = 这次从来不是一次运行（D3）：不写记录、不恢复开始时的快照；它占着显示的话，显示按记录重算。
     * 已经写进记录的（不花钱的路开始即写）只追加「这次结束」，同样不回滚。
     */
    async refused(): Promise<void> {
      if (admitted) await deliverOwn({ kind: 'status', runId: run.id, status: 'idle' })
      else await deliverRunOutcome(target, nodeId, { kind: 'attempt-refused', runId: run.id })
    },
  }
}
