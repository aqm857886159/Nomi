import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationQueueStore, type GenerationQueueEntry } from '../generationCanvas/runner/generationQueueStore'
import { generationFeedback, savedFeedbackWindowOpen } from './generationFeedback'

// One local clock for all visible surfaces; no per-node persistence writes or competing timers.
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
const snapshot = () => now
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => { now = Date.now(); listeners.forEach((notify) => notify()) }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) { clearInterval(timer); timer = undefined }
  }
}
const inactiveSubscribe = () => () => {}

/**
 * 这一格时钟此刻的读数。
 *
 * 为什么要把它读出来：`useSyncExternalStore` 在**服务端渲染**（`renderToStaticMarkup`，
 * 也就是本仓结构测试渲染组件的方式）走的是 getServerSnapshot，拿到的是这个模块被 import
 * 那一刻的 `now`——秒针不会走，因为没有订阅、`setInterval` 根本没起。
 * 于是「这条落地回执还在不在 4 秒窗口里」这个判断，锚的是**本模块的 import 时刻**，
 * 而不是调用方以为的「现在」。夹具若用自己那边的 `Date.now()` 当 `completedAt`，
 * 两个时刻谁先谁后由**模块加载顺序**决定：早一点则窗口内、晚一点则 elapsed 为负当作没落地，
 * 同一条断言随机绿红（2026-09-12 全量套件里实测到一次）。
 * 要判窗口就得锚同一份时钟——这个函数就是那份时钟的读口。
 */
export function generationFeedbackClockNow(): number {
  return now
}

export function useGenerationFeedbackClock(active = true): number {
  return useSyncExternalStore(active ? subscribe : inactiveSubscribe, snapshot, snapshot)
}

/** Both the shot and its prerequisite keyframe may own the current operation. */
export function selectGenerationFeedbackNode(node: GenerationCanvasNode | null | undefined, keyframeNode: GenerationCanvasNode | null | undefined, entries: readonly GenerationQueueEntry[]) {
  const candidates = [node, keyframeNode].filter((candidate): candidate is GenerationCanvasNode => Boolean(candidate))
  const queuedEntry = entries.find((entry) => entry.state === 'queued' && candidates.some((candidate) => candidate.id === entry.nodeId))
  const current = candidates.find((candidate) => candidate.status === 'running')
    ?? candidates.find((candidate) => candidate.id === queuedEntry?.nodeId)
    ?? candidates.find((candidate) => candidate.status === 'queued')
    ?? candidates.find((candidate) => candidate.status === 'error')
    ?? candidates.find((candidate) => candidate.status === 'recoverable')
    ?? node ?? keyframeNode
  const queued = Boolean(queuedEntry && queuedEntry.nodeId === current?.id)
  const queueAhead = queued && queuedEntry
    ? entries.filter((entry) => entry.batchId === queuedEntry.batchId && entry.state === 'queued').findIndex((entry) => entry.id === queuedEntry.id)
    : undefined
  const active = queued || current?.status === 'queued' || current?.status === 'running'
  return { current, queued, queueAhead, active }
}

export function useGenerationFeedback(node: GenerationCanvasNode | null | undefined, keyframeNode?: GenerationCanvasNode | null) {
  useTranslation()
  const entries = useGenerationQueueStore((state) => state.entries)
  const { current, queued, queueAhead, active } = selectGenerationFeedbackNode(node, keyframeNode, entries)
  // 落地回执是**限时**的，所以刚跑完的那几秒钟表也得继续走——否则「跑完」那一帧渲染出回执之后
  // 再没有第二帧来把它收走，一句一次性的话就又变回常驻的了。窗口过完这一格自己退订。
  const ticking = active || (current ? savedFeedbackWindowOpen(current, Date.now()) : false)
  const timestamp = useGenerationFeedbackClock(ticking)
  return current ? generationFeedback(current, timestamp, queued, queueAhead) : null
}
