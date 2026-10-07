import { describe, expect, it } from 'vitest'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  eligibleGenerationNodeIds,
  groupEligibleNodeIds,
  nodesInCanvasProductionScope,
  normalizeCanvasBatchConcurrency,
} from './canvasProductionScope'

function node(
  id: string,
  kind: GenerationCanvasNode['kind'],
  status: GenerationCanvasNode['status'],
  categoryId = 'shots',
): GenerationCanvasNode {
  return { ...createGenerationNode({ id, kind }), status, categoryId }
}

describe('eligibleGenerationNodeIds', () => {
  it('keeps only idle and failed generation nodes in the requested category', () => {
    const nodes = [
      node('idle-image', 'image', 'idle'),
      node('error-video', 'video', 'error'),
      node('success', 'image', 'success'),
      node('queued', 'video', 'queued'),
      node('running', 'text', 'running'),
      node('recoverable', 'audio', 'recoverable'),
      node('non-generation', 'whiteboard', 'idle'),
      node('other-category', 'image', 'idle', 'scene'),
    ]

    expect(eligibleGenerationNodeIds(nodes, { categoryId: 'shots' })).toEqual(['idle-image', 'error-video'])
  })

  it('limits a selected scope without changing node order', () => {
    const nodes = [node('a', 'image', 'idle'), node('b', 'video', 'error'), node('c', 'image', 'idle')]

    expect(eligibleGenerationNodeIds(nodes, { nodeIds: ['c', 'missing', 'a'] })).toEqual(['a', 'c'])
  })
})

describe('nodesInCanvasProductionScope', () => {
  it('uses the active category when there is no explicit node selection', () => {
    const nodes = [
      node('shot-a', 'image', 'idle', 'shots'),
      node('shot-b', 'video', 'success', 'shots'),
      node('scene-a', 'image', 'idle', 'scene'),
    ]

    expect(nodesInCanvasProductionScope(nodes, { categoryId: 'shots' }).map((item) => item.id)).toEqual([
      'shot-a',
      'shot-b',
    ])
  })

  it('uses an explicit node selection instead of the category scope', () => {
    const nodes = [node('shot-a', 'image', 'idle', 'shots'), node('scene-a', 'image', 'idle', 'scene')]

    expect(nodesInCanvasProductionScope(nodes, { nodeIds: ['scene-a'] }).map((item) => item.id)).toEqual(['scene-a'])
  })
})

describe('groupEligibleNodeIds', () => {
  it('is the one set both the toolbar enablement and the dispatch use: members that are idle or failed', () => {
    const nodes = [
      node('a', 'image', 'idle'),
      node('b', 'video', 'error'),
      node('c', 'image', 'success'),
      node('outsider', 'image', 'idle'),
    ]

    expect(groupEligibleNodeIds({ nodeIds: ['a', 'b', 'c'] }, nodes)).toEqual(['a', 'b'])
    expect(groupEligibleNodeIds({ nodeIds: [] }, nodes)).toEqual([])
    expect(groupEligibleNodeIds(null, nodes)).toEqual([])
  })
})

describe('canvas batch concurrency', () => {
  it.each([
    [undefined, 6],
    [Number.NaN, 6],
    [0, 1],
    [9, 8],
    [4.9, 4],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCanvasBatchConcurrency(input)).toBe(expected)
  })
})
