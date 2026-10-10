import { describe, expect, it } from 'vitest'
import {
  CLIP_GESTURE_MIN_HIT_PX,
  CLIP_HANDLE_MAX_HIT_PX,
  clientXToDesignPx,
  clipHandleHitWidth,
  clipHitPadWidth,
  CLIP_MIN_CLICK_PX,
  edgeScrollStep,
  playheadHitWidth,
  resolveClipNodeDropFrame,
  resolveClipGestureAdmission,
  screenPxToDesignPx,
} from './clipNodeGestureModel'

describe('clip node gesture model', () => {
  it('converts screen pixels to node-local pixels by the canvas zoom', () => {
    expect(screenPxToDesignPx(8, 0.5)).toBe(16)
    expect(screenPxToDesignPx(8, 1)).toBe(8)
    expect(screenPxToDesignPx(9, 1.5)).toBe(6)
    // 坏值回落到 1:1，不产生 NaN / Infinity。
    expect(screenPxToDesignPx(8, 0)).toBe(8)
    expect(screenPxToDesignPx(8, Number.NaN)).toBe(8)
    expect(clientXToDesignPx(150, 100, 0.5)).toBe(100)
    expect(clientXToDesignPx(150, 100, 1.5)).toBeCloseTo(33.33, 1)
  })

  it('keeps every trim handle at least 8 screen pixels wide at any canvas zoom', () => {
    for (const selected of [false, true]) {
      for (const zoom of [0.2, 0.5, 1, 1.5, 3]) {
        for (const clipWidth of [30, 52, 120, 400]) {
          const screenWidth = clipHandleHitWidth({ clipWidth, canvasZoom: zoom, selected }) * zoom
          // 片段窄到一半都不足 8px 时，每侧各占一半是上限；其余情况必须 ≥ 8px。
          const floor = Math.min(CLIP_GESTURE_MIN_HIT_PX, (clipWidth * zoom) / 2)
          expect(screenWidth, `selected ${selected} zoom ${zoom} clip ${clipWidth}`).toBeGreaterThanOrEqual(floor - 1e-9)
          expect(screenWidth).toBeLessThanOrEqual(CLIP_HANDLE_MAX_HIT_PX + 1e-9)
        }
      }
    }
  })

  it('gives a hovered (unselected) clip exactly the minimum handle so the clip body stays draggable', () => {
    for (const zoom of [0.5, 1, 1.5]) {
      const clipWidth = 52
      const handle = clipHandleHitWidth({ clipWidth, canvasZoom: zoom, selected: false })
      expect(handle * zoom).toBeCloseTo(CLIP_GESTURE_MIN_HIT_PX)
      expect((clipWidth - handle * 2) * zoom, `zoom ${zoom}`).toBeGreaterThanOrEqual(8)
    }
  })

  it('keeps the old 16px handle on a wide selected clip at 100%', () => {
    expect(clipHandleHitWidth({ clipWidth: 200, canvasZoom: 1, selected: true })).toBe(16)
    expect(clipHandleHitWidth({ clipWidth: 200, canvasZoom: 1, selected: false })).toBe(8)
  })

  it('shrinks a selected handle to a third of a narrow clip, never below 8 screen pixels', () => {
    expect(clipHandleHitWidth({ clipWidth: 42, canvasZoom: 1, selected: true })).toBeCloseTo(14.28, 1)
    expect(clipHandleHitWidth({ clipWidth: 20, canvasZoom: 1, selected: true })).toBe(8)
  })

  it('sizes the playhead grab band in screen pixels', () => {
    expect(playheadHitWidth(1)).toBe(8)
    expect(playheadHitWidth(0.5) * 0.5).toBeCloseTo(8)
    expect(playheadHitWidth(1.5) * 1.5).toBeCloseTo(8)
  })

  it('admits a gesture by selecting the node and the clip at press time', () => {
    expect(resolveClipGestureAdmission({ nodeSelected: false, selectedClipId: undefined, targetClipId: 'clip-a' }))
      .toEqual({ selectNode: true, selectClipId: 'clip-a' })
    expect(resolveClipGestureAdmission({ nodeSelected: true, selectedClipId: 'clip-a', targetClipId: 'clip-a' }))
      .toEqual({ selectNode: false, selectClipId: null })
    expect(resolveClipGestureAdmission({ nodeSelected: true, selectedClipId: 'clip-a', targetClipId: 'clip-b' }))
      .toEqual({ selectNode: false, selectClipId: 'clip-b' })
    // 拖播放头只选节点，不改片段选择。
    expect(resolveClipGestureAdmission({ nodeSelected: false, selectedClipId: 'clip-a', targetClipId: null }))
      .toEqual({ selectNode: true, selectClipId: null })
  })

  it('pads a narrow clip up to 24 screen pixels, split over both sides, and leaves a wide clip alone', () => {
    for (const zoom of [0.5, 1, 1.5]) {
      const clipWidth = 13
      const pad = clipHitPadWidth({ clipWidth, canvasZoom: zoom })
      expect((clipWidth + pad * 2) * zoom).toBeCloseTo(CLIP_MIN_CLICK_PX)
    }
    expect(clipHitPadWidth({ clipWidth: 60, canvasZoom: 1 })).toBe(0)
  })

  it('scrolls only inside the edge zone, faster the closer to the edge, and at full speed beyond it', () => {
    const base = { viewportLeft: 100, viewportRight: 500, canvasZoom: 1 }
    expect(edgeScrollStep({ ...base, clientX: 300 })).toBe(0)
    const slow = edgeScrollStep({ ...base, clientX: 490 })
    const fast = edgeScrollStep({ ...base, clientX: 499 })
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(slow)
    expect(edgeScrollStep({ ...base, clientX: 700 })).toBeGreaterThanOrEqual(fast)
    expect(edgeScrollStep({ ...base, clientX: 101 })).toBeLessThan(0)
    // 同样的屏幕速度，画布缩小后节点内要滚得更多。
    expect(edgeScrollStep({ ...base, canvasZoom: 0.5, clientX: 499 })).toBeCloseTo(edgeScrollStep({ ...base, clientX: 499 }) * 2)
  })

  it('drops onto the nearer edge of a clip and exactly at the frame in empty space', () => {
    const clips = [{ startFrame: 0, endFrame: 100 }, { startFrame: 100, endFrame: 200 }]
    expect(resolveClipNodeDropFrame(clips, 20)).toBe(0)
    expect(resolveClipNodeDropFrame(clips, 80)).toBe(100)
    expect(resolveClipNodeDropFrame(clips, 130)).toBe(100)
    expect(resolveClipNodeDropFrame(clips, 190)).toBe(200)
    expect(resolveClipNodeDropFrame(clips, 450)).toBe(450)
    expect(resolveClipNodeDropFrame([], -5)).toBe(0)
  })
})
