import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineTrack, TimelineTransition } from './timelineTypes'
import {
  groupTimelineTransitionFeedbackByTrack,
  resolveTimelineSourceWindow,
  resolveTimelineTransitionFeedback,
} from './timelineVisualFeedback'

function clip(id: string, startFrame: number, endFrame: number, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    type: 'video',
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    ...overrides,
  }
}

function track(id: string, clips: TimelineClip[]): TimelineTrack {
  return { id, type: clips[0]?.type ?? 'video', label: id, clips }
}

function feedback(tracks: TimelineTrack[], transition: TimelineTransition) {
  return resolveTimelineTransitionFeedback(tracks, [transition])[0]
}

describe('resolveTimelineSourceWindow', () => {
  it('keeps an untrimmed media source at the full width', () => {
    expect(resolveTimelineSourceWindow(clip('a', 0, 120))).toEqual({
      trimmed: false,
      sourceFrameCount: 120,
      sourceStartFrame: 0,
      sourceEndFrame: 120,
      trimmedStartFrames: 0,
      trimmedEndFrames: 0,
      startPercent: 0,
      widthPercent: 100,
    })
  })

  it('maps both trim offsets to the visible source segment', () => {
    expect(
      resolveTimelineSourceWindow(
        clip('a', 0, 60, {
          frameCount: 120,
          offsetStartFrame: 30,
          offsetEndFrame: 30,
        }),
      ),
    ).toMatchObject({
      trimmed: true,
      sourceStartFrame: 30,
      sourceEndFrame: 90,
      trimmedStartFrames: 30,
      trimmedEndFrames: 30,
      startPercent: 25,
      widthPercent: 50,
    })
  })

  it('clamps malformed legacy offsets to a non-empty segment', () => {
    expect(
      resolveTimelineSourceWindow(
        clip('a', 0, 1, {
          frameCount: 100,
          offsetStartFrame: 140,
          offsetEndFrame: 200,
        }),
      ),
    ).toMatchObject({ sourceStartFrame: 99, sourceEndFrame: 100, widthPercent: 1 })
  })

  it('does not present still images as source-trimmed media', () => {
    expect(
      resolveTimelineSourceWindow(
        clip('still', 0, 30, {
          type: 'image',
          offsetStartFrame: 10,
          offsetEndFrame: 10,
        }),
      ).trimmed,
    ).toBe(false)
  })
})

describe('resolveTimelineTransitionFeedback', () => {
  const a = clip('a', 0, 60)
  const b = clip('b', 60, 120)
  const videoTrack = track('video', [a, b])

  it('marks a connected cut as consistent in preview and export', () => {
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'b', type: 'cut' })).toMatchObject({
      placementTrackId: 'video',
      boundaryFrame: 60,
      connected: true,
      previewSupported: true,
      exportSupported: true,
      reason: null,
    })
  })

  it.each(['dissolve', 'fade'] as const)('marks connected %s as consistent in preview and export', (type) => {
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'b', type, durationFrames: 12 })).toMatchObject({
      connected: true,
      previewSupported: true,
      exportSupported: true,
      reason: null,
    })
  })

  it.each(['match_cut', 'whip_pan'] as const)('keeps authored %s markers visible but unsupported', (type) => {
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'b', type, durationFrames: 12 })).toMatchObject({
      connected: true,
      previewSupported: false,
      exportSupported: false,
      reason: 'unsupported_type',
    })
  })

  it('uses the renderer default duration for a supported blend', () => {
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'b', type: 'dissolve' }).durationFrames).toBe(15)
  })

  it('rejects a duration that is not shorter than both clips', () => {
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'b', type: 'fade', durationFrames: 60 })).toMatchObject({
      connected: true,
      previewSupported: false,
      exportSupported: false,
      reason: 'invalid_duration',
    })
  })

  it('distinguishes gaps, cross-track endpoints, and missing endpoints', () => {
    const gapped = track('gapped', [a, { ...b, startFrame: 80, endFrame: 140 }])
    expect(feedback([gapped], { fromClipId: 'a', toClipId: 'b', type: 'cut' }).reason).toBe('not_contiguous')
    expect(
      feedback([track('one', [a]), track('two', [b])], { fromClipId: 'a', toClipId: 'b', type: 'cut' }).reason,
    ).toBe('different_track')
    expect(feedback([videoTrack], { fromClipId: 'a', toClipId: 'missing', type: 'cut' })).toMatchObject({
      placementTrackId: 'video',
      previewSupported: false,
      exportSupported: false,
      reason: 'missing_endpoint',
    })
  })

  it('marks a second blend using the same outgoing edge as ambiguous', () => {
    const c = clip('c', 120, 180)
    const resolved = resolveTimelineTransitionFeedback(
      [track('video', [a, b, c])],
      [
        { fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 10 },
        { fromClipId: 'a', toClipId: 'b', type: 'fade', durationFrames: 10 },
      ],
    )
    expect(resolved.map((entry) => entry.reason)).toEqual([null, 'duplicate_connection'])
  })

  it('groups visible markers by their deterministic placement track', () => {
    const grouped = groupTimelineTransitionFeedbackByTrack(
      [videoTrack],
      [{ fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 8 }],
    )
    expect(grouped.get('video')).toHaveLength(1)
  })
})
