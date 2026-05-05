import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, resolveActiveClipsAtFrame } from '../../src/workbench/timeline/timelineMath'
import type { TimelineClip } from '../../src/workbench/timeline/timelineTypes'
import { resolveTimelinePlaybackLayer, resolveVideoClipMediaTimeSeconds } from '../../src/workbench/player/timelinePlayback'

function clip(input: Partial<TimelineClip> & Pick<TimelineClip, 'id' | 'type' | 'sourceNodeId'>): TimelineClip {
  return {
    label: input.id,
    startFrame: input.startFrame ?? 0,
    endFrame: input.endFrame ?? 30,
    frameCount: input.frameCount ?? 30,
    offsetStartFrame: input.offsetStartFrame ?? 0,
    offsetEndFrame: input.offsetEndFrame ?? 0,
    ...input,
  }
}

describe('timeline playback contracts', () => {
  it('resolves active image and video clips from the real playhead', () => {
    const timeline = createDefaultTimeline()
    timeline.playheadFrame = 15
    timeline.tracks = timeline.tracks.map((track) => {
      if (track.type === 'image') return { ...track, clips: [clip({ id: 'image-clip', type: 'image', sourceNodeId: 'image-node' })] }
      if (track.type === 'video') return { ...track, clips: [clip({ id: 'video-clip', type: 'video', sourceNodeId: 'video-node', startFrame: 10, endFrame: 60, frameCount: 50 })] }
      return track
    })

    expect(resolveActiveClipsAtFrame(timeline, 15).map((item) => item.id)).toEqual(['image-clip', 'video-clip'])
    expect(resolveTimelinePlaybackLayer(timeline).image?.id).toBe('image-clip')
    expect(resolveTimelinePlaybackLayer(timeline).video?.id).toBe('video-clip')
  })

  it('computes video media time from clip offset and playhead', () => {
    const video = clip({
      id: 'video-clip',
      type: 'video',
      sourceNodeId: 'video-node',
      startFrame: 30,
      endFrame: 90,
      frameCount: 60,
      offsetStartFrame: 15,
    })

    expect(resolveVideoClipMediaTimeSeconds({ clip: video, playheadFrame: 45, fps: 30 })).toBe(1)
  })
})
