import { describe, expect, it } from 'vitest'
import { GROUP_TOOLBAR_BOTTOM_RESERVE, GROUP_TOOLBAR_GAP, GROUP_TOOLBAR_HEIGHT, resolveGroupToolbarPlacement, resolveGroupToolbarShiftX } from './groupToolbarPlacement'

const stage = { stageHeight: 700, zoom: 1, offsetY: 0 }

/** 工具条在屏幕上占的 [top, bottom]，按放置结果反推；整条必须落在舞台内。 */
function screenSpan(frameTop: number, frameHeight: number, zoom: number, offsetY: number, placement: ReturnType<typeof resolveGroupToolbarPlacement>) {
  const frameTopScreen = frameTop * zoom + offsetY
  const frameBottomScreen = (frameTop + frameHeight) * zoom + offsetY
  if (placement.side === 'above') {
    const bottom = frameTopScreen - placement.offset * zoom
    return [bottom - GROUP_TOOLBAR_HEIGHT, bottom]
  }
  if (placement.side === 'below') {
    const top = frameBottomScreen + placement.offset * zoom
    return [top, top + GROUP_TOOLBAR_HEIGHT]
  }
  const top = frameTopScreen + placement.offset * zoom
  return [top, top + GROUP_TOOLBAR_HEIGHT]
}

describe('resolveGroupToolbarPlacement', () => {
  it('sits above the group (over its name label) when there is room', () => {
    const placement = resolveGroupToolbarPlacement({ ...stage, frameTop: 300, frameHeight: 200 })
    expect(placement.side).toBe('above')
  })

  it('flips below the frame when the group touches the top edge of the canvas', () => {
    const placement = resolveGroupToolbarPlacement({ ...stage, frameTop: 20, frameHeight: 200 })
    expect(placement.side).toBe('below')
  })

  it('floats inside the frame, pinned to the stage top, when the group is taller than the viewport', () => {
    const placement = resolveGroupToolbarPlacement({ ...stage, frameTop: -300, frameHeight: 1400 })
    expect(placement.side).toBe('inside')
  })

  it('does not flip below when that would drop it behind the bottom dock (nav controls / timeline capsule)', () => {
    // 框上沿离舞台顶 45px、框下沿 685px：放下方要 685+8+42=735 > 700-72，会被底部控件盖住。
    const placement = resolveGroupToolbarPlacement({ ...stage, frameTop: 45, frameHeight: 640 })
    expect(placement.side).toBe('inside')
  })

  it.each([
    { frameTop: 20, frameHeight: 200, zoom: 1, offsetY: 0 },
    { frameTop: 0, frameHeight: 120, zoom: 0.5, offsetY: 10 },
    { frameTop: 40, frameHeight: 300, zoom: 2, offsetY: -60 },
    { frameTop: -500, frameHeight: 2000, zoom: 1, offsetY: 0 },
    { frameTop: 300, frameHeight: 200, zoom: 1, offsetY: 0 },
    { frameTop: 10, frameHeight: 560, zoom: 1, offsetY: 0 },
  ])('keeps the whole toolbar inside the stage: %o', (input) => {
    const placement = resolveGroupToolbarPlacement({ ...input, stageHeight: 700 })
    const [top, bottom] = screenSpan(input.frameTop, input.frameHeight, input.zoom, input.offsetY, placement)
    expect(top).toBeGreaterThanOrEqual(GROUP_TOOLBAR_GAP - 0.5)
    expect(bottom).toBeLessThanOrEqual(700 - GROUP_TOOLBAR_GAP + 0.5)
    // 翻到下方的话还要避开底部常驻控件。
    if (placement.side === 'below') expect(bottom).toBeLessThanOrEqual(700 - GROUP_TOOLBAR_BOTTOM_RESERVE + 0.5)
  })
})

describe('resolveGroupToolbarShiftX', () => {
  const base = { zoom: 1, offsetX: 0, stageWidth: 800, toolbarWidth: 400 }

  it('does not move when the frame centre is comfortably inside the stage', () => {
    expect(resolveGroupToolbarShiftX({ ...base, frameLeft: 200, frameWidth: 200 })).toBe(0)
  })

  it('pulls the toolbar back in when the frame is wider than the viewport and its centre is off the right edge', () => {
    // 组框中线在屏幕 x=1300，舞台只有 800 宽：工具条右沿贴着舞台右缘（留一格间隙）。
    const shift = resolveGroupToolbarShiftX({ ...base, frameLeft: 400, frameWidth: 1800 })
    expect(1300 + shift + base.toolbarWidth / 2).toBeCloseTo(base.stageWidth - GROUP_TOOLBAR_GAP, 5)
  })

  it('pulls it in from the left edge too, in canvas pixels at any zoom', () => {
    const input = { ...base, zoom: 2, offsetX: -900, frameLeft: 0, frameWidth: 200 } // 屏幕中线 = -700
    const shift = resolveGroupToolbarShiftX(input)
    expect(-700 + shift * 2 - base.toolbarWidth / 2).toBeCloseTo(GROUP_TOOLBAR_GAP, 5)
  })

  it('leaves it alone when the stage is narrower than the toolbar itself', () => {
    expect(resolveGroupToolbarShiftX({ ...base, stageWidth: 380, frameLeft: 900, frameWidth: 100 })).toBe(0)
  })
})
