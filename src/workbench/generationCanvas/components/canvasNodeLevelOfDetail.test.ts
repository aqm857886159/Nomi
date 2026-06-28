import { describe, expect, it } from 'vitest'
import {
  LIGHTWEIGHT_NODE_RENDER_THRESHOLD,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRendering,
} from './canvasNodeLevelOfDetail'

describe('canvas node level of detail', () => {
  it('uses lightweight rendering only for large zoomed-out canvases', () => {
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD, 0.3)).toBe(false)
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1, 0.3)).toBe(true)
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1, 1)).toBe(false)
  })

  it('keeps selected and focused nodes fully interactive in lightweight mode', () => {
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: false })).toBe(false)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: true, focusFlash: false })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: true })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: false, selected: false, focusFlash: false })).toBe(true)
  })
})
