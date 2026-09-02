import type { ReactFlowInstance } from '@xyflow/react'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'

type ProjectionSyncFlow = Pick<ReactFlowInstance<GenerationFlowNode, GenerationFlowEdge>, 'getNodes' | 'setNodes'>
type ProjectionRef = { current: readonly GenerationFlowNode[] | null }

function sameProjection(
  previous: readonly GenerationFlowNode[] | null,
  next: readonly GenerationFlowNode[],
): boolean {
  if (!previous || previous.length !== next.length) return false
  return next.every((node, index) => {
    const previousNode = previous[index]
    return previousNode?.id === node.id && previousNode === node
  })
}

/**
 * Reconciles the business projection into an uncontrolled React Flow store.
 * The projection is the only write direction; React Flow remains the owner of
 * transient drag geometry until the existing drag-stop writeback commits it.
 */
export function syncCanvasNodeProjection(
  flow: ProjectionSyncFlow,
  projectedNodes: readonly GenerationFlowNode[],
  previousProjectionRef: ProjectionRef,
  isDragging: boolean,
): void {
  const previous = previousProjectionRef.current
  if (sameProjection(previous, projectedNodes)) return

  const previousById = new Map(previous?.map((node) => [node.id, node]) ?? [])
  previousProjectionRef.current = projectedNodes
  const currentNodes = flow.getNodes()
  const currentMatchesProjection = currentNodes.length === projectedNodes.length
    && currentNodes.every((node, index) => node.id === projectedNodes[index]?.id && node === projectedNodes[index])
  if (currentMatchesProjection) return

  flow.setNodes((current) => {
    const currentById = new Map(current.map((node) => [node.id, node]))
    return projectedNodes.map((projected) => {
      const currentNode = currentById.get(projected.id)
      const projectionChanged = previousById.get(projected.id) !== projected
      if (currentNode && !projectionChanged) return currentNode
      if (currentNode && isDragging && previousById.has(projected.id)) {
        return {
          ...projected,
          position: { ...currentNode.position },
          dragging: currentNode.dragging,
        }
      }
      return projected
    })
  })
}
