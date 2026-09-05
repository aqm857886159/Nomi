export type TimelinePlacementClip = Readonly<{
  startFrame: number
  endFrame: number
}>

/** Return the closest start that keeps a clip inside a non-overlapping gap. */
export function nearestLegalStart(
  others: readonly TimelinePlacementClip[],
  length: number,
  desiredStart: number,
): number {
  const desired = Number.isFinite(Number(desiredStart)) ? Math.max(0, Math.floor(Number(desiredStart))) : 0
  const duration = Math.max(1, Number.isFinite(Number(length)) ? Math.floor(Number(length)) : 1)
  const ranges: Array<[number, number]> = []
  let cursor = 0
  for (const other of [...others].sort((left, right) => left.startFrame - right.startFrame)) {
    const start = Math.max(cursor, Math.floor(other.startFrame))
    const end = Math.max(start, Math.floor(other.endFrame))
    if (start - cursor >= duration) ranges.push([cursor, start - duration])
    cursor = end
  }
  ranges.push([cursor, Number.MAX_SAFE_INTEGER])

  let best = cursor
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [low, high] of ranges) {
    const candidate = Math.min(high, Math.max(low, desired))
    const distance = Math.abs(candidate - desired)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
