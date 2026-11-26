import type { Edge as FlowEdge, Node as FlowNode, NodeChange, Viewport } from '@xyflow/react'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeKind,
} from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { readGroupPort } from '../model/groupPort'
import { CANVAS_LAYER } from './canvasLayerOrder'

/**
 * React Flow is a rendering adapter. The persisted canvas model remains the
 * source of truth and is deliberately kept out of Flow's internal store.
 */
export type GenerationFlowNodeData = {
  generationNode: GenerationCanvasNode
  readOnly: boolean
  primarySelection: boolean
  appear: boolean
  /**
   * 节点被画布外面的东西点名时的瞬时状态（2026-10-23 D2 指向元素 P1）：
   * `hover` = 聊天里的指向元素正被悬停；`flash` = 刚被定位过去、闪一下。两样都是中性样式，不是选中、不改节点的脸。
   * 以前只有一颗 `focusFlash` 布尔（只管闪一下），现在换成这一格两档——同一件事「外面点名了这个节点」只有一个字段。
   */
  externalHighlight: ExternalNodeHighlight | null
}

export type ExternalNodeHighlight = 'hover' | 'flash'

/**
 * 外部高亮画在节点**外壳**上的样子（NodePointer 板 `canvas.node.highlight`；D2：不许蓝色描边）：
 * 悬停 = 1.5px 深色细线 + 阴影抬一级；闪一下 = 同一条细线 + 9px ink 12% 淡光晕；移开 / 闪完由 transition 淡出。
 * 画在外壳上而不是卡面里：大画布的轻量卡和完整卡同一个样子，也不碰节点的脸。外壳与设计实验室共用这一个函数。
 * 混 transparent 用 oklab：in oklch 会把中性色的色相判成 none（check:tokens 第 5b 类）。
 */
export function externalHighlightShellClass(highlight: ExternalNodeHighlight | null): string {
  // 写成任意属性 [box-shadow:…]：Tailwind 的 shadow-[…] 碰上「多段阴影 + var()」会把整串当成阴影颜色（只出 --tw-shadow-color、
  // 不出 box-shadow），样子静默消失——设计实验室走查读 computed box-shadow 抓到的。
  if (highlight === 'hover') return 'rounded-nomi transition-shadow duration-nomi-fast [box-shadow:0_0_0_1.5px_var(--nomi-ink),var(--nomi-shadow-lg)]'
  if (highlight === 'flash') return 'rounded-nomi transition-shadow duration-nomi-fast [box-shadow:0_0_0_1.5px_var(--nomi-ink),0_0_0_9px_color-mix(in_oklab,var(--nomi-ink)_12%,transparent),var(--nomi-shadow-lg)]'
  return 'rounded-nomi transition-shadow duration-nomi-fast'
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

type AggregateByEdgeId = ReadonlyMap<string, { groupId: string; direction: 'input' | 'output' }>

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
  visualState: { appear?: boolean; externalHighlight?: ExternalNodeHighlight | null } = {},
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
      externalHighlight: visualState.externalHighlight ?? null,
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
    ...(groupPort ? { draggable: false, zIndex: CANVAS_LAYER.groupPort } : {}),
    // 版本卡片铺开着：整组盖在普通节点（0）上面（09-28 拍板「盖在上面」）；选中节点由层级表抬到 5
    // （generationCanvasReactFlow.css 的 .selected !important），点中谁谁浮上来。不另加全局 CSS。
    ...(!groupPort && node.resultStackOpen ? { zIndex: CANVAS_LAYER.nodeResultStack } : {}),
    className: 'generation-canvas-react-flow__node',
  }
}

type FlowNodeVisualState = {
  appearingNodeIds?: ReadonlySet<string>
  focusFlashNodeId?: string | null
  /** 聊天里正被悬停的指向元素指着的节点（`nodeExternalHighlightStore`）。 */
  pointerHoverNodeId?: string | null
  /** 聊天那边让一起闪一下的几个节点（付费卡「完成时各亮一下」，`nodeExternalHighlightStore.flashNodeIds`）。 */
  pointerFlashNodeIds?: readonly string[]
}

/** 闪一下压过悬停：刚定位过去 / 刚开始生成的那一下最要紧。 */
export function externalHighlightOf(nodeId: string, visualState: FlowNodeVisualState): ExternalNodeHighlight | null {
  if (visualState.focusFlashNodeId === nodeId || visualState.pointerFlashNodeIds?.includes(nodeId)) return 'flash'
  if (visualState.pointerHoverNodeId === nodeId) return 'hover'
  return null
}

/** 一张卡的投影：输入没变就交回上一版同一个对象（React Flow 靠对象身份决定重不重渲）。全量与增量两条路共用这一个函数。 */
function projectOneFlowNode(
  node: GenerationCanvasNode,
  selectedNodeIds: ReadonlySet<string>,
  readOnly: boolean,
  visualState: FlowNodeVisualState,
  previous: GenerationFlowNode | undefined,
): GenerationFlowNode {
  const selected = selectedNodeIds.has(node.id)
  const primarySelection = selected && selectedNodeIds.size === 1
  const appear = Boolean(visualState.appearingNodeIds?.has(node.id))
  const externalHighlight = externalHighlightOf(node.id, visualState)
  if (
    previous?.data.generationNode === node &&
    previous.data.readOnly === readOnly &&
    previous.data.primarySelection === primarySelection &&
    previous.data.appear === appear &&
    previous.data.externalHighlight === externalHighlight &&
    Boolean(previous.selected) === selected
  ) {
    return previous
  }
  return toGenerationFlowNode(node, selected, readOnly, primarySelection, { appear, externalHighlight })
}

export function toGenerationFlowNodes(
  nodes: readonly GenerationCanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
  readOnly: boolean,
  previousNodes: readonly GenerationFlowNode[] = [],
  visualState: FlowNodeVisualState = {},
): GenerationFlowNode[] {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]))
  const nextNodes = nodes.map((node) => projectOneFlowNode(node, selectedNodeIds, readOnly, visualState, previousById.get(node.id)))
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

type FlowEdgeOptions = {
  readOnly: boolean
  selectedEdgeId?: string | null
  /** 唯一选中的那张卡；挨着它的边高亮（incident）。多选 / 没选为 null。 */
  incidentNodeId: string | null
  aggregateByEdgeId?: AggregateByEdgeId
}

/** 一条边的投影：输入没变就交回上一版同一个对象。全量与增量两条路共用这一个函数。 */
function projectOneFlowEdge(
  edge: GenerationCanvasEdge,
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
  options: FlowEdgeOptions,
  previous: GenerationFlowEdge | undefined,
): GenerationFlowEdge {
  const sourceNode = nodeById.get(edge.source)
  const targetNode = nodeById.get(edge.target)
  const selected = !options.readOnly && edge.id === options.selectedEdgeId
  const aggregate = options.aggregateByEdgeId?.get(edge.id)
  const incident = Boolean(options.incidentNodeId && (edge.source === options.incidentNodeId || edge.target === options.incidentNodeId))
  if (
    previous?.data?.generationEdge === edge &&
    previous.data.sourceNode === sourceNode &&
    previous.data.targetNode === targetNode &&
    previous.data.aggregateGroupId === aggregate?.groupId &&
    previous.data.aggregateDirection === aggregate?.direction &&
    previous.data.readOnly === options.readOnly &&
    previous.data.incident === incident &&
    Boolean(previous.selected) === selected
  ) {
    return previous
  }
  return toGenerationFlowEdge(edge, nodeById, {
    readOnly: options.readOnly,
    selected,
    incident,
    aggregateGroupId: aggregate?.groupId,
    aggregateDirection: aggregate?.direction,
  })
}

function projectFlowEdgeList(
  edges: readonly GenerationCanvasEdge[],
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
  options: FlowEdgeOptions,
  previousEdges: readonly GenerationFlowEdge[] | undefined,
): GenerationFlowEdge[] {
  const previousById = new Map((previousEdges || []).map((edge) => [edge.id, edge]))
  const nextEdges = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .map((edge) => projectOneFlowEdge(edge, nodeById, options, previousById.get(edge.id)))
  return previousEdges
    && nextEdges.length === previousEdges.length
    && nextEdges.every((edge, index) => edge === previousEdges[index])
    ? previousEdges as GenerationFlowEdge[]
    : nextEdges
}

export function toGenerationFlowEdges(
  edges: readonly GenerationCanvasEdge[],
  nodeById: ReadonlyMap<string, GenerationCanvasNode>,
  options: {
    readOnly?: boolean
    selectedEdgeId?: string | null
    selectedNodeIds?: ReadonlySet<string>
    aggregateByEdgeId?: AggregateByEdgeId
    previousEdges?: readonly GenerationFlowEdge[]
  } = {},
): GenerationFlowEdge[] {
  const selectedNodeIds = options.selectedNodeIds
  return projectFlowEdgeList(edges, nodeById, {
    readOnly: Boolean(options.readOnly),
    selectedEdgeId: options.selectedEdgeId,
    incidentNodeId: selectedNodeIds?.size === 1 ? selectedNodeIds.values().next().value ?? null : null,
    aggregateByEdgeId: options.aggregateByEdgeId,
  }, options.previousEdges)
}

// ── 选区是叠在结构投影上的一层（10-16，方向检查 docs/engineering/direction-checks/2026-10-16-canvas-shell-subscriptions.md）──
//
// React Flow 靠对象身份决定节点 / 边要不要重渲（https://reactflow.dev/learn/advanced-use/performance）。
// 结构（节点数组、边数组、端点表、只读、出现 / 闪烁）没变、只有选区变了的时候，只碰「选中过 / 被选中」的那几张卡、
// 挨着它们的边，其余交回上一版的同一个对象；整张图不再走一遍。结构变了才整表投影一次（逐个复用没变的对象），并重建下标表。

export type FlowNodeProjection = {
  readonly nodes: readonly GenerationCanvasNode[]
  readonly selected: ReadonlySet<string>
  readonly readOnly: boolean
  readonly appearingNodeIds: ReadonlySet<string> | undefined
  readonly focusFlashNodeId: string | null | undefined
  readonly pointerHoverNodeId: string | null | undefined
  readonly pointerFlashNodeIds?: readonly string[]
  readonly output: GenerationFlowNode[]
  /** id → 在 output 里的下标（结构不变时选区增量只靠它定位）。 */
  readonly indexById: ReadonlyMap<string, number>
}

export type FlowNodeProjectionInput = Omit<FlowNodeProjection, 'output' | 'indexById'>

export function projectGenerationFlowNodes(previous: FlowNodeProjection | null, input: FlowNodeProjectionInput): FlowNodeProjection {
  if (
    previous
    && previous.nodes === input.nodes
    && previous.readOnly === input.readOnly
    && previous.appearingNodeIds === input.appearingNodeIds
  ) {
    const highlightChanged = previous.focusFlashNodeId !== input.focusFlashNodeId || previous.pointerHoverNodeId !== input.pointerHoverNodeId
      || previous.pointerFlashNodeIds !== input.pointerFlashNodeIds
    if (previous.selected === input.selected && !highlightChanged) return previous
    let output = previous.output
    // 只有前后两次选区里的卡、以及前后被点名（闪 / 悬停）的那几张会变；其余交回同一个对象。
    const touched = new Set([...previous.selected, ...input.selected])
    if (highlightChanged) {
      for (const id of [previous.focusFlashNodeId, input.focusFlashNodeId, previous.pointerHoverNodeId, input.pointerHoverNodeId]) if (id) touched.add(id)
      for (const id of [...(previous.pointerFlashNodeIds ?? []), ...(input.pointerFlashNodeIds ?? [])]) touched.add(id)
    }
    for (const id of touched) {
      const index = previous.indexById.get(id)
      if (index === undefined) continue
      const next = projectOneFlowNode(input.nodes[index], input.selected, input.readOnly, input, previous.output[index])
      if (next === output[index]) continue
      if (output === previous.output) output = output.slice()
      output[index] = next
    }
    return { ...input, output, indexById: previous.indexById }
  }
  const output = toGenerationFlowNodes(input.nodes, input.selected, input.readOnly, previous?.output ?? [], input)
  const indexById = previous && output === previous.output ? previous.indexById : new Map(output.map((flowNode, index) => [flowNode.id, index]))
  return { ...input, output, indexById }
}

export type FlowEdgeProjection = {
  readonly edges: readonly GenerationCanvasEdge[]
  readonly nodeById: ReadonlyMap<string, GenerationCanvasNode>
  readonly aggregateByEdgeId: AggregateByEdgeId | undefined
  readonly readOnly: boolean
  readonly selectedEdgeId: string | null
  /** 唯一选中的那张卡（挨着它的边高亮）；多选 / 没选为 null。 */
  readonly incidentNodeId: string | null
  readonly output: GenerationFlowEdge[]
  readonly indexById: ReadonlyMap<string, number>
  /** 节点 id → 挨着它的边在 output 里的下标。 */
  readonly indexesByNodeId: ReadonlyMap<string, readonly number[]>
}

export type FlowEdgeProjectionInput = Omit<FlowEdgeProjection, 'output' | 'indexById' | 'indexesByNodeId'>

export function projectGenerationFlowEdges(previous: FlowEdgeProjection | null, input: FlowEdgeProjectionInput): FlowEdgeProjection {
  if (
    previous
    && previous.edges === input.edges
    && previous.nodeById === input.nodeById
    && previous.aggregateByEdgeId === input.aggregateByEdgeId
    && previous.readOnly === input.readOnly
  ) {
    if (previous.incidentNodeId === input.incidentNodeId && previous.selectedEdgeId === input.selectedEdgeId) return previous
    const touched = new Set<number>()
    for (const nodeId of [previous.incidentNodeId, input.incidentNodeId]) {
      if (nodeId) for (const index of previous.indexesByNodeId.get(nodeId) ?? []) touched.add(index)
    }
    for (const edgeId of [previous.selectedEdgeId, input.selectedEdgeId]) {
      const index = edgeId ? previous.indexById.get(edgeId) : undefined
      if (index !== undefined) touched.add(index)
    }
    let output = previous.output
    for (const index of touched) {
      const current = previous.output[index]
      const edge = current.data?.generationEdge
      if (!edge) continue
      const next = projectOneFlowEdge(edge, input.nodeById, edgeOptions(input), current)
      if (next === output[index]) continue
      if (output === previous.output) output = output.slice()
      output[index] = next
    }
    return { ...input, output, indexById: previous.indexById, indexesByNodeId: previous.indexesByNodeId }
  }
  const output = projectFlowEdgeList(input.edges, input.nodeById, edgeOptions(input), previous?.output)
  if (previous && output === previous.output) return { ...input, output, indexById: previous.indexById, indexesByNodeId: previous.indexesByNodeId }
  const indexById = new Map<string, number>()
  const indexesByNodeId = new Map<string, number[]>()
  output.forEach((flowEdge, index) => {
    indexById.set(flowEdge.id, index)
    for (const nodeId of new Set([flowEdge.source, flowEdge.target])) {
      const list = indexesByNodeId.get(nodeId)
      if (list) list.push(index)
      else indexesByNodeId.set(nodeId, [index])
    }
  })
  return { ...input, output, indexById, indexesByNodeId }
}

function edgeOptions(input: FlowEdgeProjectionInput): FlowEdgeOptions {
  return {
    readOnly: input.readOnly,
    selectedEdgeId: input.selectedEdgeId,
    incidentNodeId: input.incidentNodeId,
    aggregateByEdgeId: input.aggregateByEdgeId,
  }
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
