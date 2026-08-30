export type HistoryVideoScrubRect = { left: number; width: number }

export function clampHistoryVideoTime(value: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(duration, value))
}

export function historyVideoTimeFromPointer(
  clientX: number,
  rect: HistoryVideoScrubRect,
  duration: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
    return null
  }
  if (!Number.isFinite(duration) || duration <= 0) return null
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return ratio * duration
}

export function nudgeHistoryVideoTime(currentTime: number, key: string, duration: number): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const delta = key === 'ArrowLeft' ? -1 : 1
  return clampHistoryVideoTime(currentTime + delta, duration)
}
