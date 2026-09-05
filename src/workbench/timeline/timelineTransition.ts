import type { TimelineClip, TimelineState, TimelineTransition } from './timelineTypes'

export const DEFAULT_TRANSITION_FRAMES = 15

export const DEFAULT_TIMELINE_TRANSITION_FRAMES = 15

export type ResolvedTimelineTransition = {
  transition: TimelineTransition
  fromClip: TimelineClip
  toClip: TimelineClip
  startFrame: number
  endFrame: number
  progress: number
  outgoingOpacity: number
  incomingOpacity: number
  backdrop: 'paper' | 'black'
}

type VisualClipEntry = {
  clip: TimelineClip
  trackIndex: number
}

type ResolvedTransitionEdge = {
  transition: TimelineTransition
  from: VisualClipEntry
  to: VisualClipEntry
  durationFrames: number
}

function collectRenderableTransitionEdges(timeline: TimelineState): ResolvedTransitionEdge[] {
  const visualClips = timeline.tracks.flatMap((track, trackIndex) =>
    track.type === 'audio' ? [] : track.clips.map((clip) => ({ clip, trackIndex })),
  )
  const byClipId = new Map(visualClips.map((entry) => [entry.clip.id, entry]))
  const outgoing = new Set<string>()
  const incoming = new Set<string>()
  const edges: ResolvedTransitionEdge[] = []

  for (const transition of timeline.transitions ?? []) {
    if (transition.type !== 'dissolve' && transition.type !== 'fade') continue
    const from = byClipId.get(transition.fromClipId)
    const to = byClipId.get(transition.toClipId)
    if (!from || !to || from.trackIndex !== to.trackIndex || from.clip.endFrame !== to.clip.startFrame) continue

    const minimumDuration = Math.min(from.clip.endFrame - from.clip.startFrame, to.clip.endFrame - to.clip.startFrame)
    const durationFrames =
      transition.durationFrames ?? Math.min(DEFAULT_TIMELINE_TRANSITION_FRAMES, Math.floor(minimumDuration / 2))
    if (!Number.isInteger(durationFrames) || durationFrames < 1 || durationFrames >= minimumDuration) continue
    if (outgoing.has(from.clip.id) || incoming.has(to.clip.id)) continue

    outgoing.add(from.clip.id)
    incoming.add(to.clip.id)
    edges.push({ transition, from, to, durationFrames })
  }

  return edges
}

function resolveOpacities(
  type: TimelineTransition['type'],
  progress: number,
): Pick<ResolvedTimelineTransition, 'outgoingOpacity' | 'incomingOpacity' | 'backdrop'> {
  if (type === 'fade') {
    return progress < 0.5
      ? { outgoingOpacity: 1 - progress * 2, incomingOpacity: 0, backdrop: 'black' }
      : { outgoingOpacity: 0, incomingOpacity: progress * 2 - 1, backdrop: 'black' }
  }
  return { outgoingOpacity: 1, incomingOpacity: progress, backdrop: 'paper' }
}

/**
 * Resolves only transition effects that the production FFmpeg backend renders.
 * Unsupported or ambiguous metadata deliberately falls through to a hard cut.
 */
export function resolveTimelineTransitionsAtFrame(
  timeline: TimelineState,
  frame: number,
): ResolvedTimelineTransition[] {
  if (!Number.isFinite(frame)) return []

  return collectRenderableTransitionEdges(timeline).flatMap((edge) => {
    const startFrame = edge.to.clip.startFrame
    const endFrame = startFrame + edge.durationFrames
    if (frame < startFrame || frame >= endFrame) return []

    const progress = Math.max(0, Math.min(1, (frame - startFrame) / edge.durationFrames))
    return [
      {
        transition: { ...edge.transition, durationFrames: edge.durationFrames },
        fromClip: edge.from.clip,
        toClip: edge.to.clip,
        startFrame,
        endFrame,
        progress,
        ...resolveOpacities(edge.transition.type, progress),
      },
    ]
  })
}

export function findTimelineTransitionForClipType(
  transitions: ResolvedTimelineTransition[],
  type: 'image' | 'video',
): ResolvedTimelineTransition | null {
  return transitions.find((transition) => transition.toClip.type === type) ?? null
}
