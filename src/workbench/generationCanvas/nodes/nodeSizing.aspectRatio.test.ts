import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  anchorNodePosition,
  buildAspectRatioNodePatch,
  resolveAreaPreservingSize,
} from './nodeSizing'

const bounds = {
  minWidth: 240,
  maxWidth: 680,
  minHeight: 120,
  maxHeight: 520,
}

describe('resolveAreaPreservingSize', () => {
  it.each([1, 21 / 9, 9 / 16])('keeps ratio and perceived area for %s', (ratio) => {
    const next = resolveAreaPreservingSize({ width: 381, height: 381 }, ratio, bounds)

    expect(next.width / next.height).toBeCloseTo(ratio, 2)
    expect(next.width * next.height).toBeCloseTo(381 * 381, -3)
  })

  it('scales both axes together when the target exceeds maximum bounds', () => {
    const next = resolveAreaPreservingSize({ width: 680, height: 520 }, 21 / 9, bounds)

    expect(next.width).toBeLessThanOrEqual(bounds.maxWidth)
    expect(next.height).toBeLessThanOrEqual(bounds.maxHeight)
    expect(next.width / next.height).toBeCloseTo(21 / 9, 2)
  })

  it('preserves an extreme ratio when min and max constraints conflict', () => {
    const next = resolveAreaPreservingSize({ width: 381, height: 381 }, 1 / 3, bounds)

    expect(next.width).toBeLessThanOrEqual(bounds.maxWidth)
    expect(next.height).toBeLessThanOrEqual(bounds.maxHeight)
    expect(next.width / next.height).toBeCloseTo(1 / 3, 2)
  })
})

describe('anchorNodePosition', () => {
  const position = { x: 100, y: 80 }
  const current = { width: 380, height: 380 }
  const next = { width: 580, height: 250 }

  it('keeps the bottom center fixed so the composer pinned below the node does not jump', () => {
    const anchored = anchorNodePosition(position, current, next)

    expect(anchored.x + next.width / 2).toBe(position.x + current.width / 2)
    expect(anchored.y + next.height).toBe(position.y + current.height)
  })
})

describe('buildAspectRatioNodePatch', () => {
  const imageNode = (overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode => ({
    id: 'image-1',
    kind: 'image',
    title: 'Image 1',
    position: { x: 100, y: 80 },
    size: { width: 381, height: 381 },
    meta: { aspect_ratio: '1:1' },
    ...overrides,
  })

  it('returns meta, size and position in one patch for an ungenerated node', () => {
    const node = imageNode()
    const patch = buildAspectRatioNodePatch(node, { aspect_ratio: '21:9' }, 21 / 9)

    expect(patch.meta).toEqual({ aspect_ratio: '21:9' })
    expect(patch.size).toBeDefined()
    expect(patch.position).toBeDefined()
    expect((patch.position?.x ?? 0) + (patch.size?.width ?? 0) / 2).toBe(
      node.position.x + (node.size?.width ?? 0) / 2,
    )
    expect((patch.position?.y ?? 0) + (patch.size?.height ?? 0)).toBe(
      node.position.y + (node.size?.height ?? 0),
    )
  })

  it('keeps current geometry for auto and only updates meta', () => {
    const patch = buildAspectRatioNodePatch(imageNode(), { aspect_ratio: 'auto' }, null)

    expect(patch).toEqual({ meta: { aspect_ratio: 'auto' } })
  })

  it('does not reshape an existing result while preparing the next generation', () => {
    const patch = buildAspectRatioNodePatch(
      imageNode({
        result: { id: 'result-1', type: 'image', url: 'https://example.com/result.png', createdAt: 1 },
      }),
      { aspect_ratio: '9:16' },
      9 / 16,
    )

    expect(patch).toEqual({ meta: { aspect_ratio: '9:16' } })
  })
})
