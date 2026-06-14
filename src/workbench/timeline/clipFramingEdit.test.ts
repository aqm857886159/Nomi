import { describe, expect, it } from 'vitest'
import { setClipFraming } from './timelineEdit'
import type { TimelineClip, TimelineState } from './timelineTypes'

function clip(id: string): TimelineClip {
  return {
    id,
    type: 'image',
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame: 0,
    endFrame: 30,
    frameCount: 30,
    offsetStartFrame: 0,
    offsetEndFrame: 30,
  }
}

function timeline(clips: TimelineClip[]): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [{ id: 'imageTrack', type: 'image', label: '图片轨', clips }],
    textClips: [],
  }
}

describe('setClipFraming', () => {
  it('writes a full sanitized framing onto the target clip, leaving others untouched', () => {
    const base = timeline([clip('a'), clip('b')])
    const next = setClipFraming(base, 'a', { fit: 'cover' })
    expect(next).not.toBe(base)
    expect(next.tracks[0].clips[0].framing).toEqual({ fit: 'cover', scale: 1, offsetX: 0, offsetY: 0 })
    expect(next.tracks[0].clips[1].framing).toBeUndefined()
  })

  it('merges a patch onto an existing framing', () => {
    const base = setClipFraming(timeline([clip('a')]), 'a', { fit: 'cover', scale: 2 })
    const next = setClipFraming(base, 'a', { offsetX: 0.3 })
    expect(next.tracks[0].clips[0].framing).toEqual({ fit: 'cover', scale: 2, offsetX: 0.3, offsetY: 0 })
  })

  it('clamps scale into the preview range', () => {
    const next = setClipFraming(timeline([clip('a')]), 'a', { scale: 99 })
    expect(next.tracks[0].clips[0].framing?.scale).toBe(4)
  })

  it('returns the same reference when the framing does not change', () => {
    const base = setClipFraming(timeline([clip('a')]), 'a', { fit: 'cover' })
    const next = setClipFraming(base, 'a', { fit: 'cover' })
    expect(next).toBe(base)
  })

  it('returns the same reference when the clip id is missing', () => {
    const base = timeline([clip('a')])
    expect(setClipFraming(base, 'nope', { fit: 'cover' })).toBe(base)
    expect(setClipFraming(base, '', { fit: 'cover' })).toBe(base)
  })
})
