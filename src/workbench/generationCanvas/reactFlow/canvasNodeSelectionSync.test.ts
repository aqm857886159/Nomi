import { describe, expect, it, vi } from 'vitest'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { syncCanvasNodeSelection } from './canvasNodeSelectionSync'

function flowNode(id: string, selected = false, primarySelection = false): GenerationFlowNode {
  return {
    id,
    type: 'generation',
    position: { x: 0, y: 0 },
    data: {
      generationNode: { id, kind: 'image', title: id, position: { x: 0, y: 0 } },
      readOnly: false,
      primarySelection,
      appear: false,
      focusFlash: false,
    },
    selected,
  }
}

describe('canvas node selection sync', () => {
  it('does not write the React Flow store again for repeated selection events', () => {
    const setNodes = vi.fn()
    const nodes = [flowNode('a'), flowNode('b')]
    const store = { getState: () => ({ nodes, setNodes }) }

    expect(syncCanvasNodeSelection(store, ['a'])).toBe(true)
    const nextNodes = setNodes.mock.calls[0]?.[0] as GenerationFlowNode[]
    const stableStore = { getState: () => ({ nodes: nextNodes, setNodes }) }
    expect(syncCanvasNodeSelection(stableStore, ['a'])).toBe(false)
    expect(syncCanvasNodeSelection(stableStore, ['a'])).toBe(false)
    expect(setNodes).toHaveBeenCalledTimes(1)
  })

  it('changes only selection metadata and keeps unrelated node identity stable', () => {
    const setNodes = vi.fn()
    const a = flowNode('a')
    const b = flowNode('b')
    const store = { getState: () => ({ nodes: [a, b], setNodes }) }

    expect(syncCanvasNodeSelection(store, ['b'])).toBe(true)
    const [nextA, nextB] = setNodes.mock.calls[0]?.[0] as GenerationFlowNode[]
    expect(nextA).toBe(a)
    expect(nextB).not.toBe(b)
    expect(nextA.data.generationNode).toBe(a.data.generationNode)
    expect(nextB.data.generationNode).toBe(b.data.generationNode)
    expect(nextB).toMatchObject({ selected: true, data: { primarySelection: true } })
  })
})
