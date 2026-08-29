import type { TimelineClip, TimelineTrack, TimelineTransition } from './timelineTypes'

const DEFAULT_TRANSITION_FRAMES = 15
const PREVIEW_TRANSITION_TYPES = new Set<TimelineTransition['type']>(['cut', 'dissolve', 'fade'])
const EXPORT_TRANSITION_TYPES = new Set<TimelineTransition['type']>(['cut', 'dissolve', 'fade'])

export type TimelineSourceWindowFeedback = {
  trimmed: boolean
  sourceFrameCount: number
  sourceStartFrame: number
  sourceEndFrame: number
  trimmedStartFrames: number
  trimmedEndFrames: number
  startPercent: number
  widthPercent: number
}

export type TimelineTransitionFeedbackReason =
  | 'missing_endpoint'
  | 'non_visual'
  | 'different_track'
  | 'wrong_order'
  | 'not_adjacent'
  | 'not_contiguous'
  | 'invalid_duration'
  | 'duplicate_connection'
  | 'unsupported_type'

export type TimelineTransitionFeedback = {
  transition: TimelineTransition
  placementTrackId: string | null
  boundaryFrame: number
  connected: boolean
  previewSupported: boolean
  exportSupported: boolean
  durationFrames: number | null
  reason: TimelineTransitionFeedbackReason | null
}

function finiteFrame(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

export function resolveTimelineSourceWindow(
  clip: Pick<TimelineClip, 'type' | 'frameCount' | 'offsetStartFrame' | 'offsetEndFrame'>,
): TimelineSourceWindowFeedback {
  const sourceFrameCount = Math.max(1, finiteFrame(clip.frameCount, 1))
  if (clip.type === 'image') {
    return {
      trimmed: false,
      sourceFrameCount,
      sourceStartFrame: 0,
      sourceEndFrame: sourceFrameCount,
      trimmedStartFrames: 0,
      trimmedEndFrames: 0,
      startPercent: 0,
      widthPercent: 100,
    }
  }

  const sourceStartFrame = Math.min(sourceFrameCount - 1, finiteFrame(clip.offsetStartFrame, 0))
  const requestedEndFrame = sourceFrameCount - finiteFrame(clip.offsetEndFrame, 0)
  const sourceEndFrame = Math.min(sourceFrameCount, Math.max(sourceStartFrame + 1, requestedEndFrame))
  const trimmedEndFrames = sourceFrameCount - sourceEndFrame

  return {
    trimmed: sourceStartFrame > 0 || trimmedEndFrames > 0,
    sourceFrameCount,
    sourceStartFrame,
    sourceEndFrame,
    trimmedStartFrames: sourceStartFrame,
    trimmedEndFrames,
    startPercent: (sourceStartFrame / sourceFrameCount) * 100,
    widthPercent: ((sourceEndFrame - sourceStartFrame) / sourceFrameCount) * 100,
  }
}

type LocatedClip = {
  track: TimelineTrack
  clip: TimelineClip
  index: number
}

function locateClips(tracks: readonly TimelineTrack[]): Map<string, LocatedClip> {
  const located = new Map<string, LocatedClip>()
  for (const track of tracks) {
    track.clips.forEach((clip, index) => located.set(clip.id, { track, clip, index }))
  }
  return located
}

function resolveConnectionReason(
  from: LocatedClip | undefined,
  to: LocatedClip | undefined,
): TimelineTransitionFeedbackReason | null {
  if (!from || !to) return 'missing_endpoint'
  if (from.clip.type === 'audio' || to.clip.type === 'audio') return 'non_visual'
  if (from.track.id !== to.track.id) return 'different_track'
  if (from.index >= to.index) return 'wrong_order'
  if (to.index !== from.index + 1) return 'not_adjacent'
  if (from.clip.endFrame !== to.clip.startFrame) return 'not_contiguous'
  return null
}

function resolvedTransitionDuration(
  transition: TimelineTransition,
  from: LocatedClip | undefined,
  to: LocatedClip | undefined,
): number | null {
  if (transition.type === 'cut') return 0
  if (transition.durationFrames !== undefined) return transition.durationFrames
  if (!from || !to) return null
  const shortestClip = Math.min(from.clip.endFrame - from.clip.startFrame, to.clip.endFrame - to.clip.startFrame)
  return Math.min(DEFAULT_TRANSITION_FRAMES, Math.floor(shortestClip / 2))
}

export function resolveTimelineTransitionFeedback(
  tracks: readonly TimelineTrack[],
  transitions: readonly TimelineTransition[] = [],
): TimelineTransitionFeedback[] {
  const located = locateClips(tracks)
  const outgoing = new Set<string>()
  const incoming = new Set<string>()

  return transitions.map((transition) => {
    const from = located.get(transition.fromClipId)
    const to = located.get(transition.toClipId)
    const placementTrackId = from?.track.id ?? to?.track.id ?? null
    const boundaryFrame = finiteFrame(from?.clip.endFrame ?? to?.clip.startFrame ?? 0, 0)
    const connectionReason = resolveConnectionReason(from, to)
    const connected = connectionReason === null
    const durationFrames = resolvedTransitionDuration(transition, from, to)
    let reason = connectionReason

    if (reason === null && !EXPORT_TRANSITION_TYPES.has(transition.type)) {
      reason = 'unsupported_type'
    }

    if (reason === null && transition.type !== 'cut') {
      const shortestClip = Math.min(
        (from?.clip.endFrame ?? 0) - (from?.clip.startFrame ?? 0),
        (to?.clip.endFrame ?? 0) - (to?.clip.startFrame ?? 0),
      )
      if (
        !Number.isInteger(durationFrames) ||
        durationFrames === null ||
        durationFrames < 1 ||
        durationFrames >= shortestClip
      ) {
        reason = 'invalid_duration'
      } else if (outgoing.has(transition.fromClipId) || incoming.has(transition.toClipId)) {
        reason = 'duplicate_connection'
      }
    }

    if (reason === null && transition.type !== 'cut') {
      outgoing.add(transition.fromClipId)
      incoming.add(transition.toClipId)
    }

    return {
      transition,
      placementTrackId,
      boundaryFrame,
      connected,
      previewSupported: reason === null && PREVIEW_TRANSITION_TYPES.has(transition.type),
      exportSupported: reason === null && EXPORT_TRANSITION_TYPES.has(transition.type),
      durationFrames,
      reason,
    }
  })
}

export function groupTimelineTransitionFeedbackByTrack(
  tracks: readonly TimelineTrack[],
  transitions: readonly TimelineTransition[] = [],
): ReadonlyMap<string, readonly TimelineTransitionFeedback[]> {
  const grouped = new Map<string, TimelineTransitionFeedback[]>()
  for (const feedback of resolveTimelineTransitionFeedback(tracks, transitions)) {
    if (!feedback.placementTrackId) continue
    const current = grouped.get(feedback.placementTrackId)
    if (current) current.push(feedback)
    else grouped.set(feedback.placementTrackId, [feedback])
  }
  return grouped
}
