import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTransition } from './timelineTypes'
import { findTimelineTransitionForClipType, resolveTimelineTransitionsAtFrame } from './timelineTransition'

function clip(id: string, startFrame: number, endFrame: number, type: 'image' | 'video' = 'video'): TimelineClip {
  return {
    id,
    type,
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame,
    offsetStartFrame: 0,
    offsetEndFrame: endFrame - startFrame,
  }
}

function timeline(transitions: TimelineTransition[], clips = [clip('a', 0, 30), clip('b', 30, 60)]): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: 'Image', clips: [] },
      { id: 'videoTrack', type: 'video', label: 'Video', clips },
      { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
    ],
    textClips: [],
    transitions,
  }
}

describe('resolveTimelineTransitionsAtFrame', () => {
  it('resolves a dissolve over the beginning of the incoming clip', () => {
    const state = timeline([{ fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 10 }])

    expect(resolveTimelineTransitionsAtFrame(state, 29)).toEqual([])
    expect(resolveTimelineTransitionsAtFrame(state, 30)[0]).toMatchObject({
      startFrame: 30,
      endFrame: 40,
      progress: 0,
      outgoingOpacity: 1,
      incomingOpacity: 0,
      backdrop: 'paper',
    })
    expect(resolveTimelineTransitionsAtFrame(state, 35)[0]).toMatchObject({
      progress: 0.5,
      outgoingOpacity: 1,
      incomingOpacity: 0.5,
    })
    expect(resolveTimelineTransitionsAtFrame(state, 40)).toEqual([])
  })

  it('matches the production fade-through-black opacity curve', () => {
    const state = timeline([{ fromClipId: 'a', toClipId: 'b', type: 'fade', durationFrames: 10 }])

    expect(resolveTimelineTransitionsAtFrame(state, 32)[0]).toMatchObject({
      outgoingOpacity: 0.6,
      incomingOpacity: 0,
      backdrop: 'black',
    })
    expect(resolveTimelineTransitionsAtFrame(state, 35)[0]).toMatchObject({
      outgoingOpacity: 0,
      incomingOpacity: 0,
      backdrop: 'black',
    })
    expect(resolveTimelineTransitionsAtFrame(state, 38)[0]).toMatchObject({
      outgoingOpacity: 0,
      incomingOpacity: 0.6000000000000001,
      backdrop: 'black',
    })
  })

  it('uses the backend default duration and rejects invalid transition geometry', () => {
    const defaulted = timeline([{ fromClipId: 'a', toClipId: 'b', type: 'dissolve' }])
    expect(resolveTimelineTransitionsAtFrame(defaulted, 30)[0]?.transition.durationFrames).toBe(15)

    const nonContiguous = timeline(
      [{ fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 5 }],
      [clip('a', 0, 20), clip('b', 25, 50)],
    )
    expect(resolveTimelineTransitionsAtFrame(nonContiguous, 25)).toEqual([])

    const unsupported = timeline([{ fromClipId: 'a', toClipId: 'b', type: 'whip_pan', durationFrames: 5 }])
    expect(resolveTimelineTransitionsAtFrame(unsupported, 30)).toEqual([])
  })

  it('returns independent transitions per visual track and selects them by clip type', () => {
    const state = timeline(
      [
        { fromClipId: 'image-a', toClipId: 'image-b', type: 'fade', durationFrames: 6 },
        { fromClipId: 'video-a', toClipId: 'video-b', type: 'dissolve', durationFrames: 6 },
      ],
      [clip('video-a', 0, 30), clip('video-b', 30, 60)],
    )
    state.tracks[0].clips = [clip('image-a', 0, 30, 'image'), clip('image-b', 30, 60, 'image')]

    const resolved = resolveTimelineTransitionsAtFrame(state, 32)
    expect(resolved).toHaveLength(2)
    expect(findTimelineTransitionForClipType(resolved, 'image')?.transition.type).toBe('fade')
    expect(findTimelineTransitionForClipType(resolved, 'video')?.transition.type).toBe('dissolve')
  })
})
