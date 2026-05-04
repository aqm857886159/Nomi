import { findAppendFrame, hasClipOverlap } from './timelineMath'
import type { TimelineClip, TimelineState } from './timelineTypes'

function placeClipOnTrack(trackClips: TimelineClip[], clip: TimelineClip): TimelineClip {
  const probeTrack = { id: '', type: clip.type, label: '', clips: trackClips }
  const startFrame = hasClipOverlap(probeTrack, clip) ? findAppendFrame(probeTrack) : clip.startFrame
  return {
    ...clip,
    startFrame,
    endFrame: startFrame + clip.frameCount,
    id: `clip-${clip.sourceNodeId}-${clip.type}-${startFrame}`,
  }
}

export function addClipToTimeline(timeline: TimelineState, clip: TimelineClip): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.type !== clip.type) return track
      const placedClip = placeClipOnTrack(track.clips, clip)
      return {
        ...track,
        clips: [...track.clips, placedClip].sort((left, right) => left.startFrame - right.startFrame),
      }
    }),
  }
}
