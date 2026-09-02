import type { ReactFlowState } from '@xyflow/react'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'

type CanvasSelectionFlowStore = {
  getState: () => Pick<
    ReactFlowState<GenerationFlowNode, GenerationFlowEdge>,
    'nodes' | 'setNodes'
  >
}

/**
 * Applies the session selection projection to React Flow only when its
 * interaction state is already different. RF owns the click-time selected
 * class; this boundary is for external selection actions and primary-handle
 * metadata, so it never routes selection through the domain node projection.
 */
export function syncCanvasNodeSelection(
  store: CanvasSelectionFlowStore,
  selectedNodeIds: readonly string[],
): boolean {
  const selected = new Set(selectedNodeIds)
  const state = store.getState()
  let changed = false
  const nextNodes = state.nodes.map((node) => {
    const isSelected = selected.has(node.id)
    const primarySelection = isSelected && selected.size === 1
    if (Boolean(node.selected) === isSelected && node.data.primarySelection === primarySelection) return node
    changed = true
    return {
      ...node,
      selected: isSelected,
      data: { ...node.data, primarySelection },
    }
  })
  if (changed) state.setNodes(nextNodes)
  return changed
}
