import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { anyNodeVisibleInViewport, shouldFitOnOpen } from './useAutoFitOnLoad'

const node = { id: 'node-1' } as GenerationCanvasNode

describe('shouldFitOnOpen', () => {
  it('reported case: an empty category that later receives Agent / imported nodes never auto-fits', () => {
    // 打开时是空的：之后长出来的节点是「新到的」，交给边缘提示，画布不动。
    expect(shouldFitOnOpen({ nodeCountAtOpen: 0, hasRememberedViewport: false, anyNodeVisible: false })).toBe(false)
  })

  it('class: fits only when content existed at open and there is no usable remembered view', () => {
    for (const nodeCountAtOpen of [0, 1, 24]) for (const hasRememberedViewport of [false, true]) for (const anyNodeVisible of [false, true]) {
      const expected = nodeCountAtOpen > 0 && (!hasRememberedViewport || !anyNodeVisible)
      expect(shouldFitOnOpen({ nodeCountAtOpen, hasRememberedViewport, anyNodeVisible }), JSON.stringify({ nodeCountAtOpen, hasRememberedViewport, anyNodeVisible })).toBe(expected)
    }
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
