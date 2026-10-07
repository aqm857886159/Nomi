import type { Edge as FlowEdge, Node as FlowNode, NodeChange, Viewport } from '@xyflow/react'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeKind,
} from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { readGroupPort } from '../model/groupPort'

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
  // 编组端口节点（model/groupPort.ts）只为挂连线把手而存在：不可选、不可拖、外壳不吃指针
  // （框体 / 折叠卡与框里的卡照常点得到），排在卡片之下；把手自己的 pointer-events 在 CSS 里单独打开。
  const groupPort = Boolean(readGroupPort(node))
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
    // **不写 `draggable`**：节点上的这颗开关会覆盖 `<ReactFlow nodesDraggable>`，
    // 于是「能不能拖」有了两份定义，而画布外壳那一份还要额外表达「框工具就绪时不许拖」
    // （R29 §6.2）。它原本的值恒等于 `!readOnly`，与外壳传的一模一样，删掉即可（P1）。
    selectable: !readOnly && !groupPort,
    connectable: !readOnly,
    focusable: !readOnly && !groupPort,
    // Controlled re-projections replace measured state. Give the framework
    // the same domain-derived dimensions used by the node shell.
    width: size.width,
    height: size.height,
    style: groupPort
      ? { width: size.width, height: size.height, pointerEvents: 'none' }
      : { width: size.width, height: size.height },
    ...(groupPort ? { draggable: false, zIndex: -1 } : {}),
    // 版本卡片铺开着：整组盖在普通节点（0）上面（09-28 拍板「盖在上面」）；选中节点由层级表抬到 5
    // （generationCanvasReactFlow.css 的 .selected !important），点中谁谁浮上来。不另加全局 CSS。
    ...(!groupPort && node.resultStackOpen ? { zIndex: 4 } : {}),
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

/**
 * 把内核报上来的那批选择变更叠到当前选区上，算出下一份选区；**没真变就回 null**。
 *
 * 「没变就不写」这一条必须在这里：React Flow 的选择 store 是内部的、持久选区在 Zustand，
 * 每收到一次内部通知就同步一次会自激（2026-09-22 总合并把它从组件体里搬出来，同刻让那份壳回到 800 行门岗内）。
 */
export function nextSelectionFromFlowChanges(
  changes: readonly NodeChange<GenerationFlowNode>[],
  currentSelection: readonly string[],
): string[] | null {
  const selectionChanges = collectFlowSelectionChanges(changes)
  if (selectionChanges.length === 0) return null
  const selected = new Set(currentSelection)
  for (const change of selectionChanges) {
    if (change.selected) selected.add(change.nodeId)
    else selected.delete(change.nodeId)
  }
  const next = [...selected]
  if (next.length === currentSelection.length && next.every((nodeId, index) => nodeId === currentSelection[index])) return null
  return next
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
