export type TimelineOperation = Record<string, unknown> & { kind?: string }

/** Stable, user-facing operation labels shared by preview and pending cards. */
export function describeTimelineOperation(operation: TimelineOperation, t: (key: string, options?: Record<string, unknown>) => string): string {
  const rawKind = typeof operation.kind === 'string' ? operation.kind : ''
  const kind = ['move', 'remove', 'split', 'trim', 'source-window', 'ripple'].includes(rawKind) ? rawKind : 'unknown'
  const key = `timelineEditor.agent.operations.${kind}`
  const details: Record<string, unknown> = {}
  if (typeof operation.clipId === 'string') details.clip = operation.clipId
  if (Array.isArray(operation.clipIds)) {
    const clipIds = operation.clipIds.filter((clipId): clipId is string => typeof clipId === 'string' && clipId.length > 0)
    if (!details.clip && clipIds.length > 0) details.clip = clipIds.join(', ')
  }
  if (typeof operation.startFrame === 'number') details.frame = operation.startFrame
  if (typeof operation.atFrame === 'number') details.frame = operation.atFrame
  if (typeof operation.deltaFrame === 'number') details.delta = operation.deltaFrame
  if (typeof operation.fromFrame === 'number') details.frame = operation.fromFrame
  if (typeof operation.sourceStartFrame === 'number') details.start = operation.sourceStartFrame
  if (typeof operation.sourceEndFrame === 'number') details.end = operation.sourceEndFrame
  if (typeof operation.trackId === 'string') details.track = operation.trackId
  if (typeof operation.edge === 'string') details.edge = t(`timelineEditor.agent.edges.${operation.edge}`)
  return t(key, details)
}
