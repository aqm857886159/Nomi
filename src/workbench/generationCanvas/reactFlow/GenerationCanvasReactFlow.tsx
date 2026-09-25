import { completeNodeConnection } from '../nodes/completeNodeConnection'
import React from 'react'
import {
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useStoreApi,
  useReactFlow,
  type OnNodeDrag,
  type OnEdgesDelete,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './generationCanvasReactFlow.css'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { saveWorkflowFromProject } from '../../library/workflowLibrary'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useStableCategoryNodes } from './useStableCategoryNodes'
import { getCanvasGroupBoxes, getSelectedBounds } from '../components/generationCanvasGeometry'
import { CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM, unionCanvasFitBounds } from '../model/canvasFitBounds'
import { projectCollapsedGroups } from '../model/canvasCardStackModel'
import { useCanvasSelectionDrag } from '../components/useCanvasSelectionDrag'
import { useCanvasGroupActions } from '../components/useCanvasGroupActions'
import { measuredRectFromInternalNode } from './canvasMeasuredNodeRect'
import { useCanvasPastePlacement } from './useCanvasPastePlacement'
import { CANVAS_RESULT_DRAG_MIME } from '../components/canvasResultDrag'
import { useCanvasFrameTool } from '../components/useCanvasFrameTool'
import { useCanvasFrameMembership } from '../components/useCanvasFrameMembership'
import { useCanvasFrameActions } from '../components/useCanvasFrameActions'
import { resolveSelectedGroupId } from '../model/selectedGroup'
import { projectGroupConnectionPorts } from './groupConnectionPorts'
import type { CanvasFrameInteraction } from '../components/GroupFrame'
import { useCanvasShortcuts } from '../components/useCanvasShortcuts'
import { connectSelectedCanvasNodes } from '../components/canvasSelectionConnection'
import { useCanvasScreenshotCapture } from '../components/useCanvasScreenshotCapture'
import { useCanvasProductionActions } from '../components/useCanvasProductionActions'
import { useCanvasBatchDockVisibility } from '../components/useCanvasBatchDockVisibility'
import { useCanvasFitSignal } from '../components/useCanvasFitSignal'
import { useTidyCanvas } from '../components/useTidyCanvas'
import { useNodeAppearTracking } from '../components/useNodeAppearTracking'
import { useCanvasArrivalHint } from './useCanvasArrivalHint'
import { visibleInsertionPoint } from '../store/canvasVisibleArea'
import { useReactFlowViewportAnimation } from './useReactFlowViewportAnimation'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { hasPendingDirectorCameraMoveCapture, hasPendingDirectorStagingCapture } from '../components/directorCaptureHostActivation'
import CanvasToolbar from '../components/CanvasToolbar'
import { CANVAS_DRAGGING_OWNER, beginCanvasDragging, type CanvasDragLease } from '../components/canvasDraggingFlag'
import {
  BROWSER_ASSET_DRAG_MIME,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  handleCanvasStageDrop,
} from '../components/canvasStageDrop'
import {
  collectFlowPositionChanges,
  nextSelectionFromFlowChanges,
  flowViewportFromCanvas,
  canvasViewportFromFlow,
  type GenerationFlowEdge,
  toGenerationFlowNode,
  type GenerationFlowNode,
} from './generationCanvasReactFlowAdapter'
import {
  applyCanvasDragKernelPositionChanges,
  applyCanvasDragPositionChanges,
  overlayCanvasDragDraft,
} from './canvasDragDraft'
import { cancelCanvasNodeDrag, commitCanvasKeyboardPositions, endKernelNodeDrag, finishCanvasNodeDrag, isKeyboardMoveBatch, keyboardMoveScope, restoreDisownedKernelPositions } from './canvasDragWriteback'
import { GenerationCanvasReactFlowOverlays } from './GenerationCanvasReactFlowOverlays'
import { GenerationCanvasReactFlowViewport } from './GenerationCanvasReactFlowViewport'
import { useGenerationCanvasReactFlowPointer } from './useGenerationCanvasReactFlowPointer'
import { useGenerationCanvasReactFlowProjection } from './useGenerationCanvasReactFlowProjection'
import { useGenerationCanvasReactFlowMenus } from './useGenerationCanvasReactFlowMenus'
import {
  useBrowserAssetImportEffects,
  useGenerationCanvasReactFlowHostEffects,
} from './useGenerationCanvasReactFlowEffects'

const StagingCaptureHost = lazyWithChunkBoundary('i18n:generationCommon.chunk.stagingCapture', () =>
  import('../nodes/director/agent/StagingCaptureHost').then((module) => ({ default: module.StagingCaptureHost })),
)
const CameraMoveCaptureHost = lazyWithChunkBoundary('i18n:generationCommon.chunk.cameraMoveCapture', () =>
  import('../nodes/director/agent/CameraMoveCaptureHost').then((module) => ({ default: module.CameraMoveCaptureHost })),
)
type GenerationCanvasReactFlowProps = { readOnly?: boolean }

function GenerationCanvasReactFlowInner({ readOnly = false }: GenerationCanvasReactFlowProps): JSX.Element {
  const { t } = useTranslation()
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const flowStore = useStoreApi<GenerationFlowNode, GenerationFlowEdge>()
  const hostRef = React.useRef<HTMLDivElement>(null)
  const duplicateDragIdsRef = React.useRef(new Map<string, string>())
  const draggingRef = React.useRef(false)
  // 方向键挪节点的授权：按下方向键时记下那批选中节点，键抬起作废（keyboardMoveScope）。原来的「微任务后清掉」布尔
  // 在真实按键下早于 React Flow 落位置就被清掉，移动被当成外部改动撤回（2026-09-25）。
  const keyboardMoveScopeRef = React.useRef<ReadonlySet<string> | null>(null)
  const dragLeaseRef = React.useRef<CanvasDragLease | null>(null)
  const dragDraftNodesRef = React.useRef<GenerationFlowNode[]>([])
  const dragStartPositionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null)
  const [focusFlashNodeId, setFocusFlashNodeId] = React.useState<string | null>(null)
  const [stageSize, setStageSize] = React.useState({ width: 0, height: 0 })
  const [minimapVisible, setMinimapVisible] = React.useState(true)
  // #5 minimap 拖动中冻结门（纯渲染，只翻两次、不碰 RF 写入路径；冻结逻辑见 useStableCategoryNodes）。
  const [nodeDragActive, setNodeDragActive] = React.useState(false)
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  const categoryViewports = useWorkbenchStore((state) => state.categoryViewports)
  const rememberCategoryViewport = useWorkbenchStore((state) => state.rememberCategoryViewport)
  const timelineCollapsed = useWorkbenchStore((state) => state.timelinePanelCollapsed)
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const allEdges = useGenerationCanvasStore((state) => state.edges)
  const groups = useGenerationCanvasStore((state) => state.groups)
  const hasPendingStagingCapture = useGenerationCanvasStore((state) => hasPendingDirectorStagingCapture(state.nodes))
  const hasPendingCameraMoveCapture = useGenerationCanvasStore((state) => hasPendingDirectorCameraMoveCapture(state.nodes))
  const hasBatchPlanPreview = useBatchPlanPreviewStore((state) => Boolean(state.plan))
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const isReady = useGenerationCanvasStore((state) => state.isReady)
  const selectNodes = useGenerationCanvasStore((state) => state.selectNodes)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const setGroupCollapsed = useGenerationCanvasStore((state) => state.setGroupCollapsed)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingConnectionSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const moveGroupNodes = useGenerationCanvasStore((state) => state.moveGroupNodes)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const cancelConnection = useGenerationCanvasStore((state) => state.cancelConnection)
  const deleteSelectedNodes = useGenerationCanvasStore((state) => state.deleteSelectedNodes)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pasteNodes = useGenerationCanvasStore((state) => state.pasteNodes)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const redo = useGenerationCanvasStore((state) => state.redo)
  const saveSelectedAsWorkflowTemplate = useGenerationCanvasStore((state) => state.saveSelectedAsWorkflowTemplate)
  const appearingNodeIds = useNodeAppearTracking(allNodes)
  const handleSaveWorkflow = React.useCallback(() => {
    const template = saveSelectedAsWorkflowTemplate(t('generationCommon.selection.defaultWorkflowName', { count: selectedNodeIds.length })); if (!template) return
    saveWorkflowFromProject(template, withProjectAction((project) => project.binding.projectId) ?? null); toast(t('generationCommon.selection.workflowSaved', { name: template.name }), 'success')
  }, [saveSelectedAsWorkflowTemplate, selectedNodeIds.length, t])

  // #4 引用稳定过滤 + #5 minimap 拖动冻结（抽到 useStableCategoryNodes，逐字等价）。
  const { nodes, minimapNodes } = useStableCategoryNodes(allNodes, activeCategoryId, nodeDragActive)
  const visibleNodeIds = React.useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const edges = React.useMemo(
    () => allEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [allEdges, visibleNodeIds],
  )
  const visibleGroups = React.useMemo(
    () => groups.filter((group) => group.categoryId === activeCategoryId),
    [activeCategoryId, groups],
  )
  const collapsedProjection = React.useMemo(
    () => projectCollapsedGroups(
      nodes,
      edges,
      readOnly ? visibleGroups.map((group) => group.collapsed ? { ...group, collapsed: false } : group) : visibleGroups,
    ),
    [edges, nodes, readOnly, visibleGroups],
  )
  const projectedEdges = React.useMemo(
    () => collapsedProjection.visibleEdges.map((edge) => {
      const aggregate = collapsedProjection.aggregateEdges.get(edge.id)
      if (!aggregate) return edge
      return aggregate.direction === 'output'
        ? { ...edge, source: aggregate.groupId }
        : { ...edge, target: aggregate.groupId }
    }),
    [collapsedProjection],
  )
  const aggregateByEdgeId = React.useMemo(
    () => new Map(Array.from(collapsedProjection.aggregateEdges.entries()).map(([edgeId, aggregate]) => [edgeId, {
      groupId: aggregate.groupId,
      direction: aggregate.direction,
    }])),
    [collapsedProjection],
  )
  const groupBoxes = React.useMemo(
    () => getCanvasGroupBoxes(visibleGroups.filter((group) => !group.collapsed), collapsedProjection.visibleNodes),
    [collapsedProjection.visibleNodes, visibleGroups],
  )
  const frameActions = useCanvasFrameActions({ readOnly, stageRef: hostRef })
  const selectedGroupId = React.useMemo(() => resolveSelectedGroupId({
    selectedFrameId: frameActions.selectedFrameId, selectedNodeIds, groups: visibleGroups, existingNodeIds: visibleNodeIds,
  }), [frameActions.selectedFrameId, selectedNodeIds, visibleGroups, visibleNodeIds])
  const flowProjectionNodes = React.useMemo(() => projectGroupConnectionPorts({
    visibleNodes: collapsedProjection.visibleNodes,
    cards: collapsedProjection.cards,
    edgeNodeById: collapsedProjection.edgeNodeById,
    boxes: readOnly ? [] : groupBoxes,
    selectedGroupId: readOnly ? null : selectedGroupId,
  }), [collapsedProjection, groupBoxes, readOnly, selectedGroupId])
  const { selectedSet, nodeById, flowNodes, flowEdges } = useGenerationCanvasReactFlowProjection({
    nodes: flowProjectionNodes,
    edges: projectedEdges,
    edgeNodeById: collapsedProjection.edgeNodeById,
    aggregateByEdgeId,
    selectedNodeIds,
    selectedEdgeId,
    readOnly,
    appearingNodeIds,
    focusFlashNodeId,
  })
  const renderedFlowNodes = React.useMemo(() => {
    if (!draggingRef.current || dragDraftNodesRef.current.length === 0) return flowNodes
    return overlayCanvasDragDraft(flowNodes, dragDraftNodesRef.current)
  }, [flowNodes])
  const pendingConnectionSourceKind = useGenerationCanvasStore((state) => state.pendingConnectionSourceKind)
  const selectedGroupIds = React.useMemo(() => {
    return visibleGroups
      .filter((group) => {
        const memberIds = group.nodeIds.filter((nodeId) => nodeById.has(nodeId))
        return memberIds.length > 0 && memberIds.every((nodeId) => selectedSet.has(nodeId))
      })
      .map((group) => group.id)
  }, [nodeById, selectedSet, visibleGroups])
  const selectedBounds = React.useMemo(() => getSelectedBounds(nodes, selectedNodeIds), [nodes, selectedNodeIds])
  const viewport = React.useMemo(
    () => flowViewportFromCanvas(categoryViewports[activeCategoryId] || { zoom: 1, offset: { x: 0, y: 0 } }),
    [activeCategoryId, categoryViewports],
  )
  const [liveViewport, setLiveViewport] = React.useState(viewport)
  const zoomRef = React.useRef(liveViewport.zoom)
  const offsetRef = React.useRef({ x: liveViewport.x, y: liveViewport.y })
  const appliedViewportKeyRef = React.useRef(`${activeCategoryId}:${viewport.x}:${viewport.y}:${viewport.zoom}`)
  zoomRef.current = liveViewport.zoom
  offsetRef.current = { x: liveViewport.x, y: liveViewport.y }

  // 定位动画走完时记一次视口（动画中间帧 onMoveEnd 不写，见 GenerationCanvasReactFlowViewport）。
  const { animateViewportTo, cancelViewportAnimation, isViewportAnimating, healViewport } = useReactFlowViewportAnimation({
    flow, zoomRef, offsetRef,
    onAnimationSettled: (settled) => { setLiveViewport(settled); rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(settled)) },
  })

  React.useEffect(() => {
    const nextKey = `${activeCategoryId}:${viewport.x}:${viewport.y}:${viewport.zoom}`
    if (appliedViewportKeyRef.current === nextKey) return
    appliedViewportKeyRef.current = nextKey
    setLiveViewport(viewport)
    // 只在 React Flow 与 store 真不一致时才直接写入（切分类 / 外部还原）。onMoveEnd 回写 store 后这里会再收到
    // 同一份视口——那是回声不是新命令；零时长写入会打断在飞的自动让位（新建节点的横向露出就是这样被抹掉的）。
    const current = flow.getViewport()
    if (Math.abs(current.x - viewport.x) < 0.5 && Math.abs(current.y - viewport.y) < 0.5 && Math.abs(current.zoom - viewport.zoom) < 1e-3) return
    cancelViewportAnimation()
    void flow.setViewport(viewport, { duration: 0 })
  }, [activeCategoryId, cancelViewportAnimation, flow, viewport])

  const {
    canvasPanMovedRef,
    canvasPointerStartRef,
    handleCanvasPointerDown,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasWheelCapture,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
    shouldSuppressContextMenu,
  } = useGenerationCanvasReactFlowPointer({
    readOnly,
    hostRef,
    flow,
    activeCategoryId,
    rememberCategoryViewport,
    setLiveViewport,
  })
  useGenerationCanvasReactFlowHostEffects({
    activeCategoryId,
    animateViewportTo,
    cancelViewportAnimation,
    flow,
    hostRef,
    nodes,
    allNodes,
    setStageSize,
    setLiveViewport,
    setFocusFlashNodeId,
    zoomRef,
  })

  const selectCanvasFrame = frameActions.selectFrame
  const { handleGroupFramePointerDown } = useCanvasSelectionDrag({
    readOnly,
    selectedNodeCount: selectedNodeIds.length,
    zoomRef,
    captureHistory,
    commitPersistedChange,
    moveGroupNodes,
    moveSelectedNodes,
    selectNodes,
    onSelectEmptyFrame: frameActions.selectFrame,
  })
  const {
    handleGroupSelectedNodes,
    handleUngroupSelectedNodes,
    handleConnectToGroup,
    contactSheetCount,
    handleBuildContactSheet,
  } = useCanvasGroupActions({
    activeCategoryId,
    selectedGroupIds,
    selectedNodeIds,
  })

  // ── 框（Frame）这一族：画框工具 / 拖进拖出 / 框菜单与头部编辑 ──
  // 命中判定的矩形只有一个来源：内核测量值（R29 §6.1，见 canvasMeasuredNodeRect.ts）。
  // 画框（圈住了谁）和拖动（拖进了谁）**共用这一个探针**，两条入口的判定线才是同一条。
  const getMeasuredNodeRect = React.useCallback(
    (nodeId: string) => measuredRectFromInternalNode(flow.getInternalNode(nodeId)),
    [flow],
  )
  const frameTool = useCanvasFrameTool({
    readOnly,
    activeCategoryId,
    frameBoxes: groupBoxes,
    getCanvasPointFromClientPoint: (clientX, clientY) => flow.screenToFlowPosition({ x: clientX, y: clientY }),
    getNodeRect: getMeasuredNodeRect,
  })
  const frameMembership = useCanvasFrameMembership({ readOnly, frameBoxes: groupBoxes, getNodeRect: getMeasuredNodeRect })
  const renameGroup = useGenerationCanvasStore((state) => state.renameGroup)
  const setGroupDescription = useGenerationCanvasStore((state) => state.setGroupDescription)

  // 工具条新建 / 截图 / 浏览器素材落点：与 addNode 默认落点同一个 owner（store/canvasVisibleArea）。
  const getInsertionPosition = React.useCallback(() => visibleInsertionPoint(activeCategoryId) ?? { x: 240, y: 240 }, [activeCategoryId])
  // 「适应视图」框住的是**节点 ∪ 框**，不只是节点：框的标签带比成员外接盒高 52px，
  // 只按节点 fit 会把用户刚起的框名切在舞台外（裁决与理由见 model/canvasFitBounds.ts）。
  // 缩放上下限（0.2 / 3）与留白（0.12）逐字沿用 flow.fitView 那一版，这次只换了外接盒。
  const fitView = React.useCallback((animate = false) => {
    if (!nodes.length) return
    const stage = hostRef.current?.getBoundingClientRect()
    if (!stage || stage.width <= 0 || stage.height <= 0) return
    const bounds = unionCanvasFitBounds([
      getNodesBounds(flow.getNodes(), { nodeLookup: flowStore.getState().nodeLookup }),
      ...groupBoxes.map((box) => ({ x: box.left, y: box.top, width: box.width, height: box.height })),
    ])
    if (!bounds) return
    const next = getViewportForBounds(bounds, stage.width, stage.height, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM, 0.12)
    if (![next.x, next.y, next.zoom].every((value) => Number.isFinite(value))) return
    if (animate) {
      animateViewportTo(next.zoom, { x: next.x, y: next.y }, 200)
      return
    }
    // 零时长这条得先把在飞的自动让位停掉，否则下一帧它会把 fit 的结果盖回去（#503 同款）。
    cancelViewportAnimation()
    void flow.setViewport(next, { duration: 0 })
  }, [animateViewportTo, cancelViewportAnimation, flow, flowStore, groupBoxes, hostRef, nodes.length])
  const zoomTo = React.useCallback((nextZoom: number) => {
    void flow.zoomTo(nextZoom, { duration: 0 })
  }, [flow])
  const handleMinimapJump = React.useCallback((point: { x: number; y: number }) => {
    void flow.setCenter(point.x, point.y, { zoom: zoomRef.current, duration: 0 })
  }, [flow, zoomRef])
  const getCanvasPointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    return flow.screenToFlowPosition({ x: clientX, y: clientY })
  }, [flow])
  const { getPastePlacement, getStageClientPoint } = useCanvasPastePlacement(hostRef, getCanvasPointFromClientPoint)
  const {
    contextNodeMenu,
    closeContextNodeMenu,
    connectionCreateMenu,
    handleStageContextMenu,
    handleFlowContextMenu,
    handleStagePointerDownCapture,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerEnd,
    handlePendingGroupPointerUp,
    handleConnectStart,
    handleConnectEnd,
    handleConnectToGroupFromFlow,
    handleAddContextNode,
    handleImportContextFiles,
    handleNodeContextAction,
    handleAddConnectedNode,
    openAddNodeMenuAt,
  } = useGenerationCanvasReactFlowMenus({
    readOnly,
    hostRef,
    offsetRef,
    zoomRef,
    activeCategoryId,
    pendingConnectionSourceId,
    nodeById,
    visibleGroups,
    getCanvasPointFromClientPoint,
    handleConnectToGroup,
    clearSelection,
    cancelConnection,
    addNode,
    startConnection,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    deleteSelectedNodes,
    handleCanvasPointerDownCapture,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
    shouldSuppressContextMenu,
    onFrameMenu: frameActions.openFrameMenu,
    onFrameToolPointerDown: frameTool.handlePointerDown,
  })

  useCanvasFitSignal(fitView)
  // 新东西落在屏外 / 别的分类：边缘提示，点了才过去（程序不再为「露出」主动挪画布，2026-09-25）。
  const arrival = useCanvasArrivalHint({ ready: isReady, allNodes, activeCategoryId, liveViewport, stageSize, animateViewportTo })
  const { isTidying, tidy } = useTidyCanvas(activeCategoryId)
  const production = useCanvasProductionActions({ activeCategoryId, selectedNodeIds })
  const frameInteraction: CanvasFrameInteraction = React.useMemo(() => ({
    membershipPreview: frameMembership.membershipPreview,
    editingGroupId: frameActions.editingFrameId,
    onEditingChange: frameActions.setEditingFrameId,
    onRename: renameGroup,
    onDescribe: setGroupDescription,
    onOpenMenu: frameActions.openFrameMenu,
    selectedGroupId: frameActions.selectedFrameId,
  }), [
    frameActions.selectedFrameId,
    frameActions.editingFrameId,
    frameActions.openFrameMenu,
    frameActions.setEditingFrameId,
    frameMembership.membershipPreview,
    renameGroup,
    setGroupDescription,
  ])

  const batchDock = useCanvasBatchDockVisibility({
    readOnly,
    selectedCount: selectedNodeIds.length,
    eligibleIds: production.eligibleIds,
  })
  const { screenshotOverlay } = useCanvasScreenshotCapture({
    readOnly,
    getInsertPosition: getInsertionPosition,
    categoryId: activeCategoryId,
  })
  useBrowserAssetImportEffects({ activeCategoryId, getInsertionPosition, readOnly })

  const handleZoomByStep = React.useCallback((direction: -1 | 1) => {
    const current = flow.getViewport().zoom
    zoomTo(current * (direction > 0 ? 1.1 : 1 / 1.1))
  }, [flow, zoomTo])

  const handleNodesChange: OnNodesChange<GenerationFlowNode> = React.useCallback((changes) => {
    if (duplicateDragIdsRef.current.size) changes = changes.map((change) => change.type === 'position' && duplicateDragIdsRef.current.has(change.id)
      ? { ...change, id: duplicateDragIdsRef.current.get(change.id)! } : change)
    const positionChanges = collectFlowPositionChanges(changes)
    if (positionChanges.length && draggingRef.current) {
      const draftNodes = dragDraftNodesRef.current.length ? dragDraftNodesRef.current : flowNodes
      dragDraftNodesRef.current = applyCanvasDragPositionChanges(draftNodes, changes)
      applyCanvasDragKernelPositionChanges(flowStore, changes)
    } else if (positionChanges.length && !commitCanvasKeyboardPositions(positionChanges, !readOnly && isKeyboardMoveBatch(positionChanges, keyboardMoveScopeRef.current))) {
      restoreDisownedKernelPositions(flowStore, positionChanges)
    }

    const nextSelection = nextSelectionFromFlowChanges(changes, useGenerationCanvasStore.getState().selectedNodeIds)
    if (nextSelection) selectNodes(nextSelection)
  }, [flowNodes, flowStore, readOnly, selectNodes])

  // React Flow's selection store is internal while the persisted selection lives
  // in Zustand. Syncing on every internal selection notification causes a
  // feedback loop when controlled node props are replaced after insertion.
  // Clicks are handled explicitly above; marquee selection is committed once at
  // the end of the gesture.
  const handleSelectionEnd = React.useCallback(() => {
    if (readOnly) return
    selectNodes(flow.getNodes().filter((node) => node.selected).map((node) => node.id))
  }, [flow, readOnly, selectNodes])

  const handleEdgeClick = React.useCallback((_event: React.MouseEvent, edge: GenerationFlowEdge) => {
    if (readOnly) return
    setSelectedEdgeId(edge.id)
  }, [readOnly])

  const handleEdgesDelete: OnEdgesDelete<GenerationFlowEdge> = React.useCallback((deletedEdges) => {
    if (readOnly) return
    for (const edge of deletedEdges) disconnectEdge(edge.id)
    setSelectedEdgeId(null)
  }, [disconnectEdge, readOnly])

  const deleteActiveEdge = React.useCallback(() => {
    if (readOnly || !selectedEdgeId) return
    disconnectEdge(selectedEdgeId)
    setSelectedEdgeId(null)
  }, [disconnectEdge, readOnly, selectedEdgeId])

  // 收尾住 canvasDragWriteback（与正常松手同一个家）：这个壳只负责把自己的 ref 递过去。
  const cancelNodeDrag = React.useCallback(() => cancelCanvasNodeDrag({
    dragLeaseRef, draggingRef, dragStartPositionsRef, dragDraftNodesRef, duplicateDragIdsRef,
    setNodeDragActive, cancelFramePreview: frameMembership.cancelPreview, flowStore,
    restoreFlowNodes: () => flowStore.getState().setNodes(flowNodes),
  }), [flowNodes, flowStore, frameMembership])
  const cancelNodeDragRef = React.useRef(cancelNodeDrag)
  cancelNodeDragRef.current = cancelNodeDrag
  React.useEffect(() => () => cancelNodeDragRef.current(), [activeCategoryId, readOnly])
  React.useEffect(() => {
    if (draggingRef.current && [...dragStartPositionsRef.current.keys()].some(id => !allNodes.some(node => node.id === id))) cancelNodeDragRef.current()
  }, [allNodes])

  const handleNodeDragStart: OnNodeDrag<GenerationFlowNode> = React.useCallback((event, draggedNode) => {
    if (readOnly) return
    draggingRef.current = true
    setNodeDragActive(true) // #5：冻结 minimap（纯渲染门，不碰写入路径）
    dragDraftNodesRef.current = flowNodes
    flowStore.setState({ hasDefaultNodes: false })
    dragLeaseRef.current?.release()
    // 取消：先还原位置再结束内核拖动（否则回来时节点仍跟着光标）；松手丢了：当作在最后位置松手，走正常收尾。
    dragLeaseRef.current = beginCanvasDragging(hostRef.current, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel: (lastPoint) => { cancelNodeDragRef.current(); endKernelNodeDrag(lastPoint) }, onReleaseLost: endKernelNodeDrag, ...('pointerId' in event && typeof event.pointerId === 'number' ? { pointerId: event.pointerId } : {}) })
    const originalIds = selectedSet.has(draggedNode.id) ? selectedNodeIds : [draggedNode.id]
    duplicateDragIdsRef.current = 'altKey' in event && event.altKey
      ? useGenerationCanvasStore.getState().duplicateNodesForDrag(originalIds) : new Map()
    if (!duplicateDragIdsRef.current.size) captureHistory()
    const state = useGenerationCanvasStore.getState()
    const draggedIds = originalIds.map((id) => duplicateDragIdsRef.current.get(id) ?? id)
    if (duplicateDragIdsRef.current.size) {
      // Keep the existing collapsed-group projection. RF retains the original drag
      // identities for this gesture; only its position changes are mapped to copies.
      dragDraftNodesRef.current = [
        ...flowNodes.map((node) => node.selected ? { ...node, selected: false, data: { ...node.data, primarySelection: false } } : node),
        ...state.nodes.filter((node) => draggedIds.includes(node.id))
          .map((node) => toGenerationFlowNode(node, true, false, draggedIds.length === 1)),
      ]
      flowStore.getState().setNodes(dragDraftNodesRef.current)
    }
    dragStartPositionsRef.current = new Map(
      draggedIds.flatMap((nodeId) => {
        const node = state.nodes.find((candidate) => candidate.id === nodeId)
        return node ? [[nodeId, { ...node.position }] as const] : []
      }),
    )
  }, [captureHistory, flowNodes, flowStore, readOnly, selectedNodeIds, selectedSet])

  // 拖动中算「松手会发生什么」——进框/出框的反馈就在这里产生（只写本地预览，不碰 store）。
  const handleNodeDrag: OnNodeDrag<GenerationFlowNode> = React.useCallback((_event, draggedNode, draggedNodes) => {
    if (readOnly || !draggingRef.current) return
    frameMembership.handleNodeDrag((draggedNodes.length ? draggedNodes : [draggedNode])
      .map((node) => ({ ...node, id: duplicateDragIdsRef.current.get(node.id) ?? node.id })))
  }, [frameMembership, readOnly])

  const handleNodeDragStop: OnNodeDrag<GenerationFlowNode> = React.useCallback((event, draggedNode, draggedNodes) => {
    if (readOnly || !draggingRef.current) {
      cancelNodeDrag()
      return
    }
    finishCanvasNodeDrag({
      event,
      draggedNode: { ...draggedNode, id: duplicateDragIdsRef.current.get(draggedNode.id) ?? draggedNode.id },
      draggedNodes: draggedNodes.map((node) => ({ ...node, id: duplicateDragIdsRef.current.get(node.id) ?? node.id })),
      readOnly, t, draggingRef, dragStartPositionsRef, dragDraftNodesRef, moveNode, commitPersistedChange,
      dragLeaseRef, duplicateDragIdsRef, setNodeDragActive, commitFrameMembership: frameMembership.commitMembership, flowStore,
    })
  }, [cancelNodeDrag, commitPersistedChange, flowStore, frameMembership, moveNode, readOnly, t])

  const handleConnect = React.useCallback((connection: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
    if (readOnly || !connection.source || !connection.target) return
    if (connection.source === connection.target) { cancelConnection(); return } // 编组端口拖回自己的收线口
    const side = connection.sourceHandle === 'source-left' ? 'left' : 'right'
    // 松手时重新起一次线不是多余的：按下把手那一刻若有菜单开着，同一次 pointerdown 会让菜单关闭并清掉待连态。
    // 所以按连线的**起点是谁**重起，而不是看待连态——编组的「+」（端口节点 id = 编组 id）重起编组线。
    const state = useGenerationCanvasStore.getState()
    const isGroup = (id: string) => state.groups.some((group) => group.id === id)
    if (isGroup(connection.source)) state.startGroupConnection(connection.source, side)
    else startConnection(connection.source, side)
    // 落在折叠编组的收线把手上（端口节点 id = 编组 id）= 连进这个编组，不是连一张叫这个 id 的卡。
    if (isGroup(connection.target)) handleConnectToGroupFromFlow(connection.target)
    else completeNodeConnection(connection.target)
  }, [cancelConnection, handleConnectToGroupFromFlow, readOnly, startConnection])

  const handlePaneClick = React.useCallback(() => {
    if (readOnly || canvasPanMovedRef.current) return
    clearSelection()
    selectCanvasFrame(null)
  }, [canvasPanMovedRef, clearSelection, readOnly, selectCanvasFrame])

  // ⌘D：副本落在屏外时由边缘提示指路，不再替用户挪画布（2026-09-25）。
  const duplicateSelectedNodes = React.useCallback(() => { useGenerationCanvasStore.getState().duplicateSelectedNodes() }, [])
  const handleTidy = React.useCallback(() => tidy(stageSize.width / Math.max(1, stageSize.height)), [stageSize, tidy])
  // Tab 新建：与 Cmd+V 同一个落点判据（鼠标在舞台里 → 那一点；否则舞台中央）。
  const openAddNodeMenu = React.useCallback(() => {
    const point = getStageClientPoint()
    if (point) openAddNodeMenuAt(point.x, point.y)
  }, [getStageClientPoint, openAddNodeMenuAt])

  useCanvasShortcuts({
    readOnly,
    stageRef: hostRef,
    selectedNodeCount: selectedNodeIds.length,
    selectedGroupCount: selectedGroupIds.length,
    activeCategoryId,
    setActiveEdge: () => setSelectedEdgeId(null),
    deleteActiveEdge,
    deleteActiveFrame: frameActions.deleteSelectedFrame,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    ungroupSelectedNodes: handleUngroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePlacement,
    zoomByStep: handleZoomByStep,
    undo,
    redo,
    duplicateSelectedNodes,
    connectSelectedNodes: connectSelectedCanvasNodes,
    generateSelectedNodes: production.generate,
    openAddNodeMenu,
    tidyCanvas: handleTidy,
  })

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) return
    const droppableTypes = ['Files', WORKSPACE_FILE_DRAG_MIME, ASSET_LIBRARY_DRAG_MIME, BROWSER_ASSET_DRAG_MIME, LEGACY_BROWSER_ASSET_DRAG_MIME, CANVAS_RESULT_DRAG_MIME]
    if (droppableTypes.some((type) => event.dataTransfer.types.includes(type))) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [readOnly])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    handleCanvasStageDrop(event, {
      readOnly,
      toCanvasPoint: getCanvasPointFromClientPoint,
      activeCategoryId,
    })
  }, [activeCategoryId, getCanvasPointFromClientPoint, readOnly])

  return (
    <section
      ref={hostRef}
      className={cn('generation-canvas-react-flow', 'generation-canvas-v2__stage', 'group/canvas', 'relative w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink')}
      aria-label={t('generationCommon.canvas.aria')}
      data-shortcut-surface="canvas"
      data-ready={isReady ? 'true' : undefined}
      data-tidying={isTidying ? 'true' : undefined}
      data-nomi-generation-canvas-import-target={!readOnly ? 'true' : undefined}
      // 微任务跑在这一轮派发之后、下一帧之前：React Flow 的键盘移动就在这一轮里发 position change。
      onKeyDownCapture={(event) => { keyboardMoveScopeRef.current = keyboardMoveScope(event, useGenerationCanvasStore.getState().selectedNodeIds) }}
      onKeyUpCapture={() => { keyboardMoveScopeRef.current = null }}
      onPointerDownCapture={handleStagePointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onWheelCapture={handleCanvasWheelCapture}
      onPointerUpCapture={handlePendingGroupPointerUp}
      onMouseUpCapture={handlePendingGroupPointerUp}
      onPointerDown={handleStagePointerDown}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerEnd}
      onPointerCancel={handleCanvasPointerEnd}
      onContextMenu={handleStageContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {hasPendingStagingCapture || hasPendingCameraMoveCapture ? (
        <React.Suspense fallback={null}>
          {hasPendingStagingCapture ? <StagingCaptureHost /> : null}
          {hasPendingCameraMoveCapture ? <CameraMoveCaptureHost /> : null}
        </React.Suspense>
      ) : null}
      {!readOnly ? <CanvasToolbar getInsertionPosition={getInsertionPosition} categoryId={activeCategoryId} /> : null}
      <GenerationCanvasReactFlowViewport
        flowNodes={renderedFlowNodes}
        isNodeDragging={nodeDragActive}
        flowEdges={flowEdges}
        viewport={liveViewport}
        stageSize={stageSize}
        readOnly={readOnly}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onSelectionEnd={handleSelectionEnd}
        onEdgeClick={handleEdgeClick}
        onEdgesDelete={handleEdgesDelete}
        onNodeContextMenu={handleFlowContextMenu}
        onPaneContextMenu={handleFlowContextMenu}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        canvasPointerStartRef={canvasPointerStartRef}
        canvasPanMovedRef={canvasPanMovedRef}
        hostRef={hostRef}
        setLiveViewport={setLiveViewport}
        activeCategoryId={activeCategoryId}
        rememberCategoryViewport={rememberCategoryViewport}
        healViewport={healViewport}
        isViewportAnimating={isViewportAnimating}
        cancelViewportAnimation={cancelViewportAnimation}
        groupBoxes={groupBoxes}
        frame={frameInteraction}
        frameDrawPreview={frameTool.drawPreview}
        frameToolArmed={frameTool.armed}
        collapsedGroupCards={collapsedProjection.cards}
        onGroupFramePointerDown={handleGroupFramePointerDown}
        pendingConnection={Boolean(pendingConnectionSourceId)}
        pendingConnectionSourceKind={pendingConnectionSourceKind}
        pendingConnectionSide={pendingConnectionSourceSide}
        onConnectToGroup={handleConnectToGroupFromFlow}
        onSetGroupCollapsed={setGroupCollapsed}
        selectedBounds={selectedBounds}
        selectedNodeIds={selectedNodeIds}
        selectedGroupIds={selectedGroupIds}
        production={production}
        contactSheetCount={contactSheetCount}
        onGroupSelectedNodes={handleGroupSelectedNodes}
        onUngroupSelectedNodes={handleUngroupSelectedNodes}
        onBuildContactSheet={handleBuildContactSheet}
        onSaveWorkflow={handleSaveWorkflow}
        onClearSelection={clearSelection}
      />
      <GenerationCanvasReactFlowOverlays
        readOnly={readOnly}
        activeCategoryId={activeCategoryId}
        // #5：overlays 里唯一逐帧敏感的消费者是 minimap；empty-state 只看 length（拖动中不变）。
        // 拖动期传冻结引用 → minimap 不重画；空态判定不受影响（成员与 length 一致）。
        nodes={minimapNodes}
        allNodes={allNodes}
        selectedNodeIds={selectedNodeIds}
        selectedSet={selectedSet}
        screenshotOverlay={screenshotOverlay}
        contextNodeMenu={contextNodeMenu}
        connectionCreateMenu={connectionCreateMenu}
        onCreateEmpty={() => useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: activeCategoryId, select: true })}
        onNodeContextAction={handleNodeContextAction}
        onCloseContextNodeMenu={closeContextNodeMenu}
        onAddContextNode={handleAddContextNode}
        onImportContextFiles={handleImportContextFiles}
        onAddConnectedNode={handleAddConnectedNode}
        batchDock={batchDock}
        production={production}
        timelineCollapsed={timelineCollapsed}
        hasBatchPlanPreview={hasBatchPlanPreview}
        zoom={liveViewport.zoom}
        zoomPercent={Math.round(liveViewport.zoom * 100)}
        offset={{ x: liveViewport.x, y: liveViewport.y }}
        stageSize={stageSize}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
        onJumpToCanvasPoint={handleMinimapJump}
        onFitView={() => fitView(true)}
        // 「重置视图」走我们自己的调度器，不走 React Flow 的 d3 过渡：紧接着「适应视图」点它时，
        // fit 那 200ms 的 rAF 动画还在逐帧写视口，d3 过渡每一帧都被盖回去——滑块停在 fit 的 59% 而不是 100%
        // （2026-09-18 金路径真机；与 fitView 零时长那条「先停掉在飞的动画」是同一类，#503 同款）。
        onResetView={() => { cancelViewportAnimation(); animateViewportTo(1, { x: 0, y: 0 }, 200) }}
        onTidy={handleTidy}
        onZoomTo={zoomTo}
        frameMenu={frameActions.frameMenu}
        onFrameMenuAction={frameActions.handleFrameMenuAction}
        frameToolArmed={frameTool.armed}
        onToggleFrameTool={frameTool.toggle}
        arrivalHint={arrival.hint}
        onGoToArrivals={arrival.goToArrivals}
      />
    </section>
  )
}

export default function GenerationCanvasReactFlow(props: GenerationCanvasReactFlowProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <GenerationCanvasReactFlowInner {...props} />
    </ReactFlowProvider>
  )
}
