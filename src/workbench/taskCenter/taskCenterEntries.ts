// 任务中心的展示派生（纯函数，逻辑全在这，组件只负责画）。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 两个真相源在此合流（各管各的，零重叠）：
//   generationQueueStore → 调度：谁被登记了、第几波、有没有被取消、批次刹没刹车
//   node（canvas store） → 执行：标题、进度、跑起来之后的状态（running/error/recoverable）
import type { GenerationCanvasNode, GenerationNodeStatus } from '../generationCanvas/model/generationCanvasTypes'
import type { GenerationQueueBatch, GenerationQueueEntry } from '../generationCanvas/runner/generationQueueStore'
import type { GenerationTaskCenterProjection, TaskCancelKind, TaskCenterGroup } from './taskCenterProjection'

/** 这一行能不能停、停了什么后果 —— 直接映射到 UI 给不给按钮、给什么文案。 */
export type TaskCenterRow = GenerationTaskCenterProjection

export type TaskCenterSummary = {
  running: number
  queued: number
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

const COMFYUI_PHASES = new Set(['comfyui-node', 'comfyui-queued'])

/**
 * 进行中的这一条能不能中断。判据取 node.progress.phase 与 NodeGeneratingOverlay 保持一致
 * （那里也是靠 comfyui-* phase 决定显不显示取消按钮）—— 同一个事实只有一处判法。
 */
export function resolveRunningCancelKind(node: GenerationCanvasNode | undefined): TaskCancelKind {
  return node?.progress?.phase && COMFYUI_PHASES.has(node.progress.phase) ? 'interrupt' : 'none'
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

  const rows: TaskCenterRow[] = entries.map((entry) => {
    const node = nodeById.get(entry.nodeId)
    const nodeStatus: GenerationNodeStatus | undefined = node?.status
    const group: TaskCenterGroup = entry.state === 'running' ? 'running' : entry.state === 'queued' ? 'queued' : 'done'
    // 「可找回」在队列里记为 error（调度确实结束了），但对用户不是同一件事 —— 上游可能仍在跑/已出片，
    // 有「重新拉取」这条路，不该跟真失败混在一起用同样的红字。
    const recoverable = entry.state === 'error' && nodeStatus === 'recoverable'
    return {
      id: entry.id,
      kind: 'generation' as const,
      batchId: entry.batchId,
      nodeId: entry.nodeId,
      title: (node?.title || '').trim() || fallbackTitle,
      group,
      outcome: outcomeFor(entry.state),
      recoverable,
      waveIndex: entry.waveIndex,
      ...(typeof node?.progress?.percent === 'number' && group === 'running' ? { percent: node.progress.percent } : {}),
      ...(group === 'running' && node?.progress?.message ? { phaseText: node.progress.message } : {}),
      ...(elapsedFor(entry, now) !== undefined ? { elapsedMs: elapsedFor(entry, now) } : {}),
      cancel: group === 'queued' ? 'free' : group === 'running' ? resolveRunningCancelKind(node) : 'none',
      target: { kind: 'canvas_node' as const, nodeId: entry.nodeId },
      action: group === 'queued'
        ? { kind: 'cancel_generation_queue' as const, batchId: entry.batchId, nodeId: entry.nodeId }
        : group === 'running' && resolveRunningCancelKind(node) === 'interrupt'
          ? { kind: 'interrupt_generation' as const, nodeId: entry.nodeId }
          : group === 'done' && entry.state === 'error' && !recoverable
            ? { kind: 'retry_generation' as const, nodeId: entry.nodeId }
            : null,
      ...(entry.error ? { error: entry.error } : {}),
    }
  })

  const order: Record<TaskCenterGroup, number> = { running: 0, queued: 1, done: 2 }
  const sorted = [...rows].sort((a, b) => {
    if (order[a.group] !== order[b.group]) return order[a.group] - order[b.group]
    if (a.group === 'queued' && a.waveIndex !== b.waveIndex) return a.waveIndex - b.waveIndex
    return 0
  })
  // 已完成新的在前（其余组保持入队序）。
  const done = sorted.filter((row) => row.group === 'done').reverse()
  const live = sorted.filter((row) => row.group !== 'done')

  const pausedBatch = Object.values(batches).find((batch) => batch.paused && !batch.finishedAt)
  return {
    rows: [...live, ...done],
    summary: {
      running: live.filter((row) => row.group === 'running').length,
      queued: live.filter((row) => row.group === 'queued').length,
      failed: done.filter((row) => row.outcome === 'error' && !row.recoverable).length,
      cancellable: live.filter((row) => row.cancel === 'free').length,
      ...(pausedBatch ? { pausedBatchId: pausedBatch.id } : {}),
    },
  }
}

/** 顶栏按钮的状态：有活 → accent 计数；跑完有失败 → 提醒色；否则安静。 */
export function resolveTaskButtonTone(summary: TaskCenterSummary): 'busy' | 'failed' | 'idle' {
  if (summary.running + summary.queued > 0) return 'busy'
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
