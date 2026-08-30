import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { anyNodeVisibleInViewport, isInteractiveFirstNodeInsertion } from './useAutoFitOnLoad'

const node = { id: 'node-1' } as GenerationCanvasNode

describe('isInteractiveFirstNodeInsertion', () => {
  it('recognizes the selected first node as an interactive insertion', () => {
    expect(isInteractiveFirstNodeInsertion(
      [{ ...node, position: { x: 240, y: 240 } }],
      ['node-1'],
      1,
      { x: 0, y: 0 },
      1200,
      800,
    )).toBe(true)
  })

  it('does not suppress auto-fit for loaded or multi-node canvases', () => {
    expect(isInteractiveFirstNodeInsertion([node], [], 1, { x: 0, y: 0 }, 1200, 800)).toBe(false)
    expect(isInteractiveFirstNodeInsertion(
      [node, { ...node, id: 'node-2' }],
      ['node-1'],
      1,
      { x: 0, y: 0 },
      1200,
      800,
    )).toBe(false)
  })

  it('does not suppress auto-fit when the selected first node is off-screen', () => {
    expect(isInteractiveFirstNodeInsertion(
      [{ ...node, position: { x: 240, y: 240 } }],
      ['node-1'],
      1,
      { x: -2000, y: -2000 },
      1200,
      800,
    )).toBe(false)
  })
})

describe('anyNodeVisibleInViewport', () => {
  it('treats the rendered media preview as visible when its stale persisted box is off-screen', () => {
    const loadedImage = {
      ...node,
      position: { x: 0, y: -400 },
      size: { width: 360, height: 280 },
      meta: { previewHeight: 432 },
      result: { id: 'result-1', type: 'image', url: 'nomi-local://asset/image.jpg', createdAt: 1 },
    } as GenerationCanvasNode

    expect(anyNodeVisibleInViewport([loadedImage], 1, { x: 0, y: 0 }, 1200, 800)).toBe(true)
  })
})
