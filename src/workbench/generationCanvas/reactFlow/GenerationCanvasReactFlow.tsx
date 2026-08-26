import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
  type OnNodeDrag,
  type OnEdgesDelete,
  type OnConnectStart,
  type OnConnectEnd,
  type OnNodesChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './generationCanvasReactFlow.css'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  subscribeBrowserAssetsImportToCanvas,
  type BrowserAssetCanvasImportItem,
} from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeComponent } from '../nodes/renderRegistry'
import { getNodeSizeBounds, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { getCanvasGroupBoxes } from '../components/generationCanvasGeometry'
import { GroupFrameList } from '../components/GroupFrame'
import { useCanvasSelectionDrag } from '../components/useCanvasSelectionDrag'
import { useCanvasGroupActions } from '../components/useCanvasGroupActions'
import { useCanvasShortcuts } from '../components/useCanvasShortcuts'
import { useCanvasScreenshotCapture } from '../components/useCanvasScreenshotCapture'
import { useCanvasProductionActions } from '../components/useCanvasProductionActions'
import { useCanvasBatchDockVisibility } from '../components/useCanvasBatchDockVisibility'
import { useCanvasFitSignal } from '../components/useCanvasFitSignal'
import { useTidyCanvas } from '../components/useTidyCanvas'
import { useAutoFitOnLoad } from '../components/useAutoFitOnLoad'
import { CanvasNavigationStack } from '../components/CanvasNavigationStack'
import { CanvasSelectionToolbar } from '../components/CanvasSelectionToolbar'
import { CanvasBatchGenerateDock } from '../components/CanvasBatchGenerateDock'
import { SelectionPromptSaveController } from '../components/SelectionPromptSaveController'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import NodeContextMenu from '../components/NodeContextMenu'
import { NodeAddMenu } from '../components/CanvasToolbar'
import { buildCanvasMenuActions } from '../components/useCanvasMenuActions'
import { hasClipboardContent } from '../store/canvasClipboard'
import { getSelectedBounds } from '../components/generationCanvasGeometry'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { availableEdgeModes } from '../components/edgeModeMenu'
import { hasPendingScene3DCameraMoveCapture, hasPendingScene3DStagingCapture } from '../components/scene3dCaptureHostActivation'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { CanvasEmptyState } from '../components/CanvasEmptyState'
import CanvasToolbar from '../components/CanvasToolbar'
import {
  BROWSER_ASSET_DRAG_MIME,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  handleCanvasStageDrop,
  importBrowserAssetsToGenerationCanvas,
} from '../components/canvasStageDrop'
import {
  canvasViewportFromFlow,
  collectFlowPositionChanges,
  flowViewportFromCanvas,
  toGenerationFlowEdges,
  toGenerationFlowNodes,
  type GenerationFlowEdge,
  type GenerationFlowNode,
} from './generationCanvasReactFlowAdapter'
import { GenerationFlowNodeScope } from './generationFlowNodeContext'

const StagingCaptureHost = lazyWithChunkBoundary('3D 站位捕获', () =>
  import('../nodes/scene3d/StagingCaptureHost').then((module) => ({ default: module.StagingCaptureHost })),
)
const CameraMoveCaptureHost = lazyWithChunkBoundary('3D 运镜捕获', () =>
  import('../nodes/scene3d/CameraMoveCaptureHost').then((module) => ({ default: module.CameraMoveCaptureHost })),
)
const BatchPlanOverlay = lazyWithChunkBoundary('批量生成面板', () =>
  import('../components/BatchPlanOverlay').then((module) => ({ default: module.BatchPlanOverlay })),
)

type GenerationCanvasReactFlowProps = { readOnly?: boolean }

function GenerationFlowNodeView({ data, selected }: NodeProps<GenerationFlowNode>): JSX.Element {
  const node = data.generationNode
  const NodeComponent = getGenerationNodeComponent(node.kind)
  const size = resolveNodeVisualSize(node)
  const bounds = getNodeSizeBounds(node.kind)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  return (
    <div className="generation-canvas-react-flow__node-shell" style={{ width: size.width, height: size.height }}>
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={bounds.minWidth}
        minHeight={bounds.minHeight}
        maxWidth={bounds.maxWidth}
        maxHeight={bounds.maxHeight}
        color="var(--nomi-accent)"
        onResizeStart={() => captureHistory()}
        onResize={(_event, params) => {
          updateNode(node.id, {
            position: { x: params.x, y: params.y },
            size: { width: params.width, height: params.height },
            meta: { ...(node.meta || {}), userResized: true, previewHeight: params.height },
          }, { persist: false, emit: false, history: false })
        }}
        onResizeEnd={() => {
          const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
          if (latest) {
            emitCanvasGesture([{
              type: 'canvas.node.updated',
              payload: {
                nodeId: node.id,
                patch: { position: latest.position, size: latest.size, meta: latest.meta },
              },
            }])
          }
          commitPersistedChange()
        }}
      />
      <Handle id="target-left" type="target" position={Position.Left} className="generation-canvas-react-flow__handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="generation-canvas-react-flow__handle" />
      <GenerationFlowNodeScope>
        <NodeComponent node={node} selected={selected} readOnly={data.readOnly} />
      </GenerationFlowNodeScope>
      <Handle id="source-left" type="source" position={Position.Left} className="generation-canvas-react-flow__handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="generation-canvas-react-flow__handle" />
    </div>
  )
}

function GenerationFlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<GenerationFlowEdge>): JSX.Element {
  const { t } = useTranslation()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const edge = data?.generationEdge
  const [menuOpen, setMenuOpen] = React.useState(false)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const source = edge ? nodes.find((node) => node.id === edge.source) : undefined
  const target = edge ? nodes.find((node) => node.id === edge.target) : undefined
  const modes = source && target ? availableEdgeModes(source, target) : []
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={30}
        className={cn(selected ? 'generation-canvas-react-flow__edge--selected' : undefined)}
      />
      {edge?.mode && edge.mode !== 'reference' ? (
        <EdgeLabelRenderer>
          <div
            className="generation-canvas-react-flow__edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <button
              type="button"
              className="generation-canvas-react-flow__edge-label-button"
              aria-haspopup="menu"
              aria-expanded={selected && menuOpen}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                if (selected) setMenuOpen((open) => !open)
              }}
            >
              {t(`generationCommon.canvas.edge.modes.${edge.mode}`)}
            </button>
            {selected && menuOpen ? (
              <div className="generation-canvas-react-flow__edge-menu" role="menu">
                {modes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === edge.mode}
                    onClick={(event) => {
                      event.stopPropagation()
                      updateEdgeMode(edge.id, mode)
                      setMenuOpen(false)
                    }}
                  >
                    {t(`generationCommon.canvas.edge.modes.${mode}`)}
                  </button>
                ))}
                <button
                  type="button"
                  className="generation-canvas-react-flow__edge-menu-delete"
                  onClick={(event) => {
                    event.stopPropagation()
                    disconnectEdge(edge.id)
                    setMenuOpen(false)
                  }}
                >
                  {t('generationCommon.canvas.edge.disconnectAction')}
                </button>
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

const nodeTypes = { generation: GenerationFlowNodeView }
const edgeTypes = { generation: GenerationFlowEdgeView }

function GenerationCanvasReactFlowInner({ readOnly = false }: GenerationCanvasReactFlowProps): JSX.Element {
  const { t } = useTranslation()
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const hostRef = React.useRef<HTMLDivElement>(null)
  const didMountSelectionRef = React.useRef(false)
  const draggingRef = React.useRef(false)
  const connectionStartRef = React.useRef<{ nodeId: string; side: 'left' | 'right' } | null>(null)
  const pendingFocusNodeRef = React.useRef<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null)
  const [stageSize, setStageSize] = React.useState({ width: 0, height: 0 })
  const [minimapVisible, setMinimapVisible] = React.useState(true)
  const [contextNodeMenu, setContextNodeMenu] = React.useState<{
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
    nodeId: string | null
  } | null>(null)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<{
    sourceNodeId: string
    sourceSide: 'left' | 'right'
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
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
  const markReady = useGenerationCanvasStore((state) => state.markReady)
  const selectNodes = useGenerationCanvasStore((state) => state.selectNodes)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const connectToNode = useGenerationCanvasStore((state) => state.connectToNode)
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

  const nodes = React.useMemo(
    () => allNodes.filter((node) => (node.categoryId || 'shots') === activeCategoryId),
    [activeCategoryId, allNodes],
  )
  const visibleNodeIds = React.useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const edges = React.useMemo(
    () => allEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [allEdges, visibleNodeIds],
  )
  const visibleGroups = React.useMemo(
    () => groups.filter((group) => group.categoryId === activeCategoryId),
    [activeCategoryId, groups],
  )
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const flowNodes = React.useMemo(
    () => toGenerationFlowNodes(nodes, selectedSet, readOnly),
    [nodes, readOnly, selectedSet],
  )
  const flowEdges = React.useMemo(
    () => toGenerationFlowEdges(edges, nodeById).map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId })),
    [edges, nodeById, selectedEdgeId],
  )
  const groupBoxes = React.useMemo(() => getCanvasGroupBoxes(visibleGroups, nodes), [nodes, visibleGroups])
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
  const zoomRef = React.useRef(viewport.zoom)
  const offsetRef = React.useRef({ x: viewport.x, y: viewport.y })
  zoomRef.current = viewport.zoom
  offsetRef.current = { x: viewport.x, y: viewport.y }

  React.useEffect(() => {
    const handleFocusNode = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: unknown }>).detail?.nodeId
      if (typeof nodeId !== 'string' || !nodeId) return
      const target = allNodes.find((node) => node.id === nodeId)
      if (!target) {
        toast(t('generationCommon.node.sourceNoLongerExists'), 'warning')
        return
      }
      pendingFocusNodeRef.current = nodeId
      setActiveCategoryId(target.categoryId || 'shots')
      selectNode(nodeId)
    }
    window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
    return () => window.removeEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
  }, [allNodes, selectNode, setActiveCategoryId, t])

  React.useEffect(() => {
    const nodeId = pendingFocusNodeRef.current
    if (!nodeId) return
    const target = nodes.find((node) => node.id === nodeId)
    if (!target) return
    const size = resolveNodeVisualSize(target)
    pendingFocusNodeRef.current = null
    void flow.setCenter(target.position.x + size.width / 2, target.position.y + size.height / 2, {
      zoom: zoomRef.current,
      duration: 220,
    })
  }, [activeCategoryId, flow, nodes, zoomRef])

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const updateSize = () => {
      const rect = host.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(host)
    return () => observer?.disconnect()
  }, [])

  React.useEffect(() => {
    markReady()
  }, [markReady])

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

  const getInsertionPosition = React.useCallback(() => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return { x: 240, y: 240 }
    return flow.screenToFlowPosition({ x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.3 })
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
  const handleBrowserAssetsImportToCanvas = React.useCallback((assets: readonly BrowserAssetCanvasImportItem[]) => {
    if (readOnly) return
    const result = importBrowserAssetsToGenerationCanvas(assets, {
      basePosition: getInsertionPosition(),
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
  }, [activeCategoryId, getInsertionPosition, readOnly, t])

  React.useEffect(
    () => subscribeBrowserAssetsImportToCanvas((assets) => handleBrowserAssetsImportToCanvas(assets)),
    [handleBrowserAssetsImportToCanvas],
  )

  React.useEffect(() => {
    const bridge = getDesktopBridge()?.browser?.assetOverlay
    if (!bridge?.onImportToCanvas) return undefined
    return bridge.onImportToCanvas((payload) => {
      const assets = Array.isArray(payload?.assets) ? payload.assets as BrowserAssetCanvasImportItem[] : []
      handleBrowserAssetsImportToCanvas(assets)
    })
  }, [handleBrowserAssetsImportToCanvas])

  const handleZoomByStep = React.useCallback((direction: -1 | 1) => {
    const current = flow.getViewport().zoom
    zoomTo(current * (direction > 0 ? 1.1 : 1 / 1.1))
  }, [flow, zoomTo])

  const createContextMenu = React.useCallback((event: MouseEvent | React.MouseEvent, nodeId: string | null) => {
    if (readOnly) return
    event.preventDefault()
    event.stopPropagation()
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const point = getCanvasPointFromClientPoint(event.clientX, event.clientY)
    setContextNodeMenu({
      nodeId,
      stageX: Math.max(8, Math.min(rect.width - 156, stageX)),
      stageY: Math.max(8, Math.min(rect.height - (nodeId ? 210 : 340), stageY)),
      canvasX: Math.round(point.x),
      canvasY: Math.round(point.y),
    })
  }, [getCanvasPointFromClientPoint, readOnly])

  const handleNodeContextMenu = React.useCallback((event: React.MouseEvent, node: GenerationFlowNode) => {
    if (readOnly) return
    if (!selectedSet.has(node.id)) selectNode(node.id)
    createContextMenu(event, node.id)
  }, [createContextMenu, readOnly, selectNode, selectedSet])

  const handlePaneContextMenu = React.useCallback((event: MouseEvent | React.MouseEvent) => {
    if (readOnly) return
    clearSelection()
    createContextMenu(event, null)
  }, [clearSelection, createContextMenu, readOnly])

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
  }, [cancelConnection, connectionCreateMenu, contextNodeMenu])

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
    for (const change of collectFlowPositionChanges(changes)) {
      moveNode(change.nodeId, change.position, { persist: false, emit: false })
    }
  }, [moveNode])

  const handleSelectionChange = React.useCallback(({ nodes: nextNodes, edges: nextEdges }: { nodes: GenerationFlowNode[]; edges: GenerationFlowEdge[] }) => {
    if (!didMountSelectionRef.current) {
      didMountSelectionRef.current = true
      return
    }
    selectNodes(nextNodes.map((node) => node.id))
    setSelectedEdgeId(nextEdges[0]?.id ?? null)
  }, [selectNodes])

  const handleEdgeClick = React.useCallback((_event: React.MouseEvent, edge: GenerationFlowEdge) => {
    setSelectedEdgeId(edge.id)
  }, [])

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

  const handleNodeDragStart = React.useCallback(() => {
    if (readOnly) return
    draggingRef.current = true
    captureHistory()
  }, [captureHistory, readOnly])

  const handleNodeDragStop: OnNodeDrag<GenerationFlowNode> = React.useCallback((_event, _node, draggedNodes) => {
    if (readOnly || !draggingRef.current) return
    draggingRef.current = false
    const state = useGenerationCanvasStore.getState()
    const movedEvents = draggedNodes
      .map((flowNode) => state.nodes.find((node) => node.id === flowNode.id))
      .filter((node): node is GenerationCanvasNode => Boolean(node))
      .map((node) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: node.id, position: node.position } }))
    if (movedEvents.length) emitCanvasGesture(movedEvents)
    commitPersistedChange()
  }, [commitPersistedChange, readOnly])

  const handleConnect = React.useCallback((connection: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
    if (readOnly || !connection.source || !connection.target) return
    const side = connection.sourceHandle === 'source-left' ? 'left' : 'right'
    startConnection(connection.source, side)
    connectToNode(connection.target)
  }, [connectToNode, readOnly, startConnection])

  const handleConnectStart: OnConnectStart = React.useCallback((_event, params) => {
    if (readOnly || !params.nodeId || params.handleType !== 'source') return
    const side = params.handleId === 'source-left' ? 'left' : 'right'
    connectionStartRef.current = { nodeId: params.nodeId, side }
    startConnection(params.nodeId, side)
  }, [readOnly, startConnection])

  const handleConnectEnd: OnConnectEnd = React.useCallback((event, connectionState) => {
    const started = connectionStartRef.current
    connectionStartRef.current = null
    if (readOnly || !started || connectionState.toNode) return
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
  }, [cancelConnection, getCanvasPointFromClientPoint, nodeById, readOnly])

  const handlePaneClick = React.useCallback(() => {
    if (!readOnly) clearSelection()
  }, [clearSelection, readOnly])

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
  }, [readOnly])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    handleCanvasStageDrop(event, {
      readOnly,
      offset: { x: viewport.x, y: viewport.y },
      zoom: viewport.zoom,
      activeCategoryId,
    })
  }, [activeCategoryId, readOnly, viewport.x, viewport.y, viewport.zoom])

  return (
    <section
      ref={hostRef}
      className={cn('generation-canvas-react-flow', 'relative w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink')}
      aria-label={t('generationCommon.canvas.aria')}
      data-ready={isReady ? 'true' : undefined}
      data-tidying={isTidying ? 'true' : undefined}
      data-nomi-generation-canvas-import-target={!readOnly ? 'true' : undefined}
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
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        panOnDrag={[1, 2]}
        selectionOnDrag
        deleteKeyCode={null}
        fitView={false}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onSelectionChange={handleSelectionChange}
        onEdgeClick={handleEdgeClick}
        onEdgesDelete={handleEdgesDelete}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onMoveEnd={(_event, nextViewport) => rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(nextViewport))}
        proOptions={{ hideAttribution: true }}
      >
        <ViewportPortal>
          <GroupFrameList
            boxes={groupBoxes}
            onPointerDown={handleGroupFramePointerDown}
            pendingConnection={Boolean(pendingConnectionSourceId)}
            pendingConnectionSide={pendingConnectionSourceSide}
            onConnectToGroup={handleConnectToGroup}
          />
        </ViewportPortal>
        <ViewportPortal>
          {selectedBounds && selectedNodeIds.length > 1 && !readOnly ? (
            <CanvasSelectionToolbar
              selectedCount={selectedNodeIds.length}
              selectedGroupCount={selectedGroupIds.length}
              transform={`translate(${Math.round(selectedBounds.minX + selectedBounds.width / 2)}px, ${Math.round(selectedBounds.minY - 16 - 58)}px) translateX(-50%)`}
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
        </ViewportPortal>
      </ReactFlow>
      {screenshotOverlay}
      {nodes.length === 0 ? (
        <CanvasEmptyState
          activeCategoryId={activeCategoryId}
          onCreate={() => useGenerationCanvasStore.getState().addNode({ kind: 'image', position: { x: 240, y: 240 }, categoryId: activeCategoryId, select: true })}
        />
      ) : null}
      {contextNodeMenu?.nodeId ? (
        <NodeContextMenu
          className="generation-canvas-react-flow__node-context-menu z-[20]"
          style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
          canPaste={hasClipboardContent()}
          canGroup={selectedNodeIds.length >= 2}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAction={handleNodeContextAction}
        />
      ) : contextNodeMenu ? (
        <NodeAddMenu
          className="generation-canvas-react-flow__context-node-menu z-[20]"
          style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAddNode={handleAddContextNode}
        />
      ) : null}
      {connectionCreateMenu ? (
        <NodeAddMenu
          className="generation-canvas-react-flow__connection-create-menu z-[20] left-auto w-[132px]"
          style={{ left: connectionCreateMenu.stageX, top: connectionCreateMenu.stageY }}
          kinds={['image', 'video']}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAddNode={handleAddConnectedNode}
        />
      ) : null}
      {batchDock.visible ? (
        <CanvasBatchGenerateDock
          {...production}
          timelineCollapsed={timelineCollapsed}
          onDismiss={batchDock.dismiss}
        />
      ) : null}
      <CanvasNavigationStack
        readOnly={readOnly}
        nodes={nodes}
        selectedIds={selectedSet}
        zoom={viewport.zoom}
        zoomPercent={Math.round(viewport.zoom * 100)}
        offset={{ x: viewport.x, y: viewport.y }}
        stageSize={stageSize}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
        onJumpToCanvasPoint={handleMinimapJump}
        onFitView={() => fitView(true)}
        onResetView={() => void flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 })}
        onTidy={() => tidy(stageSize.width / Math.max(1, stageSize.height))}
        onZoomTo={zoomTo}
        batchPlanOverlay={
          hasBatchPlanPreview ? (
            <React.Suspense fallback={null}>
              <BatchPlanOverlay />
            </React.Suspense>
          ) : null
        }
      />
      <SelectionPromptSaveController nodes={allNodes} disabled={readOnly} />
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
