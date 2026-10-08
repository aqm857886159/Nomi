import React from 'react'
import type { CanvasPlacementAnchor } from '../model/canvasPlacement'
import type { OnConnectEnd, OnConnectStart } from '@xyflow/react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import type { NodeContextMenuAction } from '../components/NodeContextMenu'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import type { ConnectionCreateVerdict } from '../agent/referenceEdgeCapability'
import type { NodeDeriveKind } from '../quickActions/nodeDeriveMenuModel'
import { connectionMenuVerdicts, resolveRingMenuPlacement, type ConnectionMenuStart } from './connectionMenuModel'
import { addInputAcceptedAssets } from '../quickActions/nodeDeriveMenuModel'
import { pickCanvasInputFor } from '../quickActions/nodeInputActions'
import {
  useCanvasContextNodeMenu,
  type CanvasContextNodeMenu,
} from '../components/useCanvasContextNodeMenu'
import { buildCanvasMenuActions } from '../components/useCanvasMenuActions'
import { resolveCanvasDropTargetFromDom } from './canvasConnectionDropTarget'

type ConnectionSide = 'left' | 'right'

export type CanvasConnectionCreateMenu = {
  sourceNodeId: string
  sourceSide: ConnectionSide
  stageX: number
  stageY: number
  canvasX: number
  canvasY: number
  /** 这条线接出每一类节点的判定（接不上的带原因，菜单里灰掉；至少一类接得上才会开菜单）。 */
  verdicts: ConnectionCreateVerdict<NodeDeriveKind>[]
  /** 松手 / 点「+」那一下的视口坐标（菜单走 `WorkbenchMenu`，按视口定位）。 */
  clientX: number
  clientY: number
  /** true = 拖线松手（新卡落在松手点）；false = 点「+」出的菜单（新卡落在卡旁边，由 addNode 避让）。 */
  exactPosition: boolean
  /** 线从一张卡起，还是从编组的「+」起（model/groupPort.ts）——新建节点后按哪种起点接上。 */
  sourceKind: 'node' | 'group'
}

type ConnectionStart = ConnectionMenuStart

/** 左「+」「从素材库添加…」打开的素材选择器：接进哪张卡、锚在哪、只列这张卡收得下的种类。 */
export type CanvasAssetInputPicker = { targetNodeId: string; clientX: number; clientY: number; accept: ('image' | 'video' | 'audio')[] }

type UseGenerationCanvasReactFlowMenusArgs = {
  readOnly: boolean
  hostRef: React.RefObject<HTMLDivElement | null>
  offsetRef: React.MutableRefObject<{ x: number; y: number }>
  zoomRef: React.MutableRefObject<number>
  activeCategoryId: string
  pendingConnectionSourceId: string | null
  nodeById: Map<string, GenerationCanvasNode>
  visibleGroups: readonly { id: string }[]
  getCanvasPointFromClientPoint: (clientX: number, clientY: number) => { x: number; y: number }
  handleConnectToGroup: (groupId: string) => void
  clearSelection: () => void
  cancelConnection: () => void
  addNode: (input: {
    kind: GenerationNodeKind
    position: { x: number; y: number }
    categoryId: string
    exactPosition?: boolean
    select?: boolean
  }) => { id: string }
  startConnection: (nodeId: string, side: ConnectionSide) => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (position: { x: number; y: number }, anchor?: CanvasPlacementAnchor) => void
  groupSelectedNodes: () => void
  deleteSelectedNodes: () => void
  /** 画布指针层（useGenerationCanvasReactFlowPointer）的原始回调，菜单层在它们之前插一脚。 */
  handleCanvasPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerEnd: (event?: React.PointerEvent<HTMLDivElement>) => void
  shouldSuppressContextMenu: () => boolean
  /** 右键落在框体上时改开框菜单（与头部 ⋯ 同一份）；由 useCanvasFrameActions 拥有那份状态。 */
  onFrameMenu?: (frameId: string, point: { x: number; y: number }) => void
  /**
   * 框工具就绪时的画框手势（**冒泡阶段**）；返回 true = 这次 pointerdown 归画框，
   * 画布自己的平移记账就不必再记。就绪期间 React Flow 已被 `panOnDrag={false}` 停用，
   * 所以这里既不需要 capture 阶段，也不需要 stopPropagation（R29 §6.2）。
   */
  onFrameToolPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => boolean
}

/**
 * 画布「弹菜单」这一层：右键菜单（空白 / 节点）与起线落空后的「连线创建」菜单，
 * 连同它们各自的开合时机——stage 指针链、Escape/外部点击关闭、连线 drop 落点解析。
 *
 * 抽出来的是结构不是行为（R9：宿主 GenerationCanvasReactFlow.tsx 已顶到 800 行门岗）：
 * 这两个菜单共享同一批开合条件（同一次 pointerdown 只能开一个、Escape 与外部点击一起关、
 * pendingConnection 消失时创建菜单必须跟着关），放在一起才有单一 owner；散在宿主里时
 * 它们的状态、effect 与落点解析被别的关注点隔开，改一个很容易漏掉另一个。
 */
export function useGenerationCanvasReactFlowMenus({
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
  groupSelectedNodes,
  deleteSelectedNodes,
  handleCanvasPointerDownCapture,
  handleCanvasPointerDown,
  handleCanvasPointerMove,
  handleCanvasPointerEnd,
  shouldSuppressContextMenu,
  onFrameMenu,
  onFrameToolPointerDown,
}: UseGenerationCanvasReactFlowMenusArgs): {
  contextNodeMenu: CanvasContextNodeMenu | null
  closeContextNodeMenu: () => void
  connectionCreateMenu: CanvasConnectionCreateMenu | null
  closeConnectionCreateMenu: () => void
  handleStageContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  handleFlowContextMenu: (event: MouseEvent | React.MouseEvent) => void
  handleStagePointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleStagePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleStagePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleStagePointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePendingGroupPointerUp: (
    event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | PointerEvent | MouseEvent,
  ) => void
  handleConnectStart: OnConnectStart
  handleConnectEnd: OnConnectEnd
  handleConnectToGroupFromFlow: (groupId: string) => void
  handleAddContextNode: (kind: GenerationNodeKind) => void
  handleImportContextFiles: (files: File[]) => void
  handleNodeContextAction: (action: NodeContextMenuAction) => void
  handleAddConnectedNode: (kind: GenerationNodeKind) => void
  openAddNodeMenuAt: (clientX: number, clientY: number) => void
  openHandleMenu: (request: { nodeId: string; side: ConnectionSide; clientX: number; clientY: number }) => void
  assetInputPicker: CanvasAssetInputPicker | null
  closeAssetInputPicker: () => void
  handleAddInputFromAssets: () => void
  handleAddInputPickOnCanvas: () => void
} {
  const connectionStartRef = React.useRef<ConnectionStart | null>(null)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<CanvasConnectionCreateMenu | null>(null)
  const [assetInputPicker, setAssetInputPicker] = React.useState<CanvasAssetInputPicker | null>(null)
  const startGroupConnection = useGenerationCanvasStore((state) => state.startGroupConnection)

  const ensureContextNodeSelected = React.useCallback((nodeId: string) => {
    const state = useGenerationCanvasStore.getState()
    if (!state.selectedNodeIds.includes(nodeId)) state.selectNode(nodeId)
  }, [])
  const {
    contextNodeMenu,
    setContextNodeMenu,
    openBlankMenuAt,
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
    onFrameMenu,
  })

  const closeConnectionCreateMenu = React.useCallback(() => {
    setConnectionCreateMenu(null)
    cancelConnection()
  }, [cancelConnection])

  const handleConnectToGroupFromFlow = React.useCallback((groupId: string) => {
    const state = useGenerationCanvasStore.getState()
    if (state.pendingConnectionSourceKind === 'group') {
      state.connectToNode(groupId)
    } else {
      handleConnectToGroup(groupId)
    }
    setConnectionCreateMenu(null)
  }, [handleConnectToGroup])

  const closeContextNodeMenu = React.useCallback(() => {
    setContextNodeMenu(null)
  }, [setContextNodeMenu])

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

  // 冒泡阶段：画框先过一手。它只在工具就绪时认领空白左键，而那一刻 React Flow 的
  // panOnDrag 已经是 false（GenerationCanvasReactFlowViewport），所以事件走到这里时
  // 内核根本没打算平移——不需要 capture，也不需要 stopPropagation（R29 §6.2）。
  const handleStagePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (onFrameToolPointerDown?.(event)) return
    handleCanvasPointerDown(event)
  }, [handleCanvasPointerDown, onFrameToolPointerDown])

  const handleStagePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handleContextMenuPointerMove(event)
    handleCanvasPointerMove(event)
  }, [handleCanvasPointerMove, handleContextMenuPointerMove])

  const handleStagePointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const suppressContextMenu = event.button === 2 && shouldSuppressContextMenu()
    handleCanvasPointerEnd(event)
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

  const { handleAddContextNode, handleImportContextFiles, handleNodeContextAction, handleAddConnectedNode } = buildCanvasMenuActions({
    activeCategoryId,
    contextNodeMenu,
    setContextNodeMenu,
    connectionCreateMenu,
    setConnectionCreateMenu,
    addNode,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    groupSelectedNodes,
    deleteSelectedNodes,
  })

  const handleConnectStart: OnConnectStart = React.useCallback((_event, params) => {
    if (readOnly || !params.nodeId || params.handleType !== 'source') return
    const side = params.handleId?.endsWith('-left') ? 'left' : 'right'
    // 编组的「+」挂在它的端口节点上（节点 id = 编组 id）：起的是编组线，走 store 现成的编组起线。
    const fromGroup = useGenerationCanvasStore.getState().groups.some((group) => group.id === params.nodeId)
    connectionStartRef.current = { nodeId: params.nodeId, side, sourceKind: fromGroup ? 'group' : 'node' }
    if (fromGroup) startGroupConnection(params.nodeId, side)
    else startConnection(params.nodeId, side)
  }, [readOnly, startConnection, startGroupConnection])

  const handleConnectEnd: OnConnectEnd = React.useCallback((event, connectionState) => {
    const started = connectionStartRef.current
    connectionStartRef.current = null
    if (readOnly || !started || (connectionState.isValid && connectionState.toNode)) return
    const point = 'changedTouches' in event
      ? event.changedTouches[0]
      : event
    if (!point) {
      cancelConnection()
      return
    }
    // 先看落在哪：落在卡上 / 编组上就连，跟「这个源能不能新建节点」无关——
    // 此前先判能不能新建，接不出新节点的源（镜头笔记 / 输出）落到卡身上也被整条取消。
    const targetNodeId = resolveCanvasDropTargetFromDom({ clientX: point.clientX, clientY: point.clientY }, started.nodeId, hostRef.current, '.generation-canvas-v2-node[data-node-id]', 'data-node-id', new Set(nodeById.keys()))
    if (targetNodeId) {
      completeNodeConnection(targetNodeId)
      return
    }
    const targetGroupId = resolveCanvasDropTargetFromDom({ clientX: point.clientX, clientY: point.clientY }, '', hostRef.current, '[data-group-id]', 'data-group-id', new Set(visibleGroups.map((group) => group.id)))
    if (targetGroupId) {
      // 编组连编组没有定义（N×M 条边谁也看不懂），只接卡 → 编组。
      if (started.sourceKind === 'group') cancelConnection()
      else handleConnectToGroup(targetGroupId)
      return
    }
    const verdicts = connectionMenuVerdicts(started)
    if (!verdicts.some((verdict) => verdict.ok)) {
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
      verdicts,
      clientX: point.clientX,
      clientY: point.clientY,
      exactPosition: true,
      sourceKind: started.sourceKind,
    })
  }, [cancelConnection, getCanvasPointFromClientPoint, handleConnectToGroup, hostRef, nodeById, readOnly, visibleGroups])

  // 点一下「+」（不拖）：出这一侧的菜单，锚在圈下（bug ①：以前只有拖线这一条入口，点了什么都不发生）。
  // 菜单开着 = 一条待连的线（与拖线松手同一状态），关菜单就取消它；新卡落在卡旁边（没有松手点）。
  const openHandleMenu = React.useCallback(({ nodeId, side, clientX, clientY }: { nodeId: string; side: ConnectionSide; clientX: number; clientY: number }) => {
    if (readOnly) return
    const state = useGenerationCanvasStore.getState()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const verdicts = connectionMenuVerdicts({ nodeId, side, sourceKind: 'node' })
    if (!verdicts.length) return
    const rect = hostRef.current?.getBoundingClientRect()
    const placement = resolveRingMenuPlacement(node, side, 'image')
    startConnection(nodeId, side)
    setConnectionCreateMenu({
      sourceNodeId: nodeId,
      sourceSide: side,
      stageX: rect ? clientX - rect.left : clientX,
      stageY: rect ? clientY - rect.top : clientY,
      canvasX: placement.x,
      canvasY: placement.y,
      verdicts,
      clientX,
      clientY,
      exactPosition: false,
      sourceKind: 'node',
    })
  }, [hostRef, readOnly, startConnection])

  // 左「+」菜单底下两项：都先关菜单（取消那条待连的线），再交给素材选择器 / 点选模式去接。
  const handleAddInputFromAssets = React.useCallback(() => {
    if (!connectionCreateMenu) return
    setAssetInputPicker({
      targetNodeId: connectionCreateMenu.sourceNodeId,
      clientX: connectionCreateMenu.clientX,
      clientY: connectionCreateMenu.clientY,
      accept: addInputAcceptedAssets(connectionCreateMenu.verdicts),
    })
    closeConnectionCreateMenu()
  }, [closeConnectionCreateMenu, connectionCreateMenu])
  const handleAddInputPickOnCanvas = React.useCallback(() => {
    if (!connectionCreateMenu) return
    closeConnectionCreateMenu()
    pickCanvasInputFor(connectionCreateMenu.sourceNodeId)
  }, [closeConnectionCreateMenu, connectionCreateMenu])
  const closeAssetInputPicker = React.useCallback(() => setAssetInputPicker(null), [])

  const handlePendingGroupPointerUp = React.useCallback((event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | PointerEvent | MouseEvent) => {
    if (readOnly || !pendingConnectionSourceId) return
    if (useGenerationCanvasStore.getState().pendingConnectionSourceKind === 'group') return // 编组线不落到编组上
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

  return {
    contextNodeMenu,
    /** 只关节点/添加菜单本身（不碰连线状态）——`WorkbenchMenu` 的 onOpenChange 走这条。 */
    closeContextNodeMenu,
    connectionCreateMenu,
    /** 「用这个节点生成…」菜单自己关（Esc / 点外面）：连带取消这条没落地的线。 */
    closeConnectionCreateMenu,
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
    openAddNodeMenuAt: openBlankMenuAt,
    openHandleMenu,
    assetInputPicker,
    closeAssetInputPicker,
    handleAddInputFromAssets,
    handleAddInputPickOnCanvas,
  }
}
