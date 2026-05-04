import { buildClipFromGenerationNode } from '../model/buildClipFromGenerationNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TimelineClip, TimelineState, TimelineTrackType } from '../../timeline/timelineTypes'

export type SendGenerationNodeToTimelineOptions = {
  fps?: number
  startFrame?: number
  resultId?: string
  trackType?: TimelineTrackType
}

export type SendGenerationNodeToTimelinePorts = {
  readGenerationNodes: () => readonly GenerationCanvasNode[]
  readTimeline: () => TimelineState
  addTimelineClipAtFrame: (clip: TimelineClip, trackType: TimelineTrackType, startFrame: number) => void
  readTimelineAfterInsert: () => TimelineState
}

export type SendGenerationNodeToTimelineResult =
  | {
      ok: true
      nodeId: string
      clip: TimelineClip
      trackType: TimelineTrackType
      startFrame: number
    }
  | {
      ok: false
      error: 'node_not_found'
      nodeId: string
    }
  | {
      ok: false
      error: 'clip_unavailable'
      nodeId: string
    }
  | {
      ok: false
      error: 'track_type_mismatch'
      nodeId: string
      clip: TimelineClip
    }
  | {
      ok: false
      error: 'timeline_insert_failed'
      nodeId: string
      clip: TimelineClip
    }

export function sendGenerationNodeToTimeline(
  ports: SendGenerationNodeToTimelinePorts,
  nodeId: string,
  options?: SendGenerationNodeToTimelineOptions,
): SendGenerationNodeToTimelineResult {
  const id = String(nodeId || '').trim()
  const node = ports.readGenerationNodes().find((candidate) => candidate.id === id)
  if (!node) return { ok: false, error: 'node_not_found', nodeId: id || nodeId }

  const timeline = ports.readTimeline()
  const startFrame = Math.max(0, Math.floor(options?.startFrame ?? timeline.playheadFrame ?? 0))
  const clip = buildClipFromGenerationNode(node, {
    fps: options?.fps ?? timeline.fps,
    startFrame,
    resultId: options?.resultId,
  })
  if (!clip) return { ok: false, error: 'clip_unavailable', nodeId: id }
  if (options?.trackType && options.trackType !== clip.type) {
    return { ok: false, error: 'track_type_mismatch', nodeId: id, clip }
  }

  ports.addTimelineClipAtFrame(clip, clip.type, startFrame)
  const inserted = ports.readTimelineAfterInsert().tracks
    .some((track) => track.type === clip.type && track.clips.some((candidate) => candidate.id === clip.id))
  if (!inserted) return { ok: false, error: 'timeline_insert_failed', nodeId: id, clip }

  return { ok: true, nodeId: id, clip, trackType: clip.type, startFrame }
}
