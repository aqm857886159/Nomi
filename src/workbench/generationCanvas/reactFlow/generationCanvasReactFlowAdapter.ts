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
  primarySelection: boolean
  appear: boolean
  focusFlash: boolean
}

export type GenerationFlowNode = FlowNode<GenerationFlowNodeData, 'generation'>

export type GenerationFlowEdgeData = {
  generationEdge: GenerationCanvasEdge
  sourceNode: GenerationCanvasNode
  targetNode: GenerationCanvasNode
  aggregateGroupId?: string
  aggregateDirection?: 'input' | 'output'
  incident: boolean
  readOnly: boolean
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
  primarySelection = selected,
  visualState: { appear?: boolean; focusFlash?: boolean } = {},
): GenerationFlowNode {
  const size = resolveNodeVisualSize(node)
  return {
    id: node.id,
    type: 'generation',
    position: { ...node.position },
    data: {
      generationNode: node,
      readOnly,
      primarySelection,
      appear: Boolean(visualState.appear),
      focusFlash: Boolean(visualState.focusFlash),
    },
    selected,
    draggable: !readOnly,
    selectable: !readOnly,
    connectable: !readOnly,
    focusable: !readOnly,
    style: { width: size.width, height: size.height },
    className: 'generation-canvas-react-flow__node',
  }
}

export function toGenerationFlowNodes(
  nodes: readonly GenerationCanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
  readOnly: boolean,
  previousNodes: readonly GenerationFlowNode[] = [],
  visualState: {
    appearingNodeIds?: ReadonlySet<string>
    focusFlashNodeId?: string | null
  } = {},
): GenerationFlowNode[] {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]))
  const nextNodes = nodes.map((node) => {
    const selected = selectedNodeIds.has(node.id)
    const primarySelection = selected && selectedNodeIds.size === 1
    const appear = Boolean(visualState.appearingNodeIds?.has(node.id))
    const focusFlash = visualState.focusFlashNodeId === node.id
    const previous = previousById.get(node.id)
    if (
      previous?.data.generationNode === node &&
      previous.data.readOnly === readOnly &&
      previous.data.primarySelection === primarySelection &&
      previous.data.appear === appear &&
      previous.data.focusFlash === focusFlash &&
      Boolean(previous.selected) === selected
    ) {
      return previous
    }
    return toGenerationFlowNode(node, selected, readOnly, primarySelection, { appear, focusFlash })
  })
  return nextNodes.length === previousNodes.length
    && nextNodes.every((node, index) => node === previousNodes[index])
    ? previousNodes as GenerationFlowNode[]
    : nextNodes
}

export function toGenerationFlowEdge(
  edge: GenerationCanvasEdge,
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
  options: {
    readOnly?: boolean
    selected?: boolean
    incident?: boolean
    aggregateGroupId?: string
    aggregateDirection?: 'input' | 'output'
  } = {},
): GenerationFlowEdge {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  if (!source || !target) throw new Error(`Cannot project dangling canvas edge ${edge.id}`)
  const readOnly = Boolean(options.readOnly)
  const handles = resolveHandleIds(source, target)
  return {
    id: edge.id,
    type: 'generation',
    source: edge.source,
    target: edge.target,
    sourceHandle: handles.sourceHandle,
    targetHandle: handles.targetHandle,
    data: {
      generationEdge: edge,
      sourceNode: source,
      targetNode: target,
      ...(options.aggregateGroupId ? { aggregateGroupId: options.aggregateGroupId } : {}),
      ...(options.aggregateDirection ? { aggregateDirection: options.aggregateDirection } : {}),
      incident: Boolean(options.incident),
      readOnly,
    },
    selected: Boolean(options.selected),
    selectable: !readOnly,
    focusable: !readOnly,
    reconnectable: false,
    interactionWidth: 30,
    className: 'generation-canvas-react-flow__edge',
  }
}

export function toGenerationFlowEdges(
  edges: readonly GenerationCanvasEdge[],
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
  options: {
    readOnly?: boolean
    selectedEdgeId?: string | null
    selectedNodeIds?: ReadonlySet<string>
    aggregateByEdgeId?: ReadonlyMap<string, { groupId: string; direction: 'input' | 'output' }>
    previousEdges?: readonly GenerationFlowEdge[]
  } = {},
): GenerationFlowEdge[] {
  const readOnly = Boolean(options.readOnly)
  const previousById = new Map((options.previousEdges || []).map((edge) => [edge.id, edge]))
  const nextEdges = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .map((edge) => {
      const sourceNode = nodeById.get(edge.source)!
      const targetNode = nodeById.get(edge.target)!
      const selected = !readOnly && edge.id === options.selectedEdgeId
      const aggregate = options.aggregateByEdgeId?.get(edge.id)
      const incident = Boolean(
        options.selectedNodeIds?.size === 1
          && (options.selectedNodeIds.has(edge.source) || options.selectedNodeIds.has(edge.target)),
      )
      const previous = previousById.get(edge.id)
      if (
        previous?.data?.generationEdge === edge &&
        previous.data.sourceNode === sourceNode &&
        previous.data.targetNode === targetNode &&
        previous.data.aggregateGroupId === aggregate?.groupId &&
        previous.data.aggregateDirection === aggregate?.direction &&
        previous.data.readOnly === readOnly &&
        previous.data.incident === incident &&
        Boolean(previous.selected) === selected
      ) {
        return previous
      }
      return toGenerationFlowEdge(edge, nodeById, {
        readOnly,
        selected,
        incident,
        aggregateGroupId: aggregate?.groupId,
        aggregateDirection: aggregate?.direction,
      })
    })
  return options.previousEdges
    && nextEdges.length === options.previousEdges.length
    && nextEdges.every((edge, index) => edge === options.previousEdges?.[index])
    ? options.previousEdges as GenerationFlowEdge[]
    : nextEdges
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

/** React Flow 的 d3 过渡在 extent 缓存为 0×0 时会吐出 NaN 视口；任何要记住/回写的视口先过这道门。 */
export function isFiniteFlowViewport(viewport: Viewport): boolean {
  return Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom) && viewport.zoom > 0
}

export function getFlowNodeKind(node: GenerationFlowNode): GenerationNodeKind {
  return node.data.generationNode.kind
}
