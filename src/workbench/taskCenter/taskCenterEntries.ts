import { classifyGenerationError } from '../observability/classifyError'
import { generationFeedback } from '../observability/generationFeedback'
import { narrateTaskOutcome } from '../observability/narrate'
// 任务中心的展示派生（纯函数，逻辑全在这，组件只负责画）。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 两个真相源在此合流（各管各的，零重叠）：
//   generationQueueStore → 调度：谁被登记了、第几波、有没有被取消、批次刹没刹车
//   node（canvas store） → 执行：标题、进度、跑起来之后的状态（running/error/recoverable）
import type { GenerationCanvasNode, GenerationNodeStatus } from '../generationCanvas/model/generationCanvasTypes'
import type { GenerationQueueBatch, GenerationQueueEntry } from '../generationCanvas/runner/generationQueueStore'
import { TASK_CENTER_GROUPS, type GenerationTaskCenterProjection, type TaskCancelKind, type TaskCenterGroup, type TaskCenterProjection } from './taskCenterProjection'
import { canInterruptGenerationTask } from '../generationCanvas/model/taskCancellation'

/** 这一行能不能停、停了什么后果 —— 直接映射到 UI 给不给按钮、给什么文案。 */
export type TaskCenterRow = GenerationTaskCenterProjection

export type TaskCenterSummary = {
  running: number
  queued: number
  /** 卡在用户这儿的（等确认 / 等重新拉取 / 等处理）。 */
  attention: number
  failed: number
  /** 有没有还没提交的可取消（决定汇总行给不给「取消排队的 N 个」）。 */
  cancellable: number
  /** 被连续失败刹车暂停的批次 id（面板顶部出横幅）。 */
  pausedBatchId?: string
}

export type TaskCenterView = {
  rows: TaskCenterRow[]
  summary: TaskCenterSummary
}

/**
 * 进行中的这一条能不能中断。判据取 node.progress.phase 与 NodeGeneratingOverlay 保持一致
 * （那里也是靠 comfyui-* phase 决定显不显示取消按钮）—— 同一个事实只有一处判法。
 */
export function resolveRunningCancelKind(node: GenerationCanvasNode | undefined): TaskCancelKind {
  return canInterruptGenerationTask(node) ? 'interrupt' : 'none'
}

function elapsedFor(entry: GenerationQueueEntry, now: number): number | undefined {
  if (!entry.startedAt) return undefined
  return Math.max(0, (entry.endedAt ?? now) - entry.startedAt)
}

function outcomeFor(state: GenerationQueueEntry['state']): TaskCenterRow['outcome'] {
  if (state === 'success' || state === 'error' || state === 'cancelled') return state
  return undefined
}

/**
 * 一条生成任务落在哪一组、结局是什么——生成这一侧的**唯一**映射。
 *
 * 队列条目只记调度的结局；调度以 error 结束之后，节点还会往前走：等待超时（recoverable）的节点
 * 上游可能仍在跑、能被重新拉取，拉取时节点回到 running，拉到了就 success。所以对**这个节点最新的那一条**，
 * 调度一结束就以节点状态为准。此前只看条目：「等待超时 · 可重新拉取」被放进「已完成」，
 * 用户点了重新拉取，这一行还会翻成「生成失败」并挂出付费的「重试」。
 */
function generationRowState(
  entry: GenerationQueueEntry,
  nodeStatus: GenerationNodeStatus | undefined,
  isLatestForNode: boolean,
): { group: TaskCenterGroup; outcome?: TaskCenterRow['outcome']; recoverable: boolean } {
  if (entry.state === 'running') return { group: 'running', recoverable: false }
  if (entry.state === 'queued') return { group: 'queued', recoverable: false }
  if (entry.state === 'error' && isLatestForNode) {
    if (nodeStatus === 'recoverable') return { group: 'attention', outcome: 'error', recoverable: true }
    if (nodeStatus === 'running') return { group: 'running', recoverable: false }
    if (nodeStatus === 'success') return { group: 'done', outcome: 'success', recoverable: false }
  }
  return { group: 'done', outcome: outcomeFor(entry.state), recoverable: false }
}

/** 所有任务（生成 / 制作 / 导出）合在一起的汇总——任务按钮和任务面板共用这一份算法。 */
export function summarizeTaskCenterRows(rows: readonly TaskCenterProjection[], pausedBatchId?: string): TaskCenterSummary {
  const count = (group: TaskCenterGroup): number => rows.filter((row) => row.group === group).length
  return {
    running: count('running'),
    queued: count('queued'),
    attention: count('attention'),
    failed: rows.filter((row) => row.outcome === 'error' && !row.recoverable).length,
    // 「取消排队的 N 个」只取消生成队列（导出的排队有它自己那一行的取消）。
    cancellable: rows.filter((row) => row.kind === 'generation' && row.cancel === 'free').length,
    ...(pausedBatchId ? { pausedBatchId } : {}),
  }
}


/**
 * 把队列条目 + 画布节点合成面板要画的行。
 * 排序：进行中（先开跑的在前）→ 排队中（按波次再按入队序）→ 已完成（新的在前）。
 */
export function buildTaskCenterView(input: {
  entries: readonly GenerationQueueEntry[]
  batches: Readonly<Record<string, GenerationQueueBatch>>
  nodes: readonly GenerationCanvasNode[]
  fallbackTitle: string
  now: number
}): TaskCenterView {
  const { entries, batches, nodes, fallbackTitle, now } = input
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const latestEntryByNode = new Map(entries.map((entry) => [entry.nodeId, entry]))

  const rows: TaskCenterRow[] = entries.map((entry) => {
    const node = nodeById.get(entry.nodeId)
    const { group, outcome, recoverable } = generationRowState(entry, node?.status, latestEntryByNode.get(entry.nodeId) === entry)
    const live = group === 'running' || group === 'queued'
    return {
      id: entry.id,
      kind: 'generation' as const,
      batchId: entry.batchId,
      nodeId: entry.nodeId,
      title: (node?.title || '').trim() || fallbackTitle,
      group,
      outcome,
      recoverable,
      waveIndex: entry.waveIndex,
      ...(typeof node?.progress?.percent === 'number' && group === 'running' ? { percent: node.progress.percent } : {}),
      phaseText: node && live
        ? generationFeedback(node, now, group === 'queued')?.message ?? narrateTaskOutcome(entry.state, recoverable)
        : outcome === 'error' && entry.error && !recoverable
          ? classifyGenerationError(entry.error).reason
          : narrateTaskOutcome(outcome ?? entry.state, recoverable),
      ...(elapsedFor(entry, now) !== undefined ? { elapsedMs: elapsedFor(entry, now) } : {}),
      cancel: group === 'queued' ? 'free' : group === 'running' ? resolveRunningCancelKind(node) : 'none',
      target: { kind: 'canvas_node' as const, nodeId: entry.nodeId },
      action: group === 'queued'
        ? { kind: 'cancel_generation_queue' as const, batchId: entry.batchId, nodeId: entry.nodeId }
        : group === 'running' && resolveRunningCancelKind(node) === 'interrupt'
          ? { kind: 'interrupt_generation' as const, nodeId: entry.nodeId }
          : group === 'done' && outcome === 'error'
            ? { kind: 'retry_generation' as const, nodeId: entry.nodeId }
            // 「等你处理」组必须把它在等的那个动作摆出来：不然用户只能点进画布找节点上的按钮。
            : recoverable
              ? { kind: 'recover_generation' as const, nodeId: entry.nodeId }
              : null,
      ...(entry.error ? { error: entry.error } : {}),
    }
  })

  // 排队的按波次；已完成新的在前（其余组保持入队序）。
  const ordered = [...rows].sort((a, b) => TASK_CENTER_GROUPS.indexOf(a.group) - TASK_CENTER_GROUPS.indexOf(b.group)
    || (a.group === 'queued' ? a.waveIndex - b.waveIndex : 0))
  const done = ordered.filter((row) => row.group === 'done').reverse()
  const live = ordered.filter((row) => row.group !== 'done')

  const pausedBatch = Object.values(batches).find((batch) => batch.paused && !batch.finishedAt)
  const sortedRows = [...live, ...done]
  return { rows: sortedRows, summary: summarizeTaskCenterRows(sortedRows, pausedBatch?.id) }
}

/** 任务按钮上的数字：还没结束、也没被用户处理掉的一切（在跑 + 排队 + 等你处理）。 */
export function pendingTaskCount(summary: TaskCenterSummary): number {
  return summary.running + summary.queued + summary.attention
}

/** 顶栏按钮的状态：有没结束的 → accent 计数；都结束了但有失败 → 提醒色；否则安静。 */
export function resolveTaskButtonTone(summary: TaskCenterSummary): 'busy' | 'failed' | 'idle' {
  if (pendingTaskCount(summary) > 0) return 'busy'
  return summary.failed > 0 ? 'failed' : 'idle'
}

/** 已跑 1:24 这种。只给分秒——生成任务不会跑到小时级，给小时反而占宽。 */
export function formatElapsed(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
