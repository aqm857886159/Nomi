import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from './generationCanvasTypes'
import {
  getCardStackRearLayerCount,
  projectCollapsedGroups,
} from './canvasCardStackModel'

const node = (id: string, x: number, y: number): GenerationCanvasNode => ({
  id,
  kind: 'image',
  title: id,
  position: { x, y },
  size: { width: 240, height: 240 },
  categoryId: 'shots',
})

const group = (collapsed: boolean): NodeGroup => ({
  id: 'group-1',
  name: '雨夜咖啡馆',
  categoryId: 'shots',
  nodeIds: ['a', 'b', 'c'],
  collapsed,
  createdAt: 1,
  updatedAt: 1,
})

describe('canvas card stack model', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 2],
    [12, 2],
  ])('uses at most two rear cards for %i entries', (count, expected) => {
    expect(getCardStackRearLayerCount(count)).toBe(expected)
  })

  it('projects a collapsed group to one cover without mutating member positions', () => {
    const nodes = [node('a', 120, 90), node('b', 440, 120), node('c', 780, 160), node('outside', 20, 500)]
    const edges: GenerationCanvasEdge[] = [
      { id: 'internal', source: 'a', target: 'b' },
      { id: 'incoming', source: 'outside', target: 'a' },
      { id: 'outgoing', source: 'c', target: 'outside' },
    ]

    const projection = projectCollapsedGroups(nodes, edges, [group(true)])

    expect(projection.visibleNodes.map((entry) => entry.id)).toEqual(['outside'])
    expect(projection.cards).toMatchObject([
      {
        groupId: 'group-1',
        name: '雨夜咖啡馆',
        memberCount: 3,
        position: { x: 120, y: 90 },
      },
    ])
    expect(projection.visibleEdges.map((edge) => edge.id)).toEqual(['incoming', 'outgoing'])
    expect(projection.edgeNodeById.get('a')?.position).toEqual({ x: 120, y: 90 })
    expect(projection.edgeNodeById.get('c')?.position).toEqual({ x: 120, y: 90 })
    expect(nodes.map((entry) => entry.position)).toEqual([
      { x: 120, y: 90 },
      { x: 440, y: 120 },
      { x: 780, y: 160 },
      { x: 20, y: 500 },
    ])
  })

  it('leaves expanded groups and their edges unchanged', () => {
    const nodes = [node('a', 0, 0), node('b', 260, 0)]
    const edges: GenerationCanvasEdge[] = [{ id: 'edge', source: 'a', target: 'b' }]
    const projection = projectCollapsedGroups(nodes, edges, [group(false)])
    expect(projection.cards).toEqual([])
    expect(projection.visibleNodes).toEqual(nodes)
    expect(projection.visibleEdges).toEqual(edges)
  })
})
