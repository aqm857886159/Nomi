import { describe, expect, it } from 'vitest'
import {
  LIGHTWEIGHT_NODE_RENDER_THRESHOLD,
  retainLargeCanvasLightweightRendering,
  resolveLightweightNodePreview,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRendering,
  shouldUseLightweightNodeRenderingForSelection,
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

  it('keeps large-canvas multi-selection lightweight without degrading single selection', () => {
    const nodeCount = LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1
    expect(shouldUseLightweightNodeRenderingForSelection({ nodeCount, zoom: 1, selected: true, primarySelection: false })).toBe(true)
    expect(shouldUseLightweightNodeRenderingForSelection({ nodeCount, zoom: 1, selected: true, primarySelection: true })).toBe(false)
    expect(shouldUseLightweightNodeRenderingForSelection({ nodeCount: 20, zoom: 1, selected: true, primarySelection: false })).toBe(false)
  })

  it('retains lightweight nodes after clearing a large multi-selection until single selection', () => {
    const nodeCount = LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1
    expect(retainLargeCanvasLightweightRendering({ retained: false, nodeCount, selected: true, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, nodeCount, selected: false, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, nodeCount, selected: true, primarySelection: true })).toBe(false)
    expect(retainLargeCanvasLightweightRendering({ retained: true, nodeCount: 20, selected: false, primarySelection: false })).toBe(false)
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
