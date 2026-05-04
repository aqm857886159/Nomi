import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { resolveActiveClipsAtFrame } from '../timeline/timelineMath'

export type TimelinePlaybackLayer = {
  image: TimelineClip | null
  video: TimelineClip | null
}

function findClipByType(activeClips: TimelineClip[], type: TimelineClip['type']): TimelineClip | null {
  return activeClips.find((clip) => clip.type === type) || null
}

export function resolveTimelinePlaybackLayer(timeline: TimelineState): TimelinePlaybackLayer {
  const activeClips = resolveActiveClipsAtFrame(timeline, timeline.playheadFrame)
  return {
    image: findClipByType(activeClips, 'image'),
    video: findClipByType(activeClips, 'video'),
  }
}

export function resolveVideoClipMediaTimeSeconds(params: {
  clip: TimelineClip
  playheadFrame: number
  fps: number
}): number {
  const fps = Math.max(1, params.fps)
  const relativeFrame = Math.max(0, params.playheadFrame - params.clip.startFrame)
  return (params.clip.offsetStartFrame + relativeFrame) / fps
}
