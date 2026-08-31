import { describe, expect, it } from 'vitest'
import {
  resolveComposerViewportGeometry,
  resolveComposerViewportPanDelta,
  toolbarClearanceInCanvasUnits,
} from './useComposerViewportPlacement'

describe('toolbarClearanceInCanvasUnits', () => {
  it('converts the screen-space toolbar height back into canvas units and keeps the visual gap', () => {
    expect(toolbarClearanceInCanvasUnits(42, 0.7, 18)).toBe(78)
    expect(toolbarClearanceInCanvasUnits(42, 1, 18)).toBe(60)
  })

  it('does not reserve a phantom gap when no toolbar is mounted', () => {
    expect(toolbarClearanceInCanvasUnits(0, 0.7, 18)).toBe(0)
  })
})

describe('resolveComposerViewportGeometry', () => {
  it('abandons a stale upward attachment when neither side fits and below has more room', () => {
    const placement = resolveComposerViewportGeometry({
      previousFlipUp: true,
      spaceAbove: 180,
      spaceBelow: 300,
      toolbarScreenHeight: 42,
      canvasZoom: 1,
      gap: 14,
      contentHeight: 400,
      preferredMaxHeight: 400,
    })

    expect(placement.flipUp).toBe(false)
    expect(placement.availableBelow).toBe(274)
    expect(placement.maxHeight).toBe(274)
  })

  it('subtracts the floating toolbar and both visual gaps from upward space', () => {
    const placement = resolveComposerViewportGeometry({
      previousFlipUp: false,
      spaceAbove: 420,
      spaceBelow: 260,
      toolbarScreenHeight: 42,
      canvasZoom: 1,
      gap: 14,
      contentHeight: 350,
      preferredMaxHeight: 400,
    })

    expect(placement.aboveClearance).toBe(60)
    expect(placement.availableAbove).toBe(334)
    expect(placement.availableBelow).toBe(234)
    expect(placement.flipUp).toBe(true)
  })

  it('clamps the card height to the selected side so its prompt scrolls inside the viewport', () => {
    const placement = resolveComposerViewportGeometry({
      previousFlipUp: false,
      spaceAbove: 180,
      spaceBelow: 338,
      toolbarScreenHeight: 0,
      canvasZoom: 1,
      gap: 14,
      contentHeight: 520,
      preferredMaxHeight: 460,
    })

    expect(placement.flipUp).toBe(false)
    expect(placement.maxHeight).toBe(312)
  })
})

describe('resolveComposerViewportPanDelta', () => {
  it('moves the canvas by the smallest amount that makes one full attachment side fit', () => {
    expect(resolveComposerViewportPanDelta({
      availableAbove: 130,
      availableBelow: 145,
      neededHeight: 236,
    })).toBe(-91)
  })

  it('does not pan when a side already fits or the stage is genuinely too short', () => {
    expect(resolveComposerViewportPanDelta({
      availableAbove: 130,
      availableBelow: 240,
      neededHeight: 236,
    })).toBe(0)
    expect(resolveComposerViewportPanDelta({
      availableAbove: 40,
      availableBelow: 40,
      neededHeight: 236,
    })).toBe(0)
  })
})
