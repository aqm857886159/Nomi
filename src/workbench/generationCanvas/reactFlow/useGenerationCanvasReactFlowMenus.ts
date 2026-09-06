import React from 'react'
import type { OnConnectEnd, OnConnectStart } from '@xyflow/react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import type { NodeContextMenuAction } from '../components/NodeContextMenu'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
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
}

type UseGenerationCanvasReactFlowMenusArgs = {
  readOnly: boolean
  hostRef: React.RefObject<HTMLDivElement>
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
  pasteNodes: (position: { x: number; y: number }) => void
  groupSelectedNodes: () => void
  deleteSelectedNodes: () => void
  /** 画布指针层（useGenerationCanvasReactFlowPointer）的原始回调，菜单层在它们之前插一脚。 */
  handleCanvasPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerEnd: () => void
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
  connectionCreateMenu: CanvasConnectionCreateMenu | null
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
} {
  const connectionStartRef = React.useRef<{ nodeId: string; side: ConnectionSide } | null>(null)
  const [connectionCreateMenu, setConnectionCreateMenu] = React.useState<CanvasConnectionCreateMenu | null>(null)

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
    onFrameMenu,
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

  const { handleAddContextNode, handleImportContextFiles, handleNodeContextAction, handleAddConnectedNode } = buildCanvasMenuActions({
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
    groupSelectedNodes,
    deleteSelectedNodes,
  })

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
  }, [cancelConnection, getCanvasPointFromClientPoint, handleConnectToGroup, hostRef, nodeById, readOnly, visibleGroups])

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

  return {
    contextNodeMenu,
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
  }
}
