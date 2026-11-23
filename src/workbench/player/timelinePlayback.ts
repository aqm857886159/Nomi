import type { TimelineClip } from '../timeline/timelineTypes'

export function findClipByType(activeClips: TimelineClip[], type: TimelineClip['type']): TimelineClip | null {
  return activeClips.find((clip) => clip.type === type) || null
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
