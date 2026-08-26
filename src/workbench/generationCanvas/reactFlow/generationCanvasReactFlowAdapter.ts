import type { Edge as FlowEdge, Node as FlowNode, NodeChange, Viewport } from '@xyflow/react'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeKind,
} from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'

/**
 * React Flow is a rendering adapter. The persisted canvas model remains the
 * source of truth and is deliberately kept out of Flow's internal store.
 */
export type GenerationFlowNodeData = {
  generationNode: GenerationCanvasNode
  readOnly: boolean
}

export type GenerationFlowNode = FlowNode<GenerationFlowNodeData, 'generation'>

export type GenerationFlowEdgeData = {
  generationEdge: GenerationCanvasEdge
}

export type GenerationFlowEdge = FlowEdge<GenerationFlowEdgeData, 'generation'>

export const FLOW_SOURCE_LEFT = 'source-left'
export const FLOW_SOURCE_RIGHT = 'source-right'
export const FLOW_TARGET_LEFT = 'target-left'
export const FLOW_TARGET_RIGHT = 'target-right'

function resolveHandleIds(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
): { sourceHandle: string; targetHandle: string } {
  const sourceSize = resolveNodeVisualSize(source)
  const targetSize = resolveNodeVisualSize(target)
  const targetIsLeft = target.position.x + targetSize.width / 2 < source.position.x + sourceSize.width / 2
  return targetIsLeft
    ? { sourceHandle: FLOW_SOURCE_LEFT, targetHandle: FLOW_TARGET_RIGHT }
    : { sourceHandle: FLOW_SOURCE_RIGHT, targetHandle: FLOW_TARGET_LEFT }
}

export function toGenerationFlowNode(
  node: GenerationCanvasNode,
  selected: boolean,
  readOnly: boolean,
): GenerationFlowNode {
  const size = resolveNodeVisualSize(node)
  return {
    id: node.id,
    type: 'generation',
    position: { ...node.position },
    data: { generationNode: node, readOnly },
    selected,
    draggable: !readOnly,
    selectable: true,
    connectable: !readOnly,
    focusable: true,
    style: { width: size.width, height: size.height },
    className: 'generation-canvas-react-flow__node',
  }
}

export function toGenerationFlowNodes(
  nodes: readonly GenerationCanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
  readOnly: boolean,
): GenerationFlowNode[] {
  return nodes.map((node) => toGenerationFlowNode(node, selectedNodeIds.has(node.id), readOnly))
}

export function toGenerationFlowEdge(
  edge: GenerationCanvasEdge,
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
): GenerationFlowEdge {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  const handles = source && target ? resolveHandleIds(source, target) : {
    sourceHandle: FLOW_SOURCE_RIGHT,
    targetHandle: FLOW_TARGET_LEFT,
  }
  return {
    id: edge.id,
    type: 'generation',
    source: edge.source,
    target: edge.target,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle,
    data: { generationEdge: edge },
    selectable: true,
    focusable: true,
    reconnectable: false,
    interactionWidth: 30,
    className: 'generation-canvas-react-flow__edge',
  }
}

export function toGenerationFlowEdges(
  edges: readonly GenerationCanvasEdge[],
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
): GenerationFlowEdge[] {
  return edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .map((edge) => toGenerationFlowEdge(edge, nodeById))
}

export function collectFlowPositionChanges(
  changes: readonly NodeChange<GenerationFlowNode>[],
): Array<{ nodeId: string; position: { x: number; y: number } }> {
  return changes.flatMap((change) => {
    if (change.type !== 'position' || !change.position) return []
    return [{ nodeId: change.id, position: { x: change.position.x, y: change.position.y } }]
  })
}

export function collectFlowSelectionChanges(
  changes: readonly NodeChange<GenerationFlowNode>[],
): Array<{ nodeId: string; selected: boolean }> {
  return changes.flatMap((change) => {
    if (change.type !== 'select') return []
    return [{ nodeId: change.id, selected: change.selected }]
  })
}

export function flowViewportFromCanvas(viewport: { zoom: number; offset: { x: number; y: number } }): Viewport {
  return { x: viewport.offset.x, y: viewport.offset.y, zoom: viewport.zoom }
}

export function canvasViewportFromFlow(viewport: Viewport): { zoom: number; offset: { x: number; y: number } } {
  return { zoom: viewport.zoom, offset: { x: viewport.x, y: viewport.y } }
}

export function getFlowNodeKind(node: GenerationFlowNode): GenerationNodeKind {
  return node.data.generationNode.kind
}
