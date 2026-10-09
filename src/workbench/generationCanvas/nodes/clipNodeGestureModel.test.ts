import { describe, expect, it } from 'vitest'
import {
  CLIP_GESTURE_MIN_HIT_PX,
  CLIP_HANDLE_MAX_HIT_PX,
  clientXToDesignPx,
  clipHandleHitWidth,
  playheadHitWidth,
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
    for (const zoom of [0.2, 0.5, 1, 1.5, 3]) {
      for (const clipWidth of [30, 52, 120, 400]) {
        const screenWidth = clipHandleHitWidth({ clipWidth, canvasZoom: zoom }) * zoom
        // 片段窄到一半都不足 8px 时，每侧各占一半是上限；其余情况必须 ≥ 8px。
        const floor = Math.min(CLIP_GESTURE_MIN_HIT_PX, (clipWidth * zoom) / 2)
        expect(screenWidth, `zoom ${zoom} clip ${clipWidth}`).toBeGreaterThanOrEqual(floor - 1e-9)
        expect(screenWidth).toBeLessThanOrEqual(CLIP_HANDLE_MAX_HIT_PX + 1e-9)
      }
    }
  })

  it('leaves a draggable clip body between the two handles when the clip is wide enough', () => {
    for (const zoom of [0.5, 1, 1.5]) {
      const clipWidth = 52
      const handle = clipHandleHitWidth({ clipWidth, canvasZoom: zoom })
      const body = clipWidth - handle * 2
      expect(body * zoom, `zoom ${zoom}`).toBeGreaterThanOrEqual(8)
    }
  })

  it('keeps the old 16px handle on a wide clip at 100%', () => {
    expect(clipHandleHitWidth({ clipWidth: 200, canvasZoom: 1 })).toBe(16)
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
})
