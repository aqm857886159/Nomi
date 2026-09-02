import { describe, expect, it, vi } from 'vitest'
import type { ReactFlowInstance } from '@xyflow/react'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { syncCanvasNodeProjection } from './canvasNodeProjectionSync'

function flowNode(id: string, x: number, title = id): GenerationFlowNode {
  return {
    id,
    type: 'generation',
    position: { x, y: 0 },
    data: {
      generationNode: {
        id,
        kind: 'image',
        title,
        position: { x, y: 0 },
        size: { width: 240, height: 120 },
      },
      readOnly: false,
      primarySelection: false,
      appear: false,
      focusFlash: false,
    },
    selected: false,
    draggable: true,
    selectable: true,
    connectable: true,
    focusable: true,
  }
}

function testFlow(initial: GenerationFlowNode[]) {
  let current = initial
  const setNodes = vi.fn<ReactFlowInstance<GenerationFlowNode, GenerationFlowEdge>['setNodes']>((payload) => {
    current = typeof payload === 'function' ? payload(current) : payload
  })
  const flow = {
    getNodes: () => current,
    setNodes,
  } satisfies Pick<ReactFlowInstance<GenerationFlowNode, GenerationFlowEdge>, 'getNodes' | 'setNodes'>
  return { flow, setNodes, getNodes: () => current, replaceNodes: (nodes: GenerationFlowNode[]) => { current = nodes } }
}

describe('canvas node projection sync', () => {
  it('adds a mounted projection node without touching unchanged node references', () => {
    const first = flowNode('a', 10)
    const second = flowNode('b', 200)
    const harness = testFlow([first])
    const previousProjectionRef = { current: null as readonly GenerationFlowNode[] | null }

    syncCanvasNodeProjection(harness.flow, [first], previousProjectionRef, false)
    syncCanvasNodeProjection(harness.flow, [first, second], previousProjectionRef, false)

    expect(harness.setNodes).toHaveBeenCalledTimes(1)
    expect(harness.getNodes()).toEqual([first, second])
    expect(harness.getNodes()[0]).toBe(first)
  })

  it('does not call setNodes when projection node ids and references are unchanged', () => {
    const first = flowNode('a', 10)
    const harness = testFlow([first])
    const previousProjectionRef = { current: null as readonly GenerationFlowNode[] | null }

    syncCanvasNodeProjection(harness.flow, [first], previousProjectionRef, false)
    syncCanvasNodeProjection(harness.flow, [first], previousProjectionRef, false)

    expect(harness.setNodes).not.toHaveBeenCalled()
  })

  it('updates changed data during a drag while preserving the kernel position', () => {
    const initial = flowNode('a', 10)
    const live = { ...initial, position: { x: 90, y: 18 } }
    const changed = flowNode('a', 10, 'updated')
    const harness = testFlow([initial])
    const previousProjectionRef = { current: null as readonly GenerationFlowNode[] | null }

    syncCanvasNodeProjection(harness.flow, [initial], previousProjectionRef, false)
    harness.replaceNodes([live])
    syncCanvasNodeProjection(harness.flow, [changed], previousProjectionRef, true)

    expect(harness.getNodes()[0].data.generationNode.title).toBe('updated')
    expect(harness.getNodes()[0].position).toEqual({ x: 90, y: 18 })
  })
})
