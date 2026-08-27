import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'
import CanvasToolbar, { NodeAddMenu } from './CanvasToolbar'
import NodeContextMenu from './NodeContextMenu'
import { buildCanvasMenuActions } from './useCanvasMenuActions'
import { hasClipboardContent } from '../store/canvasClipboard'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import {
  BROWSER_ASSET_DRAG_MIME,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  handleCanvasStageDrop,
  importBrowserAssetsToGenerationCanvas,
} from './canvasStageDrop'
import {
  subscribeBrowserAssetsImportToCanvas,
  type BrowserAssetCanvasImportItem,
} from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import { getDesktopBridge } from '../../../desktop/bridge'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { getGenerationNodeComponent } from '../nodes/renderRegistry'
// 事件名单一真相源：派发方（深链）与监听方（这里）必须读同一个常量，否则改名字会静默断链。
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useBatchPlanPreviewStore } from './batchPlanPreview'
import { useCanvasGroupActions } from './useCanvasGroupActions'
import { useWorkbenchStore } from '../../workbenchStore'
import { CanvasGroupProjectionLayer } from './CanvasGroupProjectionLayer'
import { useAutoFitOnLoad } from './useAutoFitOnLoad'
import { useCanvasShortcuts } from './useCanvasShortcuts'
import { useCanvasPointerInteractions } from './useCanvasPointerInteractions'
import { useCanvasContextNodeMenu } from './useCanvasContextNodeMenu'
import { useDragToConnect } from './useDragToConnect'
import { CanvasEmptyState } from './CanvasEmptyState'
import { CanvasNavigationStack } from './CanvasNavigationStack'
import { SelectionPromptSaveController } from './SelectionPromptSaveController'
import { useNodeAppearTracking } from './useNodeAppearTracking'
import { useTidyCanvas } from './useTidyCanvas'
import {
  centerNodeOffset,
  clampNumber,
  getNodeSize,
  getSelectedBounds,
} from './generationCanvasGeometry'
import { useCollapsedCanvasViewport } from './useCollapsedCanvasViewport'
import { useCanvasTransformStoreSync } from './useCanvasTransformStoreSync'
import CanvasEdgeLayer, { type ActiveEdge } from './CanvasEdgeLayer'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { shouldRenderFullNodeContent, shouldUseLightweightNodeRendering } from './canvasNodeLevelOfDetail'
import { LightweightGenerationNode } from './LightweightGenerationNode'
import { hasPendingScene3DCameraMoveCapture, hasPendingScene3DStagingCapture } from './scene3dCaptureHostActivation'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { useCanvasSelectionDrag } from './useCanvasSelectionDrag'
import { CanvasSelectionToolbar } from './CanvasSelectionToolbar'
import { CanvasBatchGenerateDock } from './CanvasBatchGenerateDock'
import { useCanvasProductionActions } from './useCanvasProductionActions'
import { useCanvasBatchDockVisibility } from './useCanvasBatchDockVisibility'
import { useCanvasScreenshotCapture } from './useCanvasScreenshotCapture'
import { useComposerVisibilityPan } from './useComposerVisibilityPan'
import { useCanvasFitSignal } from './useCanvasFitSignal'
import '../styles/generationCanvas.css'

const StagingCaptureHost = lazyWithChunkBoundary('3D 站位捕获', () =>
  import('../nodes/scene3d/StagingCaptureHost').then((module) => ({ default: module.StagingCaptureHost })),
)
const CameraMoveCaptureHost = lazyWithChunkBoundary('3D 运镜捕获', () =>
  import('../nodes/scene3d/CameraMoveCaptureHost').then((module) => ({ default: module.CameraMoveCaptureHost })),
)
const BatchPlanOverlay = lazyWithChunkBoundary('批量生成面板', () =>
  import('./BatchPlanOverlay').then((module) => ({ default: module.BatchPlanOverlay })),
)

const MULTI_SELECTION_BOUNDS_PADDING = 16
const MULTI_SELECTION_TOOLBAR_OFFSET = 58

type GenerationCanvasProps = {
  readOnly?: boolean
}

export default function GenerationCanvas({ readOnly = false }: GenerationCanvasProps): JSX.Element {
  const { t } = useTranslation()
  const isReady = useGenerationCanvasStore((state) => state.isReady)
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const allEdges = useGenerationCanvasStore((state) => state.edges)
  const allGroups = useGenerationCanvasStore((state) => state.groups)
  const hasPendingStagingCapture = useGenerationCanvasStore((state) => hasPendingScene3DStagingCapture(state.nodes))
  const hasPendingCameraMoveCapture = useGenerationCanvasStore((state) => hasPendingScene3DCameraMoveCapture(state.nodes))
  const hasBatchPlanPreview = useBatchPlanPreviewStore((state) => Boolean(state.plan))
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId), timelineCollapsed = useWorkbenchStore((state) => state.timelinePanelCollapsed)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  // Phase E3: filter nodes by active sub-canvas. Nodes with no categoryId
  // fall back to the project default ("shots") so legacy projects keep
  // rendering until E4 migrates them.
  const nodes = React.useMemo(() => {
    if (!activeCategoryId) return allNodes
    return allNodes.filter((node) => (node.categoryId || 'shots') === activeCategoryId)
  }, [allNodes, activeCategoryId])
  const visibleNodeIds = React.useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
  const edges = React.useMemo(
    () => allEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [allEdges, visibleNodeIds],
  )
  const groups = React.useMemo(
    () => allGroups.filter((group) => group.categoryId === activeCategoryId),
    [activeCategoryId, allGroups],
  )
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const selectNodesInRect = useGenerationCanvasStore((state) => state.selectNodesInRect)
  const deleteSelectedNodes = useGenerationCanvasStore((state) => state.deleteSelectedNodes)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pasteNodes = useGenerationCanvasStore((state) => state.pasteNodes)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const selectNodes = useGenerationCanvasStore((state) => state.selectNodes)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const moveGroupNodes = useGenerationCanvasStore((state) => state.moveGroupNodes)
  const setGroupCollapsed = useGenerationCanvasStore((state) => state.setGroupCollapsed)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingConnectionSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const cancelConnection = useGenerationCanvasStore((state) => state.cancelConnection)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const redo = useGenerationCanvasStore((state) => state.redo)
  const markReady = useGenerationCanvasStore((state) => state.markReady)
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selectedBounds = React.useMemo(() => getSelectedBounds(nodes, selectedNodeIds), [nodes, selectedNodeIds])
  const selectedGroupIds = React.useMemo(() => {
    return groups
      .filter((group) => {
        const memberIds = group.nodeIds.filter((nodeId) => {
          const node = nodeById.get(nodeId)
          return node && (node.categoryId || 'shots') === group.categoryId
        })
        return memberIds.length > 0 && memberIds.every((nodeId) => selectedSet.has(nodeId))
      })
      .map((group) => group.id)
  }, [groups, nodeById, selectedSet])

  const collapsedCanvas = useCollapsedCanvasViewport({ activeCategoryId, nodes, edges, groups, readOnly })
  const { projection: collapsedProjection, groupBoxes, edgesForRender, edgeVisibleNodeIds } = collapsedCanvas
  // Pan/zoom + 视口虚拟化与收起编组投影共用一条渲染路径。
  const {
    categoryViewports,
    setViewport,
    zoom,
    offset,
    stageRef,
    canvasLayerRef,
    stageSize,
    visibleNodesForRender,
    offsetRef,
    zoomRef,
    stageSizeRef,
  } = collapsedCanvas.viewport
  // 出现动画：只让**新落点**节点弹入（add/paste/Agent），开项目时已有节点不齐闪（实现见 hook）。
  const appearNodeIds = useNodeAppearTracking(allNodes)
  const { isTidying, tidy } = useTidyCanvas(activeCategoryId)
  const {
    contextNodeMenu,
    setContextNodeMenu,
    prepareContextMenuPointerDown,
    handleContextMenuPointerMove,
    finishContextMenuPointerUp,
    handleStageContextMenu,
  } = useCanvasContextNodeMenu({
    readOnly,
    stageRef,
    offsetRef,
    zoomRef,
    pendingConnectionSourceId,
    clearSelection,
    // 右键落在节点上：已在多选里就原样保留（别把批量选择打断成单选），否则单选它。
    ensureNodeSelected: React.useCallback((nodeId: string) => {
      if (useGenerationCanvasStore.getState().selectedNodeIds.includes(nodeId)) return
      selectNode(nodeId)
    }, [selectNode]),
  })
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<{
    sourceNodeId: string
    sourceSide: ConnectionAnchorSide
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const [activeEdge, setActiveEdge] = React.useState<ActiveEdge | null>(null)
  const activeEdgeId = activeEdge?.id ?? null
  const [focusFlashNodeId, setFocusFlashNodeId] = React.useState<string | null>(null)
  const [pendingFocusNodeId, setPendingFocusNodeId] = React.useState<string | null>(null)
  const [minimapVisible, setMinimapVisible] = React.useState(true)
  const focusFlashTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    markReady()
  }, [markReady])

  React.useEffect(() => {
    if (!activeEdgeId || edges.some((edge) => edge.id === activeEdgeId)) return
    setActiveEdge(null)
  }, [activeEdgeId, edges])

  // allNodes 的最新值给 drag-connection 等效应读（offset/zoom/stageSize 的 ref 由 useCanvasViewport 提供）。
  const allNodesRef = React.useRef(allNodes)
  allNodesRef.current = allNodes

  const pointer = useCanvasPointerInteractions({
    readOnly,
    stageRef,
    offsetRef,
    zoomRef,
    setViewport,
    activeCategoryId,
    clearSelection,
    setContextNodeMenu,
    setActiveEdge,
    activeEdgeId,
    selectNodesInRect,
  })
  const { setViewportTransform, animateViewportTo, zoomAtStagePoint } = pointer
  useComposerVisibilityPan({ animateViewportTo, offsetRef, zoomRef })
  const { handleGroupFramePointerDown, handleSelectionBoundsPointerDown } = useCanvasSelectionDrag({
    readOnly,
    selectedNodeCount: selectedNodeIds.length,
    zoomRef,
    captureHistory,
    commitPersistedChange,
    moveGroupNodes,
    moveSelectedNodes,
    selectNodes,
  })

  React.useEffect(() => {
    const handleFocusNode = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: unknown }>).detail
      const nodeId = typeof detail?.nodeId === 'string' ? detail.nodeId : ''
      if (!nodeId) return
      const target = allNodesRef.current.find((node) => node.id === nodeId)
      if (!target) {
        toast(t('generationCommon.node.sourceNoLongerExists'), 'warning')
        return
      }
      const targetCategoryId = target.categoryId || 'shots'
      setActiveCategoryId(targetCategoryId)
      selectNode(nodeId)
      setPendingFocusNodeId(nodeId)
    }
    window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
    return () => {
      window.removeEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
      if (focusFlashTimerRef.current !== null) {
        window.clearTimeout(focusFlashTimerRef.current)
        focusFlashTimerRef.current = null
      }
    }
  }, [selectNode, setActiveCategoryId, t])

  React.useEffect(() => {
    if (!pendingFocusNodeId) return
    const target = allNodes.find((node) => node.id === pendingFocusNodeId)
    if (!target) {
      setPendingFocusNodeId(null)
      return
    }
    const targetCategoryId = target.categoryId || 'shots'
    if (targetCategoryId !== activeCategoryId) return
    const targetZoom = categoryViewports[targetCategoryId]?.zoom || zoomRef.current || 1
    const targetOffset = centerNodeOffset(target, stageSizeRef.current, targetZoom)
    animateViewportTo(targetZoom, targetOffset, 220) // 聚焦节点平滑滑入
    setFocusFlashNodeId(pendingFocusNodeId)
    setPendingFocusNodeId(null)
    if (focusFlashTimerRef.current !== null) window.clearTimeout(focusFlashTimerRef.current)
    focusFlashTimerRef.current = window.setTimeout(() => {
      setFocusFlashNodeId((current) => (current === pendingFocusNodeId ? null : current))
      focusFlashTimerRef.current = null
    }, 1400)
  }, [activeCategoryId, allNodes, animateViewportTo, categoryViewports, pendingFocusNodeId, stageSizeRef, zoomRef])

  useCanvasTransformStoreSync(zoom, offset) // 缩放即时、纯平移节流：别每帧惊动全部节点（见 hook 头注释）

  React.useEffect(() => {
    if (!contextNodeMenu) return undefined
    const closeMenu = () => setContextNodeMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextNodeMenu, setContextNodeMenu])

  React.useEffect(() => {
    if (!connectionCreateMenu) return undefined
    const closeMenu = () => {
      setConnectionCreateMenu(null)
      cancelConnection()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [cancelConnection, connectionCreateMenu])

  React.useEffect(() => {
    if (!connectionCreateMenu) return
    if (!pendingConnectionSourceId) return
    if (pendingConnectionSourceId === connectionCreateMenu.sourceNodeId) return
    setConnectionCreateMenu(null)
  }, [connectionCreateMenu, pendingConnectionSourceId])

  // 成组动作与批量生产分开收口，避免生成链路出现第二个实现。
  const {
    handleGroupSelectedNodes,
    handleUngroupSelectedNodes,
    handleConnectToGroup,
    contactSheetCount,
    handleBuildContactSheet,
  } = useCanvasGroupActions({ activeCategoryId, selectedGroupIds, selectedNodeIds })
  const production = useCanvasProductionActions({ activeCategoryId, selectedNodeIds })
  const batchDock = useCanvasBatchDockVisibility({ readOnly, selectedCount: selectedNodeIds.length, eligibleIds: production.eligibleIds })
  // 拖拽连线跟踪（含 rAF 节流预览线）抽到 useDragToConnect（R9/B3）
  const { pendingCursorPos } = useDragToConnect({
    readOnly,
    pendingConnectionSourceId,
    pendingConnectionSourceSide,
    stageRef,
    offsetRef,
    zoomRef,
    cancelConnection,
    onDropOnGroup: handleConnectToGroup,
    onDropOnEmpty: ({ sourceNodeId, sourceSide, stagePoint, canvasPoint }) => {
      const sourceNode = allNodesRef.current.find((node) => node.id === sourceNodeId)
      const sourceCanCreateMedia =
        sourceNode?.kind === 'text' ||
        sourceNode?.kind === 'image' ||
        Boolean(sourceNode && isImageLikeGenerationNodeKind(sourceNode.kind))
      if (!sourceCanCreateMedia || !stageRef.current) {
        cancelConnection()
        return
      }
      const rect = stageRef.current.getBoundingClientRect()
      const menuWidth = 132
      const menuHeight = 76
      setContextNodeMenu(null)
      cancelConnection()
      setConnectionCreateMenu({
        sourceNodeId,
        sourceSide,
        stageX: clampNumber(stagePoint.x, 8, Math.max(8, rect.width - menuWidth - 8)),
        stageY: clampNumber(stagePoint.y, 8, Math.max(8, rect.height - menuHeight - 8)),
        canvasX: Math.round(canvasPoint.x),
        canvasY: Math.round(canvasPoint.y),
      })
    },
  })

  const lastPastePositionRef = React.useRef<{ x: number; y: number } | null>(null)

  const getCanvasPointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) return null
    const rect = stageRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left - offsetRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - offsetRef.current.y) / zoomRef.current,
    }
  }, [offsetRef, stageRef, zoomRef])

  const rememberPastePositionFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const point = getCanvasPointFromClientPoint(clientX, clientY)
    if (!point) return
    lastPastePositionRef.current = {
      x: Math.max(40, Math.round(point.x)),
      y: Math.max(40, Math.round(point.y)),
    }
  }, [getCanvasPointFromClientPoint])

  const getToolbarInsertionPosition = React.useCallback(
    () => {
      const rect = stageRef.current?.getBoundingClientRect()
      const viewportAnchor = rect
        // 生成节点默认落在上半区：下方要留出完整 composer，比例切换才能保持同一连接侧且不出屏。
        ? { x: rect.width * 0.38, y: rect.height * 0.28 }
        : { x: 360, y: 280 }
      return {
        x: Math.round((viewportAnchor.x - offset.x) / zoom),
        y: Math.round((viewportAnchor.y - offset.y) / zoom),
      }
    },
    [offset.x, offset.y, zoom, stageRef],
  )

  const handleBrowserAssetsImportToCanvas = React.useCallback(
    (assets: readonly BrowserAssetCanvasImportItem[]) => {
      if (readOnly) return
      const result = importBrowserAssetsToGenerationCanvas(assets, {
        basePosition: getToolbarInsertionPosition(),
        categoryId: activeCategoryId,
      })
      if (result.createdCount === 0) {
        toast(t('generationCommon.canvas.noImportableAssets'), 'info')
        return
      }
      toast(
        result.createdCount === 1
          ? t('generationCommon.canvas.importedOne')
          : t('generationCommon.canvas.importedMany', { count: result.createdCount }),
        'success',
      )
    },
    [activeCategoryId, getToolbarInsertionPosition, readOnly, t],
  )

  React.useEffect(
    () => subscribeBrowserAssetsImportToCanvas((assets) => handleBrowserAssetsImportToCanvas(assets)),
    [handleBrowserAssetsImportToCanvas],
  )

  React.useEffect(() => {
    const overlayBridge = getDesktopBridge()?.browser?.assetOverlay
    if (!overlayBridge?.onImportToCanvas) return undefined
    return overlayBridge.onImportToCanvas((payload) => {
      const assets = Array.isArray(payload?.assets) ? payload.assets as BrowserAssetCanvasImportItem[] : []
      handleBrowserAssetsImportToCanvas(assets)
    })
  }, [handleBrowserAssetsImportToCanvas, t])

  const { screenshotOverlay } = useCanvasScreenshotCapture({ readOnly, getInsertPosition: getToolbarInsertionPosition, categoryId: activeCategoryId })

  const getPastePosition = React.useCallback(
    () => lastPastePositionRef.current ?? getToolbarInsertionPosition(),
    [getToolbarInsertionPosition],
  )

  const handleZoomTo = React.useCallback((nextZoom: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) {
      setViewportTransform(nextZoom, offsetRef.current)
      return
    }
    zoomAtStagePoint(nextZoom, { x: rect.width / 2, y: rect.height / 2 })
  }, [offsetRef, setViewportTransform, stageRef, zoomAtStagePoint])
  const handleZoomByStep = React.useCallback((direction: -1 | 1) => {
    const factor = direction > 0 ? 1.1 : 1 / 1.1
    handleZoomTo(clampNumber((zoomRef.current || 1) * factor, 0.2, 3))
  }, [handleZoomTo, zoomRef])

  useCanvasShortcuts({
    readOnly,
    stageRef,
    selectedNodeCount: selectedNodeIds.length,
    selectedGroupCount: selectedGroupIds.length,
    activeCategoryId,
    setActiveEdge,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes: handleGroupSelectedNodes,
    ungroupSelectedNodes: handleUngroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePosition,
    zoomByStep: handleZoomByStep,
    undo,
    redo,
  })

  const handleStageDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    handleCanvasStageDrop(event, { readOnly, offset, zoom, activeCategoryId })
  }, [activeCategoryId, offset, readOnly, zoom])

  const handleStagePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    rememberPastePositionFromClientPoint(event.clientX, event.clientY)
    pointer.onPointerDown(event)
  }, [pointer, rememberPastePositionFromClientPoint])

  const handleStagePointerDownCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (prepareContextMenuPointerDown(event)) {
      event.stopPropagation()
      return
    }
    pointer.onPointerDownCapture(event)
  }, [pointer, prepareContextMenuPointerDown])

  const handleStagePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handleContextMenuPointerMove(event)
    rememberPastePositionFromClientPoint(event.clientX, event.clientY)
    pointer.onPointerMove(event)
  }, [handleContextMenuPointerMove, pointer, rememberPastePositionFromClientPoint])

  const handleStagePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointer.onPointerUp(event)
    finishContextMenuPointerUp(event, event.button === 2 && pointer.shouldSuppressContextMenu())
  }, [finishContextMenuPointerUp, pointer])

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

  // animate=true：用户点「适应视图」按钮，平滑过渡；自动加载（useAutoFitOnLoad）传 false 即时定位，避免每次开项目都「飞入」。
  const fitView = React.useCallback((animate = false) => {
    if (!nodes.length || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const padding = 80
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const maxX = Math.max(...nodes.map((n) => n.position.x + getNodeSize(n).width))
    const maxY = Math.max(...nodes.map((n) => n.position.y + getNodeSize(n).height))
    const contentW = maxX - minX + padding * 2
    const contentH = maxY - minY + padding * 2
    const nextZoom = Math.min(1.2, Math.min(rect.width / contentW, rect.height / contentH))
    const nextOffset = {
      x: (rect.width - contentW * nextZoom) / 2 - (minX - padding) * nextZoom,
      y: (rect.height - contentH * nextZoom) / 2 - (minY - padding) * nextZoom,
    }
    if (animate) animateViewportTo(nextZoom, nextOffset, 200)
    else setViewportTransform(nextZoom, nextOffset)
  }, [animateViewportTo, nodes, setViewportTransform, stageRef])

  // memo 化 minimap 的跳转回调（内联会每渲染新建 → 废掉 CanvasMinimap 的 memo）。
  const handleMinimapJump = React.useCallback((point: { x: number; y: number }) => {
    const z = zoomRef.current || 1
    setViewportTransform(z, { x: stageSize.width / 2 - point.x * z, y: stageSize.height / 2 - point.y * z })
  }, [setViewportTransform, stageSize.width, stageSize.height, zoomRef])

  // 项目/分类首次加载时自动适应视图（含「历史视口框不住任何节点」的自愈式适应，
  // 防止图都在视口外、用户误以为「图消失」）。逻辑抽到 useAutoFitOnLoad（防巨壳）。
  useAutoFitOnLoad({ nodes, selectedNodeIds, activeCategoryId, categoryViewports, fitView, stageRef, zoomRef, offsetRef })

  useCanvasFitSignal(fitView)

  const zoomPercent = Math.round(zoom * 100)
  const selectedCount = selectedNodeIds.length
  const lightweightNodeMode = shouldUseLightweightNodeRendering(nodes.length, zoom)
  const handleSelectLightweightNode = React.useCallback(
    (nodeId: string, additive: boolean) => {
      if (readOnly) return
      selectNode(nodeId, additive)
    },
    [readOnly, selectNode],
  )

  // E.2C-13: 删除 viewType 分支。5 个分类全部走同一画布底座。
  // 节点渲染样式差异由 NodeRenderKind 分发（E.2C-14/15+ 实现）。

  return (
    <section
      className={cn(
        'generation-canvas-v2',
        'grid grid-rows-[minmax(0,1fr)] w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink',
      )}
      aria-label={t('generationCommon.canvas.aria')}
      data-ready={isReady ? 'true' : undefined}
      data-nomi-generation-canvas-import-target={!readOnly ? 'true' : undefined}
    >
      <div className={cn('generation-canvas-v2__main', 'relative w-full h-full min-w-0 min-h-0')}>
        {hasPendingStagingCapture || hasPendingCameraMoveCapture ? (
          <React.Suspense fallback={null}>
            {hasPendingStagingCapture ? <StagingCaptureHost /> : null}
            {hasPendingCameraMoveCapture ? <CameraMoveCaptureHost /> : null}
          </React.Suspense>
        ) : null}
        {!readOnly ? <CanvasToolbar getInsertionPosition={getToolbarInsertionPosition} categoryId={activeCategoryId} /> : null}
        <div
          // 光标：按住即 grabbing 走 CSS `:active`（零 JS）；空格/中键/右键那几档由手势 hook
          // 直写 data-panning / data-space-pan——都不经过 React，点一下画布不再触发任何重渲染。
          className={cn('generation-canvas-v2__stage', 'group/canvas', 'active:cursor-grabbing')}
          ref={stageRef}
          onPointerDownCapture={handleStagePointerDownCapture}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={pointer.onPointerCancel}
          onContextMenu={handleStageContextMenu}
          onDragOver={(event) => {
            if (readOnly) return
            const types = Array.from(event.dataTransfer.types)
            if (
              types.includes('Files') ||
              types.includes(WORKSPACE_FILE_DRAG_MIME) ||
              types.includes(ASSET_LIBRARY_DRAG_MIME) ||
              types.includes(BROWSER_ASSET_DRAG_MIME) ||
              types.includes(LEGACY_BROWSER_ASSET_DRAG_MIME)
            ) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={handleStageDrop}
        >
          <div
            ref={canvasLayerRef}
            // will-change：这层交给合成器，平移只搬像素不重绘（否则每帧重新光栅化整片节点 = 重绘区整屏泛绿的根因）。
            className={cn('generation-canvas-v2__canvas', 'absolute inset-0 origin-top-left will-change-transform')}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            {selectedBounds && selectedCount > 1 ? (
              <div
                className="generation-canvas-v2__selection-bounds"
                style={{
                  transform: `translate(${Math.round(selectedBounds.minX - MULTI_SELECTION_BOUNDS_PADDING)}px, ${Math.round(selectedBounds.minY - MULTI_SELECTION_BOUNDS_PADDING)}px)`,
                  width: Math.round(selectedBounds.width + MULTI_SELECTION_BOUNDS_PADDING * 2),
                  height: Math.round(selectedBounds.height + MULTI_SELECTION_BOUNDS_PADDING * 2),
                }}
                onPointerDown={handleSelectionBoundsPointerDown}
                aria-hidden="true"
              />
            ) : null}
            {/* 分层不变量：组框(z0) < 连线(z2) < 节点(z3)；组框不再放 nodes(z3) 里盖住边命中区。 */}
            <CanvasGroupProjectionLayer
              boxes={groupBoxes}
              cards={collapsedProjection.cards}
              readOnly={readOnly}
              onPointerDown={handleGroupFramePointerDown}
              pendingConnection={!readOnly && Boolean(pendingConnectionSourceId)}
              pendingConnectionSide={pendingConnectionSourceSide}
              onConnectToGroup={handleConnectToGroup}
              onSetCollapsed={setGroupCollapsed}
            />
            <CanvasEdgeLayer
              edges={edgesForRender}
              nodeById={collapsedProjection.edgeNodeById}
              zoom={zoom}
              visibleNodeIds={edgeVisibleNodeIds}
              lightweight={lightweightNodeMode}
              selectedNodeIds={selectedSet}
              activeEdge={activeEdge}
              readOnly={readOnly}
              pendingConnectionSourceId={connectionCreateMenu?.sourceNodeId ?? pendingConnectionSourceId}
              pendingConnectionSourceSide={connectionCreateMenu?.sourceSide ?? pendingConnectionSourceSide}
              pendingCursorPos={connectionCreateMenu ? { x: connectionCreateMenu.canvasX, y: connectionCreateMenu.canvasY } : pendingCursorPos}
              onSetActiveEdge={setActiveEdge}
              onUpdateEdgeMode={updateEdgeMode}
              onDisconnectEdge={disconnectEdge}
              getCanvasPointFromClientPoint={getCanvasPointFromClientPoint}
            />
            <div className={cn('generation-canvas-v2__nodes', 'absolute top-0 left-0 w-full h-full')} data-tidying={isTidying ? 'true' : undefined}>
              <React.Suspense fallback={null}>
                {visibleNodesForRender.map((node) => {
                  const selected = selectedSet.has(node.id)
                  const focusFlash = focusFlashNodeId === node.id
                  if (!shouldRenderFullNodeContent({ lightweightMode: lightweightNodeMode, selected, focusFlash })) {
                    return (
                      <LightweightGenerationNode
                        key={node.id}
                        node={node}
                        appear={appearNodeIds.has(node.id)}
                        onSelect={handleSelectLightweightNode}
                      />
                    )
                  }
                  const NodeComponent = getGenerationNodeComponent(node.kind)
                  return (
                    <NodeComponent
                      key={node.id}
                      node={node}
                      selected={selected}
                      readOnly={readOnly}
                      focusFlash={focusFlash}
                      appear={appearNodeIds.has(node.id)}
                    />
                  )
                })}
              </React.Suspense>
            </div>
            {screenshotOverlay}
            {selectedBounds && selectedCount > 1 && !readOnly ? (
              <CanvasSelectionToolbar
                selectedCount={selectedCount}
                selectedGroupCount={selectedGroupIds.length}
                transform={`translate(${Math.round(selectedBounds.minX + selectedBounds.width / 2)}px, ${Math.round(selectedBounds.minY - MULTI_SELECTION_BOUNDS_PADDING - MULTI_SELECTION_TOOLBAR_OFFSET)}px) translateX(-50%)`}
                eligibleCount={production.eligibleIds.length}
                executionGroups={production.executionGroups}
                concurrency={production.concurrency}
                contactSheetCount={contactSheetCount}
                onConcurrencyChange={production.setConcurrency}
                onGenerate={production.generate}
                onApplyModel={production.applyModel}
                onGroupSelectedNodes={handleGroupSelectedNodes}
                onUngroupSelectedNodes={handleUngroupSelectedNodes}
                onBuildContactSheet={handleBuildContactSheet}
                onClearSelection={clearSelection}
              />
            ) : null}
          </div>
          {pointer.marqueeRect ? (
            <div
              className={cn(
                'generation-canvas-v2__marquee',
                'absolute z-[10] pointer-events-none',
                'border border-nomi-accent rounded-nomi-sm bg-nomi-accent-soft/40',
              )}
              style={{
                left: pointer.marqueeRect.left,
                top: pointer.marqueeRect.top,
                width: pointer.marqueeRect.width,
                height: pointer.marqueeRect.height,
              }}
              aria-hidden="true"
            />
          ) : null}
          {/* E.2C-24: 空状态 CTA（spec 决策 4）— 分类感知的引导按钮（组件抽出，R9） */}
          {nodes.length === 0 ? (
            <CanvasEmptyState
              activeCategoryId={activeCategoryId}
              onCreate={() => addNode({ kind: 'image', position: { x: 240, y: 240 }, categoryId: activeCategoryId, select: true })}
            />
          ) : null}
          {contextNodeMenu?.nodeId ? (
            <NodeContextMenu
              className={cn('generation-canvas-v2__node-context-menu', 'z-[20]')}
              style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
              canPaste={hasClipboardContent()}
              canGroup={selectedNodeIds.length >= 2}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAction={handleNodeContextAction}
            />
          ) : contextNodeMenu ? (
            <NodeAddMenu
              className={cn('generation-canvas-v2__context-node-menu', 'z-[20]')}
              style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAddNode={handleAddContextNode}
            />
          ) : null}
          {connectionCreateMenu ? (
            <NodeAddMenu
              className={cn('generation-canvas-v2__connection-create-menu', 'z-[20] left-auto w-[132px]')}
              style={{ left: connectionCreateMenu.stageX, top: connectionCreateMenu.stageY }}
              kinds={['image', 'video']}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAddNode={handleAddConnectedNode}
            />
          ) : null}
        </div>
        {batchDock.visible ? <CanvasBatchGenerateDock {...production} timelineCollapsed={timelineCollapsed} onDismiss={batchDock.dismiss} /> : null}
        <CanvasNavigationStack
          readOnly={readOnly}
          nodes={nodes}
          selectedIds={selectedSet}
          zoom={zoom}
          zoomPercent={zoomPercent}
          offset={offset}
          stageSize={stageSize}
          minimapVisible={minimapVisible}
          onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
          onJumpToCanvasPoint={handleMinimapJump}
          onFitView={() => fitView(true)}
          onResetView={() => animateViewportTo(1, { x: 0, y: 0 }, 200)}
          onTidy={() => tidy(stageSize.width / Math.max(1, stageSize.height))}
          onZoomTo={handleZoomTo}
          batchPlanOverlay={
            hasBatchPlanPreview ? (
              <React.Suspense fallback={null}>
                <BatchPlanOverlay />
              </React.Suspense>
            ) : null
          }
        />
        <SelectionPromptSaveController nodes={allNodes} disabled={readOnly} />
      </div>
    </section>
  )
}
