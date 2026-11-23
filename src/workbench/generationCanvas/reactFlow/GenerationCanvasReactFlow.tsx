import { completeNodeConnection } from '../nodes/completeNodeConnection'
import React, { type JSX } from 'react'
import {
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useStoreApi,
  useReactFlow,
  type OnNodeDrag,
  type OnEdgesDelete,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './generationCanvasReactFlow.css'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { startPreviewAttachReconciler } from '../nodes/director/agent/previewAttachReconciler'
import { saveWorkflowFromProject } from '../../library/workflowLibrary'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME } from '../../assets/assetLibraryDrag'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useStableCategoryNodes } from './useStableCategoryNodes'
import { getCanvasGroupBoxes } from '../components/generationCanvasGeometry'
import { CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM, unionCanvasFitBounds } from '../model/canvasFitBounds'
import { projectCollapsedGroups } from '../model/canvasCardStackModel'
import { useCanvasSelectionDrag } from '../components/useCanvasSelectionDrag'
import { useCanvasGroupActions } from '../components/useCanvasGroupActions'
import { useCanvasGroupToolbar } from '../components/useCanvasGroupToolbar'
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
import { useCanvasFitSignal } from '../components/useCanvasFitSignal'
import { useTidyCanvas } from '../components/useTidyCanvas'
import { useNodeAppearTracking } from '../components/useNodeAppearTracking'
import { useAutoFitOnLoad } from '../components/useAutoFitOnLoad'
import { useCanvasArrivalHint } from './useCanvasArrivalHint'
import { visibleInsertionPoint } from '../store/canvasVisibleArea'
import { useReactFlowViewportAnimation } from './useReactFlowViewportAnimation'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { hasPendingDirectorCameraMoveCapture, hasPendingDirectorStagingCapture } from '../components/directorCaptureHostActivation'
import CanvasToolbar from '../components/CanvasToolbar'
import { CANVAS_DROP_ACTIVE_CLASS_NAME, watchCanvasDropActive } from '../components/canvasDropActiveFlag'
import { acceptsClipDropTypes } from '../nodes/clipNodeDrop'
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
} from './canvasDragDraft'
import { cancelCanvasNodeDrag, commitCanvasKeyboardPositions, endKernelNodeDrag, finishCanvasNodeDrag, isKeyboardMoveBatch, keyboardMoveScope, restoreDisownedKernelPositions } from './canvasDragWriteback'
import { GenerationFlowHandleMenuScope } from './generationFlowNodeContext'
import { GenerationCanvasReactFlowOverlays } from './GenerationCanvasReactFlowOverlays'
import { GenerationCanvasReactFlowViewport } from './GenerationCanvasReactFlowViewport'
import { useGenerationCanvasReactFlowPointer } from './useGenerationCanvasReactFlowPointer'
import type { CanvasFlowProjectionInput } from './useGenerationCanvasReactFlowProjection'
import { useGenerationCanvasReactFlowMenus } from './useGenerationCanvasReactFlowMenus'
import { useDockCollapsed } from '../../generation/useDockCollapsed'
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
  const [minimapCollapsed, setMinimapCollapsed] = useDockCollapsed('canvasMinimap') // 默认收起、开合记住（09-26 拍板）
  // #5 minimap 拖动中冻结门（纯渲染，只翻两次、不碰 RF 写入路径；冻结逻辑见 useStableCategoryNodes）。
  const [nodeDragActive, setNodeDragActive] = React.useState(false)
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  const categoryViewports = useWorkbenchStore((state) => state.categoryViewports)
  const rememberCategoryViewport = useWorkbenchStore((state) => state.rememberCategoryViewport)
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const allEdges = useGenerationCanvasStore((state) => state.edges)
  const groups = useGenerationCanvasStore((state) => state.groups)
  const hasPendingStagingCapture = useGenerationCanvasStore((state) => hasPendingDirectorStagingCapture(state.nodes))
  const hasPendingCameraMoveCapture = useGenerationCanvasStore((state) => hasPendingDirectorCameraMoveCapture(state.nodes))
  const hasBatchPlanPreview = useBatchPlanPreviewStore((state) => Boolean(state.plan))
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
  // 壳不订阅选区（选中一张卡，壳 0 次重渲；eslint 规则见 scripts/canvas-store-subscriptions.mjs）：回调里读那一刻的选区。
  const handleSaveWorkflow = React.useCallback(() => {
    const template = saveSelectedAsWorkflowTemplate(t('generationCommon.selection.defaultWorkflowName', { count: useGenerationCanvasStore.getState().selectedNodeIds.length })); if (!template) return
    void saveWorkflowFromProject(template, withProjectAction((project) => project.binding.projectId) ?? null).then(() => toast(t('generationCommon.selection.workflowSaved', { name: template.name }), 'success'))
  }, [saveSelectedAsWorkflowTemplate, t])

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
  // 选中的编组：选择器的结果是一个 id（或 null），点普通卡时一直是 null，壳不因此重渲。
  const selectedGroupId = useGenerationCanvasStore((state) => resolveSelectedGroupId({
    selectedFrameId: frameActions.selectedFrameId, selectedNodeIds: state.selectedNodeIds, groups: visibleGroups, existingNodeIds: visibleNodeIds,
  }))
  const flowProjectionNodes = React.useMemo(() => projectGroupConnectionPorts({
    visibleNodes: collapsedProjection.visibleNodes,
    cards: collapsedProjection.cards,
    edgeNodeById: collapsedProjection.edgeNodeById,
    boxes: readOnly ? [] : groupBoxes,
    selectedGroupId: readOnly ? null : selectedGroupId,
  }), [collapsedProjection, groupBoxes, readOnly, selectedGroupId])
  const nodeById = React.useMemo(() => new Map(flowProjectionNodes.map((node) => [node.id, node])), [flowProjectionNodes])
  // 投影的结构输入交给视口层；选区叠加、拖动草稿叠加都在视口层做（它自己订阅选区）。
  const flowProjection = React.useMemo<CanvasFlowProjectionInput>(() => ({
    nodes: flowProjectionNodes,
    edges: projectedEdges,
    edgeNodeById: collapsedProjection.edgeNodeById,
    aggregateByEdgeId,
    selectedEdgeId,
    readOnly,
    appearingNodeIds,
    focusFlashNodeId,
  }), [aggregateByEdgeId, appearingNodeIds, collapsedProjection.edgeNodeById, flowProjectionNodes, focusFlashNodeId, projectedEdges, readOnly, selectedEdgeId])
  // 视口层每次投影后回写；壳的拖动 / 取消回调在事件里读，不订阅。
  const projectedFlowNodesRef = React.useRef<GenerationFlowNode[]>([])
  const dragDraft = React.useMemo(() => ({ draggingRef, dragDraftNodesRef }), [])
  const pendingConnectionSourceKind = useGenerationCanvasStore((state) => state.pendingConnectionSourceKind)
  const selectedGroupIds = React.useMemo(() => selectedGroupId ? [selectedGroupId] : [], [selectedGroupId])
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

  // 下面这段同步把 store 的视口推给 React Flow；React Flow 随后回一次**没有来源事件**的 onMoveEnd。那是回声：
  // 值本来就出自 store——或者 store 里没有这个分类的记忆时，出自上一行的 1:1 兜底。回声不许再被记成「用户留下的视角」：
  // 2026-09-26 离开项目时 categoryViewports 清空，画布还停在上个项目的 0.26，同步把它推回兜底 1:1，回声把 1:1 记进了
  // 新 store；重开时「打开时适应」看到「有记住的视角、里面也有卡」就按设计保留了它——从项目库重开从此不再摆全貌。
  const storeSyncEchoRef = React.useRef<Viewport | null>(null)
  const isStoreSyncEcho = React.useCallback((next: Viewport) => {
    const echo = storeSyncEchoRef.current
    storeSyncEchoRef.current = null
    return Boolean(echo) && Math.abs(echo!.x - next.x) < 0.5 && Math.abs(echo!.y - next.y) < 0.5 && Math.abs(echo!.zoom - next.zoom) < 1e-3
  }, [])

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
    storeSyncEchoRef.current = viewport
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
    zoomRef,
    captureHistory,
    commitPersistedChange,
    moveGroupNodes,
    selectNodes,
    onSelectEmptyFrame: frameActions.selectFrame,
  })
  const {
    handleGroupSelectedNodes,
    handleUngroupSelectedNodes,
    handleConnectToGroup,
    handleBuildContactSheet,
  } = useCanvasGroupActions({
    activeCategoryId,
    selectedGroupIds,
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

  // 截图 / 浏览器素材 / 模板落点：与 addNode 默认落点同一个 owner（store/canvasVisibleArea）；新建节点由 addNode 造出节点后自行算落点。
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
    connectionCreateMenu, closeConnectionCreateMenu,
    handleStageContextMenu,
    handleFlowContextMenu,
    handleStagePointerDownCapture,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerEnd,
    handleConnectStart,
    handleConnectEnd,
    handleConnectToGroupFromFlow,
    handleAddContextNode,
    handleImportContextFiles,
    handleNodeContextAction,
    handleAddConnectedNode,
    openAddNodeMenuAt,
    openHandleMenu, assetInputPicker, closeAssetInputPicker, handleAddInputFromAssets, handleAddInputPickOnCanvas,
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

  useAutoFitOnLoad({
    ready: isReady,
    nodes,
    activeCategoryId,
    categoryViewports,
    fitView,
    stageRef: hostRef,
    zoomRef,
    offsetRef,
    hasFlowNode: (id) => flowStore.getState().nodeLookup.has(id),
  })
  useCanvasFitSignal(fitView)
  // 新东西落在屏外 / 别的分类：边缘提示，点了才过去（程序不再为「露出」主动挪画布，2026-09-25）。
  const arrival = useCanvasArrivalHint({ ready: isReady, allNodes, activeCategoryId, liveViewport, stageSize, animateViewportTo })
  const { isTidying, tidy } = useTidyCanvas(activeCategoryId)
  const selectedGroup = React.useMemo(() => visibleGroups.find((group) => group.id === selectedGroupId) ?? null, [selectedGroupId, visibleGroups])
  const groupToolbar = useCanvasGroupToolbar({ selectedGroup, allNodes, visibleNodeIds, canvasZoom: liveViewport.zoom, canvasOffsetX: liveViewport.x, canvasOffsetY: liveViewport.y, stageWidth: stageSize.width, stageHeight: stageSize.height, readOnly, runFrameAction: frameActions.runFrameAction })
  const { runFrameAction } = frameActions
  const frameInteraction: CanvasFrameInteraction = React.useMemo(() => ({
    membershipPreview: frameMembership.membershipPreview,
    editingGroupId: frameActions.editingFrameId,
    onEditingChange: frameActions.setEditingFrameId,
    onRename: renameGroup,
    onDescribe: setGroupDescription,
    onOpenMenu: frameActions.openFrameMenu,
    onGenerate: (groupId: string) => runFrameAction(groupId, 'generate'),
    // Both complete-member and empty/collapsed selection must drive the same frame chrome.
    selectedGroupId,
  }), [selectedGroupId, frameActions.editingFrameId, frameActions.openFrameMenu, runFrameAction, frameActions.setEditingFrameId, frameMembership.membershipPreview, renameGroup, setGroupDescription])

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
      const draftNodes = dragDraftNodesRef.current.length ? dragDraftNodesRef.current : projectedFlowNodesRef.current
      dragDraftNodesRef.current = applyCanvasDragPositionChanges(draftNodes, changes)
      applyCanvasDragKernelPositionChanges(flowStore, changes)
    } else if (positionChanges.length && !commitCanvasKeyboardPositions(positionChanges, !readOnly && isKeyboardMoveBatch(positionChanges, keyboardMoveScopeRef.current))) {
      restoreDisownedKernelPositions(flowStore, positionChanges)
    }

    const nextSelection = nextSelectionFromFlowChanges(changes, useGenerationCanvasStore.getState().selectedNodeIds)
    if (nextSelection) selectNodes(nextSelection)
  }, [flowStore, readOnly, selectNodes])

  // React Flow's selection store is internal while the persisted selection lives
  // in Zustand. Syncing on every internal selection notification causes a
  // feedback loop when controlled node props are replaced after insertion.
  // Clicks are handled explicitly above; marquee selection is committed once at
  // the end of the gesture.
  const handleSelectionEnd = React.useCallback(() => {
    if (readOnly) return
    selectNodes(flow.getNodes().filter((node) => node.selected).map((node) => node.id))
  }, [flow, readOnly, selectNodes])

  // 选中节点 = 放掉选中的线（一次只有一个「当前选中」，Delete 才知道删谁）。store 订阅，不进渲染；没选中线时一次 setState 都不发。
  const selectedEdgeIdRef = React.useRef(selectedEdgeId)
  // 挂了预演的镜头换模型 / 换方式 → 预演跟着重挂（直接点节点 ↑ 也带着它）。不依赖出片 Host：它只在渲染预演时才挂载
  React.useEffect(() => startPreviewAttachReconciler((message, level) => toast(message, level)), [])
  React.useEffect(() => { selectedEdgeIdRef.current = selectedEdgeId }, [selectedEdgeId])
  React.useEffect(() => useGenerationCanvasStore.subscribe((state, previous) => {
    if (state.selectedNodeIds === previous.selectedNodeIds || !state.selectedNodeIds.length || selectedEdgeIdRef.current === null) return
    selectedEdgeIdRef.current = null
    setSelectedEdgeId(null)
  }), [])

  const handleEdgeClick = React.useCallback((_event: React.MouseEvent, edge: GenerationFlowEdge) => {
    if (readOnly) return
    // 点线 = 选中这条线、放掉节点选择：Delete 只认「没有选中节点」时的选中边（useCanvasShortcuts），否则会删掉节点。
    selectNodes([])
    setSelectedEdgeId(edge.id)
  }, [readOnly, selectNodes])

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
    restoreFlowNodes: () => flowStore.getState().setNodes(projectedFlowNodesRef.current),
  }), [flowStore, frameMembership])
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
    const flowNodes = projectedFlowNodesRef.current
    dragDraftNodesRef.current = flowNodes
    flowStore.setState({ hasDefaultNodes: false })
    dragLeaseRef.current?.release()
    // 取消：先还原位置再结束内核拖动（否则回来时节点仍跟着光标）；松手丢了：当作在最后位置松手，走正常收尾。
    dragLeaseRef.current = beginCanvasDragging(hostRef.current, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel: (lastPoint) => { cancelNodeDragRef.current(); endKernelNodeDrag(lastPoint) }, onReleaseLost: endKernelNodeDrag, ...('pointerId' in event && typeof event.pointerId === 'number' ? { pointerId: event.pointerId } : {}) })
    // Selecting a group is a frame-level context. The blank frame surface owns
    // whole-group dragging; a card inside it keeps the single-node drag contract.
    const draggingInsideSelectedGroup = Boolean(selectedGroup?.nodeIds.includes(draggedNode.id))
    const selectedNodeIds = useGenerationCanvasStore.getState().selectedNodeIds
    const originalIds = !draggingInsideSelectedGroup && selectedNodeIds.includes(draggedNode.id) ? selectedNodeIds : [draggedNode.id]
    duplicateDragIdsRef.current = 'altKey' in event && event.altKey
      ? useGenerationCanvasStore.getState().duplicateNodesForDrag(originalIds) : new Map()
    if (!duplicateDragIdsRef.current.size) captureHistory()
    const state = useGenerationCanvasStore.getState()
    const draggedIds = originalIds.map((id) => duplicateDragIdsRef.current.get(id) ?? id)
    if (duplicateDragIdsRef.current.size) {
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
  }, [captureHistory, flowStore, readOnly, selectedGroup])

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
    setSelectedEdgeId(null)
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

  // 拖放进行中（可接收的载荷）画布浮层不吃命中，别挡住真正的接收目标（剪辑节点轴等）。
  React.useEffect(() => (hostRef.current ? watchCanvasDropActive(hostRef.current, acceptsClipDropTypes) : undefined), [])

  return (
    <section
      ref={hostRef}
      className={cn('generation-canvas-react-flow', 'generation-canvas-v2__stage', 'group/canvas', CANVAS_DROP_ACTIVE_CLASS_NAME, 'relative w-full h-full min-w-0 min-h-0 bg-workbench-bg text-workbench-ink')}
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
      {!readOnly ? <CanvasToolbar getInsertionPosition={getInsertionPosition} categoryId={activeCategoryId} stageWidth={stageSize.width || undefined} /> : null}
      <GenerationFlowHandleMenuScope open={openHandleMenu}>
      <GenerationCanvasReactFlowViewport
        projection={flowProjection}
        categoryNodes={nodes}
        dragDraft={dragDraft}
        projectedFlowNodesRef={projectedFlowNodesRef}
        isNodeDragging={nodeDragActive}
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
        isStoreSyncEcho={isStoreSyncEcho}
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
        selectedGroupIds={selectedGroupIds}
        onGroupSelectedNodes={handleGroupSelectedNodes}
        onBuildContactSheet={handleBuildContactSheet}
        onSaveWorkflow={handleSaveWorkflow}
        onClearSelection={clearSelection}
        groupToolbar={groupToolbar}
      />
      </GenerationFlowHandleMenuScope>
      <GenerationCanvasReactFlowOverlays
        readOnly={readOnly}
        activeCategoryId={activeCategoryId}
        // #5：overlays 里唯一逐帧敏感的消费者是 minimap；empty-state 只看 length（拖动中不变）。
        // 拖动期传冻结引用 → minimap 不重画；空态判定不受影响（成员与 length 一致）。
        nodes={minimapNodes}
        allNodes={allNodes}
        screenshotOverlay={screenshotOverlay}
        contextNodeMenu={contextNodeMenu}
        connectionCreateMenu={connectionCreateMenu} onCloseConnectionCreateMenu={closeConnectionCreateMenu}
        onAddInputFromAssets={handleAddInputFromAssets} onAddInputPickOnCanvas={handleAddInputPickOnCanvas}
        assetInputPicker={assetInputPicker} onCloseAssetInputPicker={closeAssetInputPicker}
        getInsertionPosition={getInsertionPosition}
        onNodeContextAction={handleNodeContextAction}
        onCloseContextNodeMenu={closeContextNodeMenu}
        onAddContextNode={handleAddContextNode}
        onImportContextFiles={handleImportContextFiles}
        onAddConnectedNode={handleAddConnectedNode}
        hasBatchPlanPreview={hasBatchPlanPreview}
        zoom={liveViewport.zoom}
        zoomPercent={Math.round(liveViewport.zoom * 100)}
        offset={{ x: liveViewport.x, y: liveViewport.y }}
        stageSize={stageSize}
        minimapVisible={!minimapCollapsed}
        onToggleMinimap={() => setMinimapCollapsed(!minimapCollapsed)}
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
