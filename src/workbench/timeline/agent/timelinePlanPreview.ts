import { applyTimelineOperations, type TimelineOperation } from '../kernel/timelineKernel'
import type { TimelineState } from '../timelineTypes'

/**
 * The plan preview is derived from the kernel, never from the raw tool
 * arguments. Reading `startFrame` off an operation JSON only works for the two
 * operations that happen to carry one; `trim`, `transition`, `text edit` and
 * `audio` carry no geometry at all, so a JSON-derived overlay silently draws
 * boxes at frame 0 and tells the user something that is not true. Running the
 * same `validateOnly` transaction the Agent chain runs gives the real resulting
 * timeline, and the bands below are the honest difference between the two.
 */
export type TimelinePlanPreviewBand = {
  /** `removed` = this span goes away, `added` = content lands here, `changed` = same span, different settings. */
  kind: 'removed' | 'added' | 'changed'
  clipId: string
  startFrame: number
  endFrame: number
}

const PREVIEWABLE_KINDS: ReadonlySet<string> = new Set([
  'move', 'remove', 'split', 'trim', 'source-window', 'ripple', 'transition', 'text', 'clip-audio',
])

/** Accept only operation shapes the kernel can execute; anything else previews as nothing. */
export function timelinePlanOperations(value: unknown): TimelineOperation[] {
  if (!Array.isArray(value)) return []
  const operations: TimelineOperation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const kind = (entry as { kind?: unknown }).kind
    if (typeof kind !== 'string' || !PREVIEWABLE_KINDS.has(kind)) return []
    operations.push(entry as TimelineOperation)
  }
  return operations
}

type Span = { startFrame: number; endFrame: number }

function clipSpans(timeline: TimelineState): Map<string, Span> {
  const spans = new Map<string, Span>()
  for (const track of timeline.tracks) {
    for (const clip of track.clips) spans.set(clip.id, { startFrame: clip.startFrame, endFrame: clip.endFrame })
  }
  for (const clip of timeline.textClips) spans.set(clip.id, { startFrame: clip.startFrame, endFrame: clip.endFrame })
  return spans
}

function clipSettings(timeline: TimelineState): Map<string, string> {
  const settings = new Map<string, string>()
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      settings.set(clip.id, JSON.stringify([clip.audio ?? null, clip.offsetStartFrame, clip.offsetEndFrame, clip.text ?? null]))
    }
  }
  for (const clip of timeline.textClips) settings.set(clip.id, JSON.stringify([clip.text, clip.style]))
  return settings
}

/** The seam a transition sits on is the incoming clip's head; its width is the transition duration. */
function transitionBands(before: TimelineState, after: TimelineState): TimelinePlanPreviewBand[] {
  const key = (transition: { fromClipId: string; toClipId: string }): string => `${transition.fromClipId}->${transition.toClipId}`
  const beforeKeys = new Set((before.transitions ?? []).map(key))
  const spans = clipSpans(after)
  return (after.transitions ?? [])
    .filter((transition) => !beforeKeys.has(key(transition)))
    .flatMap((transition) => {
      const span = spans.get(transition.toClipId)
      if (!span) return []
      const duration = Math.max(1, transition.durationFrames ?? 1)
      return [{ kind: 'added' as const, clipId: transition.toClipId, startFrame: span.startFrame, endFrame: span.startFrame + duration }]
    })
}

function geometryBands(before: TimelineState, after: TimelineState): TimelinePlanPreviewBand[] {
  const beforeSpans = clipSpans(before)
  const afterSpans = clipSpans(after)
  const beforeSettings = clipSettings(before)
  const afterSettings = clipSettings(after)
  const bands: TimelinePlanPreviewBand[] = []
  for (const [clipId, span] of beforeSpans) {
    const next = afterSpans.get(clipId)
    if (!next) {
      bands.push({ kind: 'removed', clipId, ...span })
      continue
    }
    if (next.startFrame === span.startFrame && next.endFrame === span.endFrame) {
      if (beforeSettings.get(clipId) !== afterSettings.get(clipId)) bands.push({ kind: 'changed', clipId, ...span })
      continue
    }
    // Report only the parts that actually disappear or appear, so a trim shows
    // the frames being cut rather than repainting the whole clip.
    if (span.startFrame < next.startFrame) bands.push({ kind: 'removed', clipId, startFrame: span.startFrame, endFrame: Math.min(span.endFrame, next.startFrame) })
    if (next.endFrame < span.endFrame) bands.push({ kind: 'removed', clipId, startFrame: Math.max(span.startFrame, next.endFrame), endFrame: span.endFrame })
    if (next.startFrame < span.startFrame) bands.push({ kind: 'added', clipId, startFrame: next.startFrame, endFrame: Math.min(next.endFrame, span.startFrame) })
    if (span.endFrame < next.endFrame) bands.push({ kind: 'added', clipId, startFrame: Math.max(next.startFrame, span.endFrame), endFrame: next.endFrame })
  }
  for (const [clipId, span] of afterSpans) {
    if (!beforeSpans.has(clipId)) bands.push({ kind: 'added', clipId, ...span })
  }
  return bands
}

/** Read-only: runs the plan as a `validateOnly` transaction and never commits it. */
export function timelinePlanPreviewBands(timeline: TimelineState, operations: readonly TimelineOperation[]): TimelinePlanPreviewBand[] {
  if (operations.length === 0) return []
  const result = applyTimelineOperations(timeline, operations, { validateOnly: true })
  if (!result.ok) return []
  const bands = [...geometryBands(timeline, result.previewTimeline), ...transitionBands(timeline, result.previewTimeline)]
  return bands.filter((band) => band.endFrame > band.startFrame)
}
