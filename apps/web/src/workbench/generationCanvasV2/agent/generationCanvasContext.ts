import { collectNodeContext } from '../model/nodeContext'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export function readSelectedGenerationCanvasContext() {
  const state = useGenerationCanvasStore.getState()
  const selectedNodeId = state.selectedNodeIds[0] || ''
  if (!selectedNodeId) return null
  return collectNodeContext(state.nodes, state.edges, selectedNodeId)
}

