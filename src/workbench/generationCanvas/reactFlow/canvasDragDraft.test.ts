import { describe, expect, it, vi } from 'vitest'
import type { InternalNode, NodeChange, ReactFlowState } from '@xyflow/react'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import {
  applyCanvasDragKernelPositionChanges,
  applyCanvasDragPositionChanges,
  overlayCanvasDragDraft,
  restoreCanvasDragKernelOwnership,
} from './canvasDragDraft'

function flowNode(id: string, x: number, y = 0): GenerationFlowNode {
  return {
    id,
    type: 'generation',
    position: { x, y },
    data: {
      generationNode: {
        id,
        kind: 'image',
        title: id,
        position: { x, y },
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

describe('canvas drag draft', () => {
  it('keeps the domain nodes and moveNode untouched during position ticks', () => {
    const storeNodes = [flowNode('a', 10), flowNode('b', 200)]
    const moveNode = vi.fn()
    const changes = [{
      type: 'position',
      id: 'a',
      position: { x: 42, y: 18 },
      dragging: true,
    }] as NodeChange<GenerationFlowNode>[]

    const draftNodes = applyCanvasDragPositionChanges(storeNodes, changes)

    expect(storeNodes[0].position).toEqual({ x: 10, y: 0 })
    expect(storeNodes).toEqual([flowNode('a', 10), flowNode('b', 200)])
    expect(draftNodes[0].position).toEqual({ x: 42, y: 18 })
    expect(draftNodes[1]).toBe(storeNodes[1])
    expect(moveNode).not.toHaveBeenCalled()
  })

  it('overlays only draft node geometry and preserves the other projection identities', () => {
    const projected = [flowNode('a', 10), flowNode('b', 200), flowNode('c', 400)]
    const draft = applyCanvasDragPositionChanges(projected, [{
      type: 'position',
      id: 'b',
      position: { x: 230, y: 12 },
      dragging: true,
    }] as NodeChange<GenerationFlowNode>[])

    const rendered = overlayCanvasDragDraft(projected, draft)

    expect(rendered[0]).toBe(projected[0])
    expect(rendered[1]).not.toBe(projected[1])
    expect(rendered[1].position).toEqual({ x: 230, y: 12 })
    expect(rendered[2]).toBe(projected[2])
  })

  it('updates only React Flow kernel geometry while preserving the business nodes reference', () => {
    const storeNodes = [flowNode('a', 10), flowNode('b', 200)]
    const businessNodes = storeNodes
    const internal = (node: GenerationFlowNode): InternalNode<GenerationFlowNode> => ({
      ...node,
      measured: { width: 240, height: 120 },
      internals: {
        positionAbsolute: { ...node.position },
        z: 0,
        userNode: node,
      },
    })
    const state = {
      nodes: storeNodes,
      nodeLookup: new Map(storeNodes.map((node) => [node.id, internal(node)])),
      hasDefaultNodes: false,
    } as unknown as Pick<ReactFlowState<GenerationFlowNode>, 'nodes' | 'nodeLookup' | 'hasDefaultNodes'>
    const setState = vi.fn((partial: Partial<typeof state>) => Object.assign(state, partial))

    applyCanvasDragKernelPositionChanges({ getState: () => state, setState }, [{
      type: 'position',
      id: 'a',
      position: { x: 42, y: 18 },
      dragging: true,
    }] as NodeChange<GenerationFlowNode>[])

    expect(businessNodes).toBe(storeNodes)
    expect(state.nodes).toBe(businessNodes)
    expect(state.nodeLookup.get('a')?.internals.positionAbsolute).toEqual({ x: 42, y: 18 })
    expect(state.nodeLookup.get('b')).toBeDefined()
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ hasDefaultNodes: false }))
  })

  // 回归护栏（S4 尾修 2026-09-02）：拖动内核关掉 hasDefaultNodes 后必须在松手时还原，否则
  // React Flow 的 triggerNodeChanges 与 BatchProvider setNodes 都停止自应用变更，投影同步变空操作，
  // 拖过一次后点选/取消选中不再更新 data.primarySelection —— 磁吸把手消失（canvas-full 走查断言）。
  it('re-arms React Flow ownership after a drag so selection projection stops no-op-ing', () => {
    const state = { hasDefaultNodes: false } as Pick<ReactFlowState<GenerationFlowNode>, 'hasDefaultNodes'>
    const setState = vi.fn((partial: Partial<typeof state>) => Object.assign(state, partial))

    restoreCanvasDragKernelOwnership({
      getState: () => state as never,
      setState: setState as never,
    })

    expect(state.hasDefaultNodes).toBe(true)
    expect(setState).toHaveBeenCalledWith({ hasDefaultNodes: true })
  })

  it('leaves ownership untouched when React Flow already owns the nodes', () => {
    const state = { hasDefaultNodes: true } as Pick<ReactFlowState<GenerationFlowNode>, 'hasDefaultNodes'>
    const setState = vi.fn()

    restoreCanvasDragKernelOwnership({
      getState: () => state as never,
      setState: setState as never,
    })

    expect(setState).not.toHaveBeenCalled()
  })
})
