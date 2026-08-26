import { describe, expect, it } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import {
  FLOW_SOURCE_LEFT,
  FLOW_SOURCE_RIGHT,
  FLOW_TARGET_LEFT,
  FLOW_TARGET_RIGHT,
  canvasViewportFromFlow,
  collectFlowPositionChanges,
  collectFlowSelectionChanges,
  flowViewportFromCanvas,
  toGenerationFlowEdges,
  toGenerationFlowNode,
  toGenerationFlowNodes,
} from './generationCanvasReactFlowAdapter'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, x: number, y = 0): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x, y },
    size: { width: 100, height: 80 },
  }
}

describe('generation canvas React Flow adapter', () => {
  it('maps nodes without mutating the domain object', () => {
    const source = node('source', 10, 20)
    const mapped = toGenerationFlowNode(source, true, false)

    expect(mapped).toMatchObject({
      id: 'source',
      type: 'generation',
      position: { x: 10, y: 20 },
      selected: true,
      draggable: true,
      connectable: true,
      data: { generationNode: source, readOnly: false },
    })
    expect(mapped.style).toMatchObject({ width: 240, height: 120 })
    expect(source).toEqual(node('source', 10, 20))
  })

  it('maps read-only nodes and selected state for a collection', () => {
    const mapped = toGenerationFlowNodes([node('a', 0), node('b', 200)], new Set(['b']), true)
    expect(mapped.map((item) => [item.id, item.selected, item.draggable, item.connectable])).toEqual([
      ['a', false, false, false],
      ['b', true, false, false],
    ])
  })

  it('preserves edge semantics and derives handle direction', () => {
    const left = node('left', 0)
    const right = node('right', 300)
    const edges: GenerationCanvasEdge[] = [
      { id: 'e1', source: 'left', target: 'right', mode: 'character_ref', order: 2, viaGroupId: 'group-1' },
      { id: 'e2', source: 'right', target: 'left', mode: 'first_frame', order: 1 },
    ]
    const mapped = toGenerationFlowEdges(edges, new Map([left, right].map((item) => [item.id, item])))
    expect(mapped[0]).toMatchObject({
      sourceHandle: FLOW_SOURCE_RIGHT,
      targetHandle: FLOW_TARGET_LEFT,
      data: { generationEdge: edges[0] },
    })
    expect(mapped[1]).toMatchObject({
      sourceHandle: FLOW_SOURCE_LEFT,
      targetHandle: FLOW_TARGET_RIGHT,
      data: { generationEdge: edges[1] },
    })
  })

  it('filters dangling edges instead of handing invalid graph data to Flow', () => {
    const valid = node('valid', 0)
    const mapped = toGenerationFlowEdges(
      [
        { id: 'valid-edge', source: 'valid', target: 'valid' },
        { id: 'dangling', source: 'valid', target: 'missing' },
      ],
      new Map([[valid.id, valid]]),
    )
    expect(mapped.map((item) => item.id)).toEqual(['valid-edge'])
  })

  it('extracts position and selection changes while ignoring unrelated changes', () => {
    const changes = [
      { type: 'position', id: 'a', position: { x: 14, y: 22 }, dragging: true },
      { type: 'select', id: 'b', selected: true },
      { type: 'dimensions', id: 'a', dimensions: { width: 20, height: 30 } },
    ] as NodeChange[]
    expect(collectFlowPositionChanges(changes)).toEqual([{ nodeId: 'a', position: { x: 14, y: 22 } }])
    expect(collectFlowSelectionChanges(changes)).toEqual([{ nodeId: 'b', selected: true }])
  })

  it('converts viewport in both directions', () => {
    const canvas = { zoom: 1.25, offset: { x: -42, y: 18 } }
    const flow = flowViewportFromCanvas(canvas)
    expect(flow).toEqual({ x: -42, y: 18, zoom: 1.25 })
    expect(canvasViewportFromFlow(flow)).toEqual(canvas)
  })
})
