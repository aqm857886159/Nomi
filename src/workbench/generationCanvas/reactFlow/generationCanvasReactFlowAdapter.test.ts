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
 isFiniteFlowViewport } from './generationCanvasReactFlowAdapter'
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
      connectable: true,
      data: { generationNode: source, readOnly: false },
    })
    expect(mapped.style).toMatchObject({ width: 240, height: 120 })
    // 「能不能拖」只由 <ReactFlow nodesDraggable> 一处说了算（R29 §6.2），投影不再重复一份。
    expect(mapped.draggable).toBeUndefined()
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

  it('maps read-only nodes and selected state for a collection', () => {
    const mapped = toGenerationFlowNodes([node('a', 0), node('b', 200)], new Set(['b']), true)
    expect(mapped.map((item) => [item.id, item.selected, item.connectable])).toEqual([
      ['a', false, false],
      ['b', true, false],
    ])
    expect(mapped.every((item) => item.selectable === false && item.focusable === false)).toBe(true)
    expect(mapped.every((item) => item.draggable === undefined)).toBe(true)
    expect(mapped.map((item) => item.data.primarySelection)).toEqual([false, true])
  })

  it('keeps large-canvas multi-selection lightweight while preserving selected state', () => {
    const mapped = toGenerationFlowNodes(
      [node('a', 0), node('b', 200), node('c', 400)],
      new Set(['a', 'b']),
      false,
    )

    expect(mapped.map((item) => [item.selected, item.data.primarySelection])).toEqual([
      [true, false],
      [true, false],
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
    const firstNodes = toGenerationFlowNodes([a, b, c], new Set(), false)
    expect(toGenerationFlowNodes([a, b, c], new Set(), false, firstNodes)).toBe(firstNodes)
    const nextNodes = toGenerationFlowNodes([a, b, c], new Set(['b']), false, firstNodes)

    expect(nextNodes[0]).toBe(firstNodes[0])
    expect(nextNodes[1]).not.toBe(firstNodes[1])
    expect(nextNodes[2]).toBe(firstNodes[2])

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

  it('updates only nodes whose transient visual state changed', () => {
    const a = node('a', 0)
    const b = node('b', 300)
    const first = toGenerationFlowNodes([a, b], new Set(), false)
    const appearing = toGenerationFlowNodes([a, b], new Set(), false, first, {
      appearingNodeIds: new Set(['b']),
    })

    expect(appearing[0]).toBe(first[0])
    expect(appearing[1]).not.toBe(first[1])
    expect(appearing[1].data).toMatchObject({ appear: true, focusFlash: false })

    const focused = toGenerationFlowNodes([a, b], new Set(['a']), false, appearing, {
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

describe('isFiniteFlowViewport', () => {
  it('正常视口通过', () => {
    expect(isFiniteFlowViewport({ x: -232, y: -120.5, zoom: 1 })).toBe(true)
  })

  it('React Flow d3 过渡撞上 0×0 extent 缓存吐出的 NaN 视口被拒（2026-09-05 走查 ~30% 复现的画布整片空白）', () => {
    expect(isFiniteFlowViewport({ x: Number.NaN, y: Number.NaN, zoom: Number.NaN })).toBe(false)
    expect(isFiniteFlowViewport({ x: 0, y: Number.NaN, zoom: 1 })).toBe(false)
  })

  it('zoom 为 0 / 负数 / 无穷也不算合法视口', () => {
    expect(isFiniteFlowViewport({ x: 0, y: 0, zoom: 0 })).toBe(false)
    expect(isFiniteFlowViewport({ x: 0, y: 0, zoom: -1 })).toBe(false)
    expect(isFiniteFlowViewport({ x: 0, y: 0, zoom: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 结构不变量（2026-09-07 R29 §6.4 / §6.5）。两条断言钉的是同一个决定：
// **框（Frame/NodeGroup）是与 nodes 平级的独立投影，永远不进 React Flow 的 nodes 数组。**
//
// 为什么要钉：今天「框不在 flowNodes 里」是实现碰巧如此，没有任何东西拦着下一个人
// 顺手在 adapter 里 push 一个 type:'group' 的节点。一旦进去：
//   · dependencyWaves.ts 只认 {nodes, edges}，会把框当成一个待生成的对象；
//   · 节点会开始带 parentId → position 语义从绝对坐标分叉成「有父时相对」，
//     而主进程 canvasNodeLayout / canvasNodeFactory 整条建立在绝对坐标上（R29 §4.3）。
// 第二条断言同时是 canvasDragDraft 删掉 parentLookup 分支的前提：投影不产 parentId，
// 内核的父子索引在本仓恒为空，那条分支恒 false。
// 要迁到原生父子必须整条迁 + 改 docs/engineering/framework-boundaries.json 的登记，不许半迁。
// ─────────────────────────────────────────────────────────────────────────────
describe('框永不进 flowNodes（R29 结构不变量）', () => {
  it('给定 N 个节点，投影长度恒为 N —— 组/框一个都不会被塞进来', () => {
    const nodes = [node('n1', 0), node('n2', 200), node('n3', 400)]
    const flowNodes = toGenerationFlowNodes(nodes, new Set(['n2']), false)
    expect(flowNodes).toHaveLength(nodes.length)
    expect(flowNodes.map((flowNode) => flowNode.id)).toEqual(['n1', 'n2', 'n3'])
    expect(flowNodes.every((flowNode) => flowNode.type === 'generation')).toBe(true)
  })

  it('投影出来的节点一律不带 parentId / extent —— 我们不用 React Flow 的原生父子', () => {
    const flowNodes = toGenerationFlowNodes([node('n1', 0), node('n2', 200)], new Set(), false)
    for (const flowNode of flowNodes) {
      expect(flowNode.parentId).toBeUndefined()
      expect(flowNode.extent).toBeUndefined()
    }
    expect(toGenerationFlowNode(node('solo', 10), false, false).parentId).toBeUndefined()
  })
})
