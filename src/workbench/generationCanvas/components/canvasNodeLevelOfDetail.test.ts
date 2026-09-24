import { describe, expect, it } from 'vitest'
import {
  LIGHTWEIGHT_NODE_RENDER_THRESHOLD,
  LIGHTWEIGHT_NODE_ZOOM_THRESHOLD,
  isLargeCanvas,
  isZoomedOutForLightweight,
  retainLargeCanvasLightweightRendering,
  resolveLightweightNodePreview,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRendering,
  shouldUseLightweightNodeRenderingForSelection,
} from './canvasNodeLevelOfDetail'

describe('canvas node level of detail', () => {
  it('uses lightweight rendering only for large zoomed-out canvases', () => {
    expect(isLargeCanvas(LIGHTWEIGHT_NODE_RENDER_THRESHOLD)).toBe(false)
    expect(isLargeCanvas(LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1)).toBe(true)
    expect(isZoomedOutForLightweight(LIGHTWEIGHT_NODE_ZOOM_THRESHOLD)).toBe(false)
    expect(isZoomedOutForLightweight(0.3)).toBe(true)
    expect(shouldUseLightweightNodeRendering(false, true)).toBe(false)
    expect(shouldUseLightweightNodeRendering(true, true)).toBe(true)
    expect(shouldUseLightweightNodeRendering(true, false)).toBe(false)
  })

  it('keeps selected and focused nodes fully interactive in lightweight mode', () => {
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: false })).toBe(false)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: true, focusFlash: false })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: true })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: false, selected: false, focusFlash: false })).toBe(true)
  })

  it('keeps large-canvas multi-selection lightweight without degrading single selection', () => {
    expect(shouldUseLightweightNodeRenderingForSelection({ largeCanvas: true, zoomedOut: false, selected: true, primarySelection: false })).toBe(true)
    expect(shouldUseLightweightNodeRenderingForSelection({ largeCanvas: true, zoomedOut: false, selected: true, primarySelection: true })).toBe(false)
    expect(shouldUseLightweightNodeRenderingForSelection({ largeCanvas: false, zoomedOut: false, selected: true, primarySelection: false })).toBe(false)
  })

  it('retains lightweight nodes after clearing a large multi-selection until single selection', () => {
    expect(retainLargeCanvasLightweightRendering({ retained: false, largeCanvas: true, selected: true, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, largeCanvas: true, selected: false, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, largeCanvas: true, selected: true, primarySelection: true })).toBe(false)
    expect(retainLargeCanvasLightweightRendering({ retained: true, largeCanvas: false, selected: false, primarySelection: false })).toBe(false)
  })
})

describe('resolveLightweightNodePreview', () => {
  it('uses an image thumbnail before the full image URL', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'image', thumbnailUrl: 'thumb.webp', url: 'full.png' },
      }),
    ).toEqual({ kind: 'image', src: 'thumb.webp' })
  })

  it('uses a video thumbnail as a static lightweight preview', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', thumbnailUrl: 'poster.jpg', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'image', src: 'poster.jpg' })
  })

  it('keeps videos playable when no poster was persisted', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'video', src: 'clip.mp4' })
  })

  it('does not mount media for non-visual results or empty URLs', () => {
    expect(resolveLightweightNodePreview({ result: { type: 'text' } })).toBeNull()
    expect(resolveLightweightNodePreview({ result: { type: 'image', url: '  ' } })).toBeNull()
  })
})
