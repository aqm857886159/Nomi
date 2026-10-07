import type { GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import { nodeRunOutcomePatch } from './nodeRunOutcome'
import { createRunId } from './canvasIds'
import { bumpPersistRevision } from './canvasGuards'
import { getRunDurationSeconds, mergeRunRecord } from './runRecordHelpers'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasRunActions, CanvasSliceCreator } from './canvasStoreTypes'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'

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
      Object.assign(node, nodeRunOutcomePatch(node, { kind: 'status', status, error }))
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
      Object.assign(node, nodeRunOutcomePatch(node, { kind: 'progress', progress }))
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
      Object.assign(node, nodeRunOutcomePatch(node, { kind: 'run-started', run: normalizedRun }))
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
  addNodeResult: (nodeId, result, mediaDimensions) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      Object.assign(node, nodeRunOutcomePatch(node, { kind: 'result', result, mediaDimensions }))
      bumpPersistRevision(state)
    })
    emitRunUpdated(nodeId)
  },
  }
}
