import React from 'react'
import {
  ReactFlowProvider,
  useStoreApi,
  useReactFlow,
  type OnNodeDrag,
  type OnEdgesDelete,
  type OnConnectStart,
  type OnConnectEnd,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './generationCanvasReactFlow.css'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { saveWorkflowFromCurrentProject } from '../../library/workflowLibrary'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import { useWorkbenchStore } from '../../workbenchStore'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useStableCategoryNodes } from './useStableCategoryNodes'
import { getCanvasGroupBoxes, getSelectedBounds } from '../components/generationCanvasGeometry'
import { useCollapsedGroupConnectionSource } from '../components/useCollapsedGroupConnectionSource'
import { projectCollapsedGroups } from '../model/canvasCardStackModel'
import { useCanvasSelectionDrag } from '../components/useCanvasSelectionDrag'
import { useCanvasGroupActions } from '../components/useCanvasGroupActions'
import { useCanvasShortcuts } from '../components/useCanvasShortcuts'
import { useCanvasScreenshotCapture } from '../components/useCanvasScreenshotCapture'
import { useCanvasProductionActions } from '../components/useCanvasProductionActions'
import { useCanvasBatchDockVisibility } from '../components/useCanvasBatchDockVisibility'
import { useCanvasFitSignal } from '../components/useCanvasFitSignal'
import { useTidyCanvas } from '../components/useTidyCanvas'
import { useNodeAppearTracking } from '../components/useNodeAppearTracking'
import { useAutoFitOnLoad } from '../components/useAutoFitOnLoad'
import { useComposerVisibilityPan } from '../components/useComposerVisibilityPan'
import { useCreatedNodeVisibilityPan } from '../components/useCreatedNodeVisibilityPan'
import { useReactFlowViewportAnimation } from './useReactFlowViewportAnimation'
import { useCanvasContextNodeMenu } from '../components/useCanvasContextNodeMenu'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { buildCanvasMenuActions } from '../components/useCanvasMenuActions'
import { hasPendingScene3DCameraMoveCapture, hasPendingScene3DStagingCapture } from '../components/scene3dCaptureHostActivation'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import CanvasToolbar from '../components/CanvasToolbar'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from '../components/canvasDraggingFlag'
import {
  BROWSER_ASSET_DRAG_MIME,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  handleCanvasStageDrop,
} from '../components/canvasStageDrop'
import {
  collectFlowPositionChanges,
  collectFlowSelectionChanges,
  flowViewportFromCanvas,
  type GenerationFlowEdge,
  type GenerationFlowNode,
} from './generationCanvasReactFlowAdapter'
import {
  applyCanvasDragKernelPositionChanges,
  applyCanvasDragPositionChanges,
  overlayCanvasDragDraft,
  restoreCanvasDragKernelOwnership,
} from './canvasDragDraft'
import { commitCanvasNodeDragStop } from './canvasDragWriteback'
import { GenerationCanvasReactFlowOverlays } from './GenerationCanvasReactFlowOverlays'
import { GenerationCanvasReactFlowViewport } from './GenerationCanvasReactFlowViewport'
import { useGenerationCanvasReactFlowPointer } from './useGenerationCanvasReactFlowPointer'
import { useGenerationCanvasReactFlowProjection } from './useGenerationCanvasReactFlowProjection'
import { resolveCanvasDropTargetFromDom } from './canvasConnectionDropTarget'
import {
  useBrowserAssetImportEffects,
  useGenerationCanvasReactFlowHostEffects,
} from './useGenerationCanvasReactFlowEffects'

const StagingCaptureHost = lazyWithChunkBoundary('3D 站位捕获', () =>
  import('../nodes/scene3d/StagingCaptureHost').then((module) => ({ default: module.StagingCaptureHost })),
)
const CameraMoveCaptureHost = lazyWithChunkBoundary('3D 运镜捕获', () =>
  import('../nodes/scene3d/CameraMoveCaptureHost').then((module) => ({ default: module.CameraMoveCaptureHost })),
)
type GenerationCanvasReactFlowProps = { readOnly?: boolean }

function GenerationCanvasReactFlowInner({ readOnly = false }: GenerationCanvasReactFlowProps): JSX.Element {
  const { t } = useTranslation()
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const flowStore = useStoreApi<GenerationFlowNode, GenerationFlowEdge>()
  const hostRef = React.useRef<HTMLDivElement>(null)
  const draggingRef = React.useRef(false)
  const dragDraftNodesRef = React.useRef<GenerationFlowNode[]>([])
  const dragStartPositionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
  const connectionStartRef = React.useRef<{ nodeId: string; side: 'left' | 'right' } | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null)
  const [focusFlashNodeId, setFocusFlashNodeId] = React.useState<string | null>(null)
  const [stageSize, setStageSize] = React.useState({ width: 0, height: 0 })
  const [minimapVisible, setMinimapVisible] = React.useState(true)
  // #5 minimap 拖动中冻结门（纯渲染，只翻两次、不碰 RF 写入路径；冻结逻辑见 useStableCategoryNodes）。
  const [nodeDragActive, setNodeDragActive] = React.useState(false)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<{
    sourceNodeId: string
    sourceSide: 'left' | 'right'
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  const categoryViewports = useWorkbenchStore((state) => state.categoryViewports)
  const rememberCategoryViewport = useWorkbenchStore((state) => state.rememberCategoryViewport)
  const timelineCollapsed = useWorkbenchStore((state) => state.timelinePanelCollapsed)
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const allEdges = useGenerationCanvasStore((state) => state.edges)
  const groups = useGenerationCanvasStore((state) => state.groups)
  const hasPendingStagingCapture = useGenerationCanvasStore((state) => hasPendingScene3DStagingCapture(state.nodes))
  const hasPendingCameraMoveCapture = useGenerationCanvasStore((state) => hasPendingScene3DCameraMoveCapture(state.nodes))
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
  const connectToNode = useGenerationCanvasStore((state) => state.connectToNode)
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
    saveWorkflowFromCurrentProject(template); toast(t('generationCommon.selection.workflowSaved', { name: template.name }), 'success')
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
  const flowProjectionNodes = React.useMemo(() => {
    if (collapsedProjection.cards.length === 0) return collapsedProjection.visibleNodes
    const proxyNodes = collapsedProjection.cards.flatMap((card) => {
      const proxy = collapsedProjection.edgeNodeById.get(card.groupId)
      if (!proxy) return []
      return [{
        ...proxy,
        meta: { ...(proxy.meta || {}), collapsedGroupProxy: true },
      }]
    })
    return [...collapsedProjection.visibleNodes, ...proxyNodes]
  }, [collapsedProjection])
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
  const groupBoxes = React.useMemo(
    () => getCanvasGroupBoxes(visibleGroups.filter((group) => !group.collapsed), collapsedProjection.visibleNodes),
    [collapsedProjection.visibleNodes, visibleGroups],
  )
  const collapsedGroupConnection = useCollapsedGroupConnectionSource(readOnly)
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

  const {
    animateViewportTo,
    readViewportTarget,
    readLastAutoTarget,
    cancelViewportAnimation,
    healViewport,
  } = useReactFlowViewportAnimation({ flow, zoomRef, offsetRef })

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
  const ensureContextNodeSelected = React.useCallback((nodeId: string) => {
    const state = useGenerationCanvasStore.getState()
    if (!state.selectedNodeIds.includes(nodeId)) state.selectNode(nodeId)
  }, [])
  const {
    contextNodeMenu,
    setContextNodeMenu,
    prepareContextMenuPointerDown,
    handleContextMenuPointerMove,
    finishContextMenuPointerUp,
    handleStageContextMenu,
  } = useCanvasContextNodeMenu({
    readOnly,
    stageRef: hostRef,
    offsetRef,
    zoomRef,
    pendingConnectionSourceId,
    clearSelection,
    ensureNodeSelected: ensureContextNodeSelected,
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

  const { handleGroupFramePointerDown } = useCanvasSelectionDrag({
    readOnly,
    selectedNodeCount: selectedNodeIds.length,
    zoomRef,
    captureHistory,
    commitPersistedChange,
    moveGroupNodes,
    moveSelectedNodes,
    selectNodes,
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
  const handleConnectToGroupFromFlow = React.useCallback((groupId: string) => {
    const state = useGenerationCanvasStore.getState()
    if (state.pendingConnectionSourceKind === 'group') {
      state.connectToNode(groupId)
    } else {
      handleConnectToGroup(groupId)
    }
    setConnectionCreateMenu(null)
  }, [handleConnectToGroup])

  const getInsertionPosition = React.useCallback(() => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return { x: 240, y: 240 }
    return flow.screenToFlowPosition({ x: rect.left + rect.width * 0.38, y: rect.top + rect.height * 0.28 })
  }, [flow])
  const fitView = React.useCallback((animate = false) => {
    if (!nodes.length) return
    void flow.fitView({ padding: 0.12, duration: animate ? 200 : 0, minZoom: 0.2, maxZoom: 3 })
  }, [flow, nodes.length])
  const zoomTo = React.useCallback((nextZoom: number) => {
    void flow.zoomTo(Math.min(3, Math.max(0.2, nextZoom)), { duration: 120 })
  }, [flow])
  const handleMinimapJump = React.useCallback((point: { x: number; y: number }) => {
    void flow.setCenter(point.x, point.y, { zoom: zoomRef.current, duration: 0 })
  }, [flow, zoomRef])
  const getCanvasPointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    return flow.screenToFlowPosition({ x: clientX, y: clientY })
  }, [flow])

  useAutoFitOnLoad({
    nodes,
    selectedNodeIds,
    activeCategoryId,
    categoryViewports,
    fitView,
    stageRef: hostRef,
    zoomRef,
    offsetRef,
  })
  useCanvasFitSignal(fitView)
  // 「让位平移」：节点上下都塞不下 composer 时，useComposerViewportPlacement 会派
  // ENSURE_COMPOSER_VISIBLE 事件请求把画布推开一点（见 docs/plan/2026-08-26-win32-composer-collapse.md §4.1）。
  // 本次 React Flow 迁移掏空旧 GenerationCanvas 时，把它的监听（origin/main 该文件 :235）一并删了，
  // 事件从此无人接收 → 画布不再让位 → composer 只能溢出 stage（j5 composer-usable-at-min-window
  // 因此确定性变红：spaceAbove 140 / spaceBelow 132 都 < 150，卡片仍按 150 渲染，捅出底边 32px）。
  // 复用原 hook 而不是在这里另写一份监听：事件契约、delta 校验和 onSettled 回执它都已经处理好（P1）。
  useComposerVisibilityPan({ animateViewportTo, offsetRef, readViewportTarget })
  // 「新建即可见」：避让把新卡推出视口时最小平移露出它（见 useCreatedNodeVisibilityPan 的头注释）。
  useCreatedNodeVisibilityPan({ nodes, animateViewportTo, readViewportTarget, readLastAutoTarget, stageRef: hostRef })
  const { isTidying, tidy } = useTidyCanvas(activeCategoryId)
  const production = useCanvasProductionActions({ activeCategoryId, selectedNodeIds })
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

  const handleFlowContextMenu = React.useCallback((event: MouseEvent | React.MouseEvent) => {
    handleStageContextMenu(event as React.MouseEvent<HTMLDivElement>)
  }, [handleStageContextMenu])

  const handleStagePointerDownCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (prepareContextMenuPointerDown(event)) {
      event.stopPropagation()
      return
    }
    handleCanvasPointerDownCapture(event)
  }, [handleCanvasPointerDownCapture, prepareContextMenuPointerDown])

  const handleStagePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handleContextMenuPointerMove(event)
    handleCanvasPointerMove(event)
  }, [handleCanvasPointerMove, handleContextMenuPointerMove])

  const handleStagePointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const suppressContextMenu = event.button === 2 && shouldSuppressContextMenu()
    handleCanvasPointerEnd()
    finishContextMenuPointerUp(event, suppressContextMenu)
  }, [finishContextMenuPointerUp, handleCanvasPointerEnd, shouldSuppressContextMenu])

  React.useEffect(() => {
    if (!contextNodeMenu && !connectionCreateMenu) return undefined
    const closeMenus = () => {
      setContextNodeMenu(null)
      setConnectionCreateMenu(null)
      cancelConnection()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }
    window.addEventListener('pointerdown', closeMenus)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeMenus)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [cancelConnection, connectionCreateMenu, contextNodeMenu, setContextNodeMenu])

  React.useEffect(() => {
    if (connectionCreateMenu && !pendingConnectionSourceId) setConnectionCreateMenu(null)
  }, [connectionCreateMenu, pendingConnectionSourceId])

  const { handleAddContextNode, handleNodeContextAction, handleAddConnectedNode } = buildCanvasMenuActions({
    activeCategoryId,
    contextNodeMenu,
    setContextNodeMenu,
    connectionCreateMenu,
    setConnectionCreateMenu,
    addNode,
    startConnection,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    deleteSelectedNodes,
  })

  const handleNodesChange: OnNodesChange<GenerationFlowNode> = React.useCallback((changes) => {
    const positionChanges = collectFlowPositionChanges(changes)
    if (positionChanges.length) {
      const draftNodes = dragDraftNodesRef.current.length ? dragDraftNodesRef.current : flowNodes
      dragDraftNodesRef.current = applyCanvasDragPositionChanges(draftNodes, changes)
      applyCanvasDragKernelPositionChanges(flowStore, changes)
    }

    const selectionChanges = collectFlowSelectionChanges(changes)
    if (selectionChanges.length === 0) return
    const selected = new Set(useGenerationCanvasStore.getState().selectedNodeIds)
    for (const change of selectionChanges) {
      if (change.selected) selected.add(change.nodeId)
      else selected.delete(change.nodeId)
    }
    const nextSelection = [...selected]
    const currentSelection = useGenerationCanvasStore.getState().selectedNodeIds
    if (
      nextSelection.length === currentSelection.length &&
      nextSelection.every((nodeId, index) => nodeId === currentSelection[index])
    ) return
    selectNodes(nextSelection)
  }, [flowNodes, flowStore, selectNodes])

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

  const handleNodeDragStart: OnNodeDrag<GenerationFlowNode> = React.useCallback((_event, draggedNode) => {
    if (readOnly) return
    draggingRef.current = true
    setNodeDragActive(true) // #5：冻结 minimap（纯渲染门，不碰写入路径）
    dragDraftNodesRef.current = flowNodes
    flowStore.setState({ hasDefaultNodes: false })
    setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowNode)
    captureHistory()
    const state = useGenerationCanvasStore.getState()
    const draggedIds = selectedSet.has(draggedNode.id) ? selectedNodeIds : [draggedNode.id]
    dragStartPositionsRef.current = new Map(
      draggedIds.flatMap((nodeId) => {
        const node = state.nodes.find((candidate) => candidate.id === nodeId)
        return node ? [[nodeId, { ...node.position }] as const] : []
      }),
    )
  }, [captureHistory, flowNodes, flowStore, readOnly, selectedNodeIds, selectedSet])

  const handleNodeDragStop: OnNodeDrag<GenerationFlowNode> = React.useCallback((event, draggedNode, draggedNodes) => {
    if (readOnly || !draggingRef.current) return
    setNodeDragActive(false) // #5：解冻 minimap（在所有退出路径之前，含时间轴投放早退；draggingRef 由 writeback 清）
    commitCanvasNodeDragStop({
      event,
      draggedNode,
      draggedNodes,
      readOnly,
      t,
      hostRef,
      draggingRef,
      dragStartPositionsRef,
      dragDraftNodesRef,
      moveNode,
      commitPersistedChange,
    })
    // 还原拖动内核关掉的 hasDefaultNodes，恢复 RF 对选择/投影变更的自应用（机制见 helper JSDoc）。
    restoreCanvasDragKernelOwnership(flowStore)
  }, [commitPersistedChange, flowStore, moveNode, readOnly, t])

  const handleConnect = React.useCallback((connection: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
    if (readOnly || !connection.source || !connection.target) return
    const side = connection.sourceHandle === 'source-left' ? 'left' : 'right'
    startConnection(connection.source, side)
    connectToNode(connection.target)
  }, [connectToNode, readOnly, startConnection])

  const handleConnectStart: OnConnectStart = React.useCallback((_event, params) => {
    if (readOnly || !params.nodeId || params.handleType !== 'source') return
    const side = params.handleId?.endsWith('-left') ? 'left' : 'right'
    connectionStartRef.current = { nodeId: params.nodeId, side }
    startConnection(params.nodeId, side)
  }, [readOnly, startConnection])

  const handleConnectEnd: OnConnectEnd = React.useCallback((event, connectionState) => {
    const started = connectionStartRef.current
    connectionStartRef.current = null
    if (readOnly || !started || (connectionState.isValid && connectionState.toNode)) return
    const sourceNode = nodeById.get(started.nodeId)
    const canCreateMedia = sourceNode?.kind === 'text' || sourceNode?.kind === 'image' || Boolean(sourceNode && isImageLikeGenerationNodeKind(sourceNode.kind))
    if (!canCreateMedia) {
      cancelConnection()
      return
    }
    const point = 'changedTouches' in event
      ? event.changedTouches[0]
      : event
    if (!point) {
      cancelConnection()
      return
    }
    const targetNodeId = resolveCanvasDropTargetFromDom({ clientX: point.clientX, clientY: point.clientY }, started.nodeId, hostRef.current, '.generation-canvas-v2-node[data-node-id]', 'data-node-id', new Set(nodeById.keys()))
    if (targetNodeId) {
      completeNodeConnection(targetNodeId)
      return
    }
    const targetGroupId = resolveCanvasDropTargetFromDom({ clientX: point.clientX, clientY: point.clientY }, '', hostRef.current, '[data-group-id]', 'data-group-id', new Set(visibleGroups.map((group) => group.id)))
    if (targetGroupId) {
      handleConnectToGroup(targetGroupId)
      return
    }
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) {
      cancelConnection()
      return
    }
    const stageX = point.clientX - rect.left
    const stageY = point.clientY - rect.top
    const canvasPoint = getCanvasPointFromClientPoint(point.clientX, point.clientY)
    setConnectionCreateMenu({
      sourceNodeId: started.nodeId,
      sourceSide: started.side,
      stageX: Math.max(8, Math.min(rect.width - 140, stageX)),
      stageY: Math.max(8, Math.min(rect.height - 90, stageY)),
      canvasX: Math.round(canvasPoint.x),
      canvasY: Math.round(canvasPoint.y),
    })
  }, [cancelConnection, getCanvasPointFromClientPoint, handleConnectToGroup, nodeById, readOnly, visibleGroups])

  const handlePendingGroupPointerUp = React.useCallback((event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | PointerEvent | MouseEvent) => {
    if (readOnly || !pendingConnectionSourceId) return
    const groupId = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>('[data-group-id]')?.dataset.groupId || null)
      .find((candidate): candidate is string => Boolean(candidate && visibleGroups.some((group) => group.id === candidate)))
    if (!groupId) return
    event.preventDefault()
    event.stopPropagation()
    connectionStartRef.current = null
    handleConnectToGroup(groupId)
  }, [handleConnectToGroup, pendingConnectionSourceId, readOnly, visibleGroups])

  React.useEffect(() => {
    const handleNativePointerUp = (event: PointerEvent) => handlePendingGroupPointerUp(event)
    const handleNativeMouseUp = (event: MouseEvent) => handlePendingGroupPointerUp(event)
    window.addEventListener('pointerup', handleNativePointerUp)
    window.addEventListener('mouseup', handleNativeMouseUp)
    return () => {
      window.removeEventListener('pointerup', handleNativePointerUp)
      window.removeEventListener('mouseup', handleNativeMouseUp)
    }
  }, [handlePendingGroupPointerUp])

  const handlePaneClick = React.useCallback(() => {
    if (!readOnly && !canvasPanMovedRef.current) clearSelection()
  }, [canvasPanMovedRef, clearSelection, readOnly])

  useCanvasShortcuts({
    readOnly,
    stageRef: hostRef,
    selectedNodeCount: selectedNodeIds.length,
    selectedGroupCount: selectedGroupIds.length,
    activeCategoryId,
    setActiveEdge: () => setSelectedEdgeId(null),
    deleteActiveEdge,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    ungroupSelectedNodes: handleUngroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePosition: getInsertionPosition,
    zoomByStep: handleZoomByStep,
    undo,
    redo,
  })

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) return
    const droppableTypes = ['Files', WORKSPACE_FILE_DRAG_MIME, ASSET_LIBRARY_DRAG_MIME, BROWSER_ASSET_DRAG_MIME, LEGACY_BROWSER_ASSET_DRAG_MIME]
    if (droppableTypes.some((type) => event.dataTransfer.types.includes(type))) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [readOnly])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const currentViewport = flow.getViewport()
    handleCanvasStageDrop(event, {
      readOnly,
      activeProjectId: getActiveWorkbenchProjectId(),
      offset: { x: currentViewport.x, y: currentViewport.y },
      zoom: currentViewport.zoom,
      activeCategoryId,
    })
  }, [activeCategoryId, flow, readOnly])

  return (
    <section
      ref={hostRef}
      className={cn('generation-canvas-react-flow', 'generation-canvas-v2__stage', 'group/canvas', 'relative w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink')}
      aria-label={t('generationCommon.canvas.aria')}
      data-ready={isReady ? 'true' : undefined}
      data-tidying={isTidying ? 'true' : undefined}
      data-nomi-generation-canvas-import-target={!readOnly ? 'true' : undefined}
      onPointerDownCapture={handleStagePointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onWheelCapture={handleCanvasWheelCapture}
      onPointerUpCapture={handlePendingGroupPointerUp}
      onMouseUpCapture={handlePendingGroupPointerUp}
      onPointerDown={handleCanvasPointerDown}
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
        groupBoxes={groupBoxes}
        collapsedGroupCards={collapsedProjection.cards}
        onGroupFramePointerDown={handleGroupFramePointerDown}
        pendingConnection={Boolean(pendingConnectionSourceId)}
        pendingConnectionSourceId={collapsedGroupConnection.pendingConnectionSourceId}
        pendingConnectionSourceKind={collapsedGroupConnection.projectionProps.pendingConnectionSourceKind}
        pendingConnectionSide={pendingConnectionSourceSide}
        onConnectToGroup={handleConnectToGroupFromFlow}
        onStartGroupConnection={collapsedGroupConnection.projectionProps.onStartGroupConnection}
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
        onCreateEmpty={() =>
          useGenerationCanvasStore.getState().addNode({
            kind: 'image',
            position: { x: 240, y: 240 },
            categoryId: activeCategoryId,
            select: true,
          })
        }
        onNodeContextAction={handleNodeContextAction}
        onAddContextNode={handleAddContextNode}
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
        onResetView={() => void flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 })}
        onTidy={() => tidy(stageSize.width / Math.max(1, stageSize.height))}
        onZoomTo={zoomTo}
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
