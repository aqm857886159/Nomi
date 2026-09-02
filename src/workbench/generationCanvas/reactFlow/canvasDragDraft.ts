import { applyNodeChanges, type InternalNode, type NodeChange, type ReactFlowState } from '@xyflow/react'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'

type CanvasDragKernelState = Pick<
  ReactFlowState<GenerationFlowNode, GenerationFlowEdge>,
  'nodes' | 'nodeLookup' | 'parentLookup' | 'hasDefaultNodes'
>
type CanvasDragKernelStore = {
  getState: () => CanvasDragKernelState
  setState: (partial: Partial<CanvasDragKernelState>) => void
}

// Keep the store shape local so the hot path uses the public React Flow store
// API while leaving the application nodes array untouched.
/**
 * Keeps high-frequency node geometry in React Flow's interaction layer.
 * The domain nodes are never passed to applyNodeChanges.
 */
export function applyCanvasDragPositionChanges(
  nodes: readonly GenerationFlowNode[],
  changes: readonly NodeChange<GenerationFlowNode>[],
): GenerationFlowNode[] {
  const positionChanges = changes.filter((change) => change.type === 'position' && change.position)
  if (positionChanges.length === 0) return nodes as GenerationFlowNode[]
  return applyNodeChanges(positionChanges, [...nodes])
}

/**
 * Reuses the latest projection for every node except the nodes whose draft
 * position changed. This keeps the React Flow controlled list identity stable
 * for the rest of the canvas while edges continue to read Flow's live geometry.
 */
export function overlayCanvasDragDraft(
  projectedNodes: readonly GenerationFlowNode[],
  draftNodes: readonly GenerationFlowNode[],
): GenerationFlowNode[] {
  const draftById = new Map(draftNodes.map((node) => [node.id, node]))
  return projectedNodes.map((node) => {
    const draft = draftById.get(node.id)
    if (!draft || (draft.position.x === node.position.x && draft.position.y === node.position.y)) return node
    return {
      ...node,
      position: { ...draft.position },
    }
  })
}

/**
 * Re-arms React Flow's ownership after a drag ends. The kernel path
 * (applyCanvasDragKernelPositionChanges / drag-start) turns `hasDefaultNodes`
 * off so React Flow does not double-apply drag geometry it never received via
 * setNodes. That flag also gates React Flow's own change self-application:
 * while it is false both `store.triggerNodeChanges` and the batched
 * `useReactFlow().setNodes` stop writing back to the internal store, so
 * selection changes (and the projection sync) silently no-op. Restoring it to
 * true on drag-stop is what keeps post-drag click/marquee selection — and the
 * primary-selection-gated magnetic handles — working.
 */
export function restoreCanvasDragKernelOwnership(store: CanvasDragKernelStore): void {
  if (store.getState().hasDefaultNodes) return
  store.setState({ hasDefaultNodes: true })
}

export function applyCanvasDragKernelPositionChanges(
  store: CanvasDragKernelStore,
  changes: readonly NodeChange<GenerationFlowNode>[],
): void {
  const positionChanges = changes.filter((change): change is Extract<NodeChange<GenerationFlowNode>, { type: 'position' }> => (
    change.type === 'position' && Boolean(change.position)
  ))
  if (positionChanges.length === 0) return

  const state = store.getState()
  const nodeLookup = new Map(state.nodeLookup)
  const parentLookup = new Map(state.parentLookup)
  for (const change of positionChanges) {
    const node = nodeLookup.get(change.id) as InternalNode<GenerationFlowNode> | undefined
    if (!node || !change.position) continue
    const previousPosition = node.position
    const previousAbsolute = node.internals.positionAbsolute
    const nextPosition = { ...change.position }
    const nextNode = {
      ...node,
      position: nextPosition,
      dragging: change.dragging,
      internals: {
        ...node.internals,
        positionAbsolute: {
          x: previousAbsolute.x + nextPosition.x - previousPosition.x,
          y: previousAbsolute.y + nextPosition.y - previousPosition.y,
        },
        userNode: {
          ...node.internals.userNode,
          position: nextPosition,
          dragging: change.dragging,
        },
      },
    }
    nodeLookup.set(change.id, nextNode)
    if (node.parentId) {
      const children = new Map(parentLookup.get(node.parentId) || [])
      children.set(change.id, nextNode)
      parentLookup.set(node.parentId, children)
    }
  }
  store.setState({ nodeLookup, parentLookup, hasDefaultNodes: false })
}
