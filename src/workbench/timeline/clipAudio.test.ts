import { describe, expect, it } from 'vitest'
import type { TimelineClip } from './timelineTypes'
import {
  clipAudioGainAtFrame,
  gainFromDecibels,
  isDefaultClipAudio,
  resolveClipAudio,
  resolvePreviewMediaVolume,
} from './clipAudio'

function clip(audio?: TimelineClip['audio']): TimelineClip {
  return {
    id: 'audio-clip',
    type: 'audio',
    sourceNodeId: 'asset-audio',
    label: 'Audio',
    startFrame: 10,
    endFrame: 30,
    frameCount: 20,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    ...(audio ? { audio } : {}),
  }
}

describe('clip audio semantics', () => {
  it('keeps missing audio settings at legacy unity defaults', () => {
    const resolved = resolveClipAudio(undefined, 20)
    expect(resolved).toEqual({ gainDb: 0, muted: false, fadeInFrames: 0, fadeOutFrames: 0 })
    expect(isDefaultClipAudio(resolved)).toBe(true)
    expect(clipAudioGainAtFrame(clip(), 20)).toBe(1)
  })

  it('normalizes foreign values and keeps combined fades within clip duration', () => {
    expect(resolveClipAudio({ gainDb: 6, muted: false, fadeInFrames: 8, fadeOutFrames: 8 }, 10)).toEqual({
      gainDb: 0,
      muted: false,
      fadeInFrames: 8,
      fadeOutFrames: 2,
    })
    expect(resolveClipAudio({ gainDb: -100, fadeInFrames: -3, fadeOutFrames: 1.5 }, 10)).toEqual({
      gainDb: -60,
      muted: false,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    })
  })

  it('uses the standard decibel conversion and a linear frame envelope', () => {
    const subject = clip({ gainDb: -6, fadeInFrames: 5, fadeOutFrames: 5 })
    const gain = gainFromDecibels(-6)
    expect(gain).toBeCloseTo(0.501187, 6)
    expect(clipAudioGainAtFrame(subject, 10)).toBe(0)
    expect(clipAudioGainAtFrame(subject, 12)).toBeCloseTo(gain * 0.4, 6)
    expect(clipAudioGainAtFrame(subject, 15)).toBeCloseTo(gain, 6)
    expect(clipAudioGainAtFrame(subject, 25)).toBeCloseTo(gain, 6)
    expect(clipAudioGainAtFrame(subject, 29)).toBeCloseTo(gain * 0.2, 6)
    expect(clipAudioGainAtFrame(subject, 30)).toBe(0)
  })

  it('combines clip processing with bounded global preview volume and mute', () => {
    const subject = clip({ gainDb: -6 })
    expect(resolvePreviewMediaVolume(subject, 20, 0.8, false)).toBeCloseTo(gainFromDecibels(-6) * 0.8, 6)
    expect(resolvePreviewMediaVolume(subject, 20, 2, false)).toBeCloseTo(gainFromDecibels(-6), 6)
    expect(resolvePreviewMediaVolume(subject, 20, 0.8, true)).toBe(0)
    expect(resolvePreviewMediaVolume(clip({ muted: true }), 20, 0.8, false)).toBe(0)
  })
})
