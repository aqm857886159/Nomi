import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationQueueStore, type GenerationQueueEntry } from '../generationCanvas/runner/generationQueueStore'
import { generationFeedback } from './generationFeedback'

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
  const timestamp = useGenerationFeedbackClock(active)
  return current ? generationFeedback(current, timestamp, queued, queueAhead) : null
}
