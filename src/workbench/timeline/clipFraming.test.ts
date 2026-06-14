import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLIP_FRAMING,
  clampFramingScale,
  computeFramedRect,
  resolveClipFraming,
} from './clipFraming'

describe('resolveClipFraming', () => {
  it('returns the default framing (contain / 1 / 0 / 0) when clip has none', () => {
    expect(resolveClipFraming({})).toEqual(DEFAULT_CLIP_FRAMING)
    expect(resolveClipFraming(undefined)).toEqual(DEFAULT_CLIP_FRAMING)
  })

  it('merges partial framing onto the defaults and sanitizes non-finite values', () => {
    expect(resolveClipFraming({ framing: { fit: 'cover' } })).toEqual({
      fit: 'cover',
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    })
    expect(resolveClipFraming({ framing: { scale: Number.NaN, offsetX: 0.2 } })).toEqual({
      fit: 'contain',
      scale: 1,
      offsetX: 0.2,
      offsetY: 0,
    })
  })

  it('clamps an out-of-range scale into the preview range', () => {
    expect(resolveClipFraming({ framing: { scale: 99 } }).scale).toBe(4)
    expect(resolveClipFraming({ framing: { scale: 0.01 } }).scale).toBe(0.25)
  })
})

describe('clampFramingScale', () => {
  it('clamps to the [0.25, 4] preview range and falls back to 1 for garbage', () => {
    expect(clampFramingScale(2)).toBe(2)
    expect(clampFramingScale(10)).toBe(4)
    expect(clampFramingScale(0)).toBe(0.25)
    expect(clampFramingScale(Number.NaN)).toBe(1)
  })
})

describe('computeFramedRect', () => {
  // 100x100 square into a 320x180 (16:9) frame
  it('contain: fits inside, centered, with letterbox bars', () => {
    const rect = computeFramedRect({ fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 }, 320, 180, 100, 100)
    // factor = min(320/100, 180/100) = 1.8 -> 180x180 centered
    expect(rect).toEqual({ x: 70, y: 0, width: 180, height: 180 })
  })

  it('cover: fills the frame, centered, cropping the overflow', () => {
    const rect = computeFramedRect({ fit: 'cover', scale: 1, offsetX: 0, offsetY: 0 }, 320, 180, 100, 100)
    // factor = max(320/100, 180/100) = 3.2 -> 320x320 centered (top/bottom cropped)
    expect(rect).toEqual({ x: 0, y: -70, width: 320, height: 320 })
  })

  it('scale multiplies on top of the base fit, about the center', () => {
    const rect = computeFramedRect({ fit: 'contain', scale: 0.5, offsetX: 0, offsetY: 0 }, 320, 180, 100, 100)
    // 180*0.5 = 90 -> 90x90 centered
    expect(rect).toEqual({ x: 115, y: 45, width: 90, height: 90 })
  })

  it('offset is a fraction of the frame dimensions applied after centering', () => {
    const rect = computeFramedRect({ fit: 'contain', scale: 0.5, offsetX: 0.25, offsetY: -0.1 }, 320, 180, 100, 100)
    // base centered (115, 45); +0.25*320 = +80 x; -0.1*180 = -18 y
    expect(rect).toEqual({ x: 195, y: 27, width: 90, height: 90 })
  })

  it('returns an empty rect when the source has no dimensions', () => {
    expect(computeFramedRect(DEFAULT_CLIP_FRAMING, 320, 180, 0, 100)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
