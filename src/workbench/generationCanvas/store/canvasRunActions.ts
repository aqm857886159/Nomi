import { rollbackNodeHistory } from '../model/graphOps'
import type { GenerationNodeResult, GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import { createRunId } from './canvasIds'
import { bumpPersistRevision } from './canvasGuards'
import { createProgress, getResultTaskKind, getRunDurationSeconds, mergeRunRecord } from './runRecordHelpers'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasRunActions, CanvasSliceCreator } from './canvasStoreTypes'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'

function mergeResultHistory(
  nextResult: GenerationNodeResult,
  previousResult: GenerationNodeResult | undefined,
  previousHistory: GenerationNodeResult[] | undefined,
): GenerationNodeResult[] {
  const history: GenerationNodeResult[] = []
  const seen = new Set<string>()
  const add = (result: GenerationNodeResult | undefined) => {
    if (!result) return
    const key = result.id || result.url || result.thumbnailUrl || result.text || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    history.push(result)
  }
  add(nextResult)
  add(previousResult)
  ;(previousHistory || []).forEach(add)
  return history
}

// S5-a3 run 域记账 = 终态收敛:setNodeProgress(每 1.5s 轮询 tick)不入日志(§4.3 瞬态),
// 终态 action 发后态整节点(canvas.node.run-updated)——内部时间戳逻辑再复杂,后态都构造性精确;
// 重放在终态收敛(重放到中途的日志不会出僵尸 running,这正是重启后想要的)。
export const createCanvasRunActions: CanvasSliceCreator<CanvasRunActions> = (set, get) => {
  const emitRunUpdated = (nodeId: string) => {
    const node = get().nodes.find((candidate) => candidate.id === nodeId)
    if (node) emitCanvasGesture([{ type: 'canvas.node.run-updated', payload: { node } }], { source: 'runtime' })
  }
  return {
  setNodeStatus: (nodeId, status, error) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      const nextError = status === 'error' ? error || node.error || describeOpaqueFailure(null) : undefined
      const latestRun = node.runs?.[0]
      const runs = latestRun && latestRun.status !== 'success' && latestRun.status !== 'error' && latestRun.status !== 'cancelled'
        ? [mergeRunRecord(latestRun, { status: status === 'idle' ? 'cancelled' : status, error: nextError }), ...(node.runs || []).slice(1)]
        : node.runs

      node.status = status
      node.error = nextError
      node.progress = status === 'queued' || status === 'running' ? node.progress : undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
  },
  // 收起失败卡（2026-08-24 用户反馈：「下面是生了视频的，有这个报错窗口在，就一直看不了原本的视频」）。
  // 失败卡是 absolute inset-0 铺满正文的**遮罩**，节点的 result 一直好端端在下面——错误态只是把它挡住了。
  // 所以「关掉」不是删数据，而是把节点放回它本来的样子：有产物 → success（片子露出来），没有 → idle。
  // 错误原文不丢：它在 runs[0] 里（任务日志/生成记录仍查得到），此处只动 node.status/node.error 这层展示态。
  dismissNodeError: (nodeId) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node || node.status !== 'error') return
      node.status = node.result ? 'success' : 'idle'
      node.error = undefined
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
  },
  setNodeProgress: (nodeId, progress) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (!progress) {
        node.progress = undefined
        bumpPersistRevision(state)
        return
      }
      const nextProgress = createProgress(progress, node.runs?.[0]?.id)
      const runs = node.runs?.length
        ? [
            mergeRunRecord(node.runs[0], {
              status: node.runs[0].status === 'queued' ? 'running' : node.runs[0].status,
              progress: nextProgress,
              taskId: nextProgress.taskId ?? node.runs[0].taskId,
              taskKind: nextProgress.taskKind ?? node.runs[0].taskKind,
            }, nextProgress.updatedAt),
            ...node.runs.slice(1),
          ]
        : node.runs
      node.status = node.status === 'queued' ? 'running' : node.status || 'running'
      node.error = undefined
      node.progress = nextProgress
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  appendNodeRun: (nodeId, run) => {
    const now = Date.now()
    const nextRun: GenerationNodeRunRecord = {
      ...run,
      id: run.id ?? createRunId(nodeId),
      startedAt: run.startedAt ?? now,
      updatedAt: run.updatedAt ?? now,
    }
    const normalizedRun = {
      ...nextRun,
      durationSeconds: getRunDurationSeconds(nextRun),
    }
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.status = normalizedRun.status === 'cancelled' ? 'idle' : normalizedRun.status
      node.error = normalizedRun.status === 'error' ? normalizedRun.error || node.error || describeOpaqueFailure(null) : undefined
      node.progress = normalizedRun.progress
      node.runs = [normalizedRun, ...(node.runs || []).filter((entry) => entry.id !== normalizedRun.id)]
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
    return normalizedRun
  },
  trackNodeRun: (nodeId, runId, patch) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      const runIndex = (node.runs || []).findIndex((entry) => entry.id === runId)
      if (runIndex < 0) return
      const nextRuns = [...(node.runs || [])]
      const nextRun = mergeRunRecord(nextRuns[runIndex], patch)
      nextRuns[runIndex] = nextRun
      const isLatestRun = runIndex === 0
      node.status = isLatestRun ? (nextRun.status === 'cancelled' ? 'idle' : nextRun.status) : node.status
      node.error = isLatestRun && nextRun.status === 'error' ? nextRun.error || describeOpaqueFailure(null) : undefined
      node.progress = isLatestRun ? nextRun.progress : node.progress
      node.runs = nextRuns
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
  },
  addNodeResult: (nodeId, result) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      const previousResult = node.result
      const latestRun = node.runs?.[0]
      const completedAt = result.createdAt || Date.now()
      const runs = latestRun
        ? [
            mergeRunRecord(latestRun, {
              status: 'success',
              taskId: result.taskId ?? latestRun.taskId,
              taskKind: getResultTaskKind(result) ?? latestRun.taskKind,
              assetId: result.assetId ?? latestRun.assetId,
              assetRefId: result.assetRefId ?? latestRun.assetRefId,
              resultId: result.id,
              raw: result.raw ?? latestRun.raw,
              completedAt,
              durationSeconds: result.durationSeconds ?? latestRun.durationSeconds,
              progress: undefined,
              error: undefined,
            }, completedAt),
            ...(node.runs || []).slice(1),
          ]
        : node.runs
      node.result = result
      node.history = mergeResultHistory(result, previousResult, node.history)
      node.status = 'success'
      node.error = undefined
      node.progress = undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
  },
  rollbackHistory: (nodeId, resultId) => {
    const before = get().nodes
    set((state) => {
      const nextNodes = rollbackNodeHistory(state.nodes, nodeId, resultId)
      if (nextNodes === state.nodes) return
      state.nodes = nextNodes
      bumpPersistRevision(state)
    })
    if (get().nodes !== before) emitRunUpdated(nodeId)
  },
  }
}
