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
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'
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

  it('keeps plugin identity in the React Flow data adapter', () => {
    const source = { ...node('checkpoint', 10, 20), typeId: 'nomi.workflow/checkpoint', pluginState: {
      pluginId: 'nomi.workflow', pluginVersion: '1.0.0', typeId: 'nomi.workflow/checkpoint', schemaVersion: 1, state: { checked: false },
    } }
    const mapped = toGenerationFlowNode(source, false, false)
    expect(mapped.type).toBe('generation')
    expect(mapped.data.generationNode.typeId).toBe('nomi.workflow/checkpoint')
    expect(mapped.data.generationNode.pluginState?.state).toEqual({ checked: false })
  })

  it('maps read-only nodes with neutral interaction selection', () => {
    const mapped = toGenerationFlowNodes([node('a', 0), node('b', 200)], true)
    expect(mapped.map((item) => [item.id, item.selected, item.draggable, item.connectable])).toEqual([
      ['a', false, false, false],
      ['b', false, false, false],
    ])
    expect(mapped.every((item) => item.selectable === false && item.focusable === false)).toBe(true)
    expect(mapped.map((item) => item.data.primarySelection)).toEqual([false, false])
  })

  it('keeps large-canvas nodes lightweight without projecting selection state', () => {
    const mapped = toGenerationFlowNodes([node('a', 0), node('b', 200), node('c', 400)], false)

    expect(mapped.map((item) => [item.selected, item.data.primarySelection])).toEqual([
      [false, false],
      [false, false],
      [false, false],
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
      data: { generationEdge: edges[0], sourceNode: left, targetNode: right },
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

  it('makes edge projections non-interactive in read-only mode', () => {
    const source = node('source', 0)
    const target = node('target', 300)
    const edge: GenerationCanvasEdge = { id: 'readonly', source: source.id, target: target.id }
    const [mapped] = toGenerationFlowEdges(
      [edge],
      new Map([[source.id, source], [target.id, target]]),
      { readOnly: true },
    )

    expect(mapped).toMatchObject({
      selectable: false,
      focusable: false,
      data: { generationEdge: edge, readOnly: true },
    })
  })

  it('reuses unchanged projections so one interaction does not invalidate the whole graph', () => {
    const a = node('a', 0)
    const b = node('b', 300)
    const c = node('c', 600)
    const firstNodes = toGenerationFlowNodes([a, b, c], false)
    expect(toGenerationFlowNodes([a, b, c], false, firstNodes)).toBe(firstNodes)
    const nextNodes = toGenerationFlowNodes([a, b, c], false, firstNodes)

    expect(nextNodes).toBe(firstNodes)

    const edges: GenerationCanvasEdge[] = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'ca', source: 'c', target: 'a' },
    ]
    const nodeById = new Map([a, b, c].map((item) => [item.id, item]))
    const firstEdges = toGenerationFlowEdges(edges, nodeById)
    expect(toGenerationFlowEdges(edges, nodeById, { previousEdges: firstEdges })).toBe(firstEdges)
    const nextEdges = toGenerationFlowEdges(edges, nodeById, {
      selectedNodeIds: new Set(['b']),
      previousEdges: firstEdges,
    })

    expect(nextEdges[0]).not.toBe(firstEdges[0])
    expect(nextEdges[1]).not.toBe(firstEdges[1])
    expect(nextEdges[2]).toBe(firstEdges[2])

    const multiSelectedEdges = toGenerationFlowEdges(edges, nodeById, {
      selectedNodeIds: new Set(['a', 'b']),
      previousEdges: nextEdges,
    })
    expect(multiSelectedEdges.every((edge) => edge.data?.incident === false)).toBe(true)
    expect(toGenerationFlowEdges(edges, nodeById, {
      selectedNodeIds: new Set(['a', 'b', 'c']),
      previousEdges: multiSelectedEdges,
    })).toBe(multiSelectedEdges)
  })

  it('keeps the node projection reference stable for selection-only changes', () => {
    const a = node('a', 0)
    const b = node('b', 300)
    const first = toGenerationFlowNodes([a, b], false)

    // Selection is a React Flow interaction concern. Business consumers still
    // receive the selected-id projection, but the canvas node list must not be
    // rebuilt just to paint the native `.react-flow__node.selected` class.
    expect(toGenerationFlowNodes([a, b], false, first)).toBe(first)
  })

  it('updates only nodes whose transient visual state changed', () => {
    const a = node('a', 0)
    const b = node('b', 300)
    const first = toGenerationFlowNodes([a, b], false)
    const appearing = toGenerationFlowNodes([a, b], false, first, {
      appearingNodeIds: new Set(['b']),
    })

    expect(appearing[0]).toBe(first[0])
    expect(appearing[1]).not.toBe(first[1])
    expect(appearing[1].data).toMatchObject({ appear: true, focusFlash: false })

    const focused = toGenerationFlowNodes([a, b], false, appearing, {
      focusFlashNodeId: 'a',
    })
    expect(focused[0].data).toMatchObject({ appear: false, focusFlash: true })
    expect(focused[1].data).toMatchObject({ appear: false, focusFlash: false })
  })

  it('extracts position and selection changes while ignoring unrelated changes', () => {
    const changes = [
      { type: 'position', id: 'a', position: { x: 14, y: 22 }, dragging: true },
      { type: 'select', id: 'b', selected: true },
      { type: 'dimensions', id: 'a', dimensions: { width: 20, height: 30 } },
    ] as NodeChange<GenerationFlowNode>[]
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
