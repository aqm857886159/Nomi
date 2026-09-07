import React from 'react'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from './canvasDraggingFlag'
import type { GenerationCanvasState } from '../store/canvasStoreTypes'

type DragRecord = {
  clientX: number
  clientY: number
  moved: boolean
  historyCaptured: boolean
}

type GroupDragRecord = DragRecord & { groupId: string }
type Delta = { x: number; y: number }

type CanvasSelectionDragOptions = {
  readOnly: boolean
  selectedNodeCount: number
  zoomRef: React.MutableRefObject<number>
  captureHistory: GenerationCanvasState['captureHistory']
  commitPersistedChange: GenerationCanvasState['commitPersistedChange']
  moveGroupNodes: GenerationCanvasState['moveGroupNodes']
  moveSelectedNodes: GenerationCanvasState['moveSelectedNodes']
  selectNodes: GenerationCanvasState['selectNodes']
}

export function useCanvasSelectionDrag({
  readOnly,
  selectedNodeCount,
  zoomRef,
  captureHistory,
  commitPersistedChange,
  moveGroupNodes,
  moveSelectedNodes,
  selectNodes,
}: CanvasSelectionDragOptions): {
  handleGroupFramePointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    groupId: string,
    options?: { selectMembers?: boolean },
  ) => void
  handleSelectionBoundsPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const draggingGroupRef = React.useRef<GroupDragRecord | null>(null)
  const draggingSelectionRef = React.useRef<DragRecord | null>(null)
  const dragMoveFrameRef = React.useRef<number | null>(null)
  const pendingGroupDeltaRef = React.useRef<(Delta & { groupId: string }) | null>(null)
  const pendingSelectionDeltaRef = React.useRef<Delta | null>(null)

  /**
   * 每帧只往下发**整数**位移，余数留在待发账上给下一帧——不是洁癖，是拖动会「跟不上手」。
   *
   * 下游两个写口都写 `Math.round(position + delta)`（canvasNodeActions.moveSelectedNodes /
   * canvasGraphActions.moveGroupNodes）：位置是整数、delta 带小数，于是每帧那点小数被
   * **就地丢掉**。而一次匀速拖动里每帧的小数部分几乎是同一个值（鼠标步长 ÷ 缩放），
   * 丢弃就不是抖动而是**系统性缺斤少两**——实测 2026-09-07：屏幕上拖 150px、缩放 0.963，
   * 框只走了 144，越拖差得越多，缩得越小差得越狠。
   *
   * 更坏的一半是它**不是等量地**发生在两个真相上：框的矩形是小数、成员位置是整数，
   * 同一次拖动里两者被截掉的量不同，于是框和它装的东西会慢慢错位（框只长不缩 → 框变大）。
   * 所以余数必须在**发出去之前**留下来，而不是让每个下游各自去猜。
   */
  const flushPendingDragMove = React.useCallback(() => {
    dragMoveFrameRef.current = null
    const groupDelta = pendingGroupDeltaRef.current
    const selectionDelta = pendingSelectionDeltaRef.current
    if (groupDelta) {
      const whole = { x: Math.trunc(groupDelta.x), y: Math.trunc(groupDelta.y) }
      pendingGroupDeltaRef.current = { groupId: groupDelta.groupId, x: groupDelta.x - whole.x, y: groupDelta.y - whole.y }
      if (whole.x !== 0 || whole.y !== 0) {
        moveGroupNodes(groupDelta.groupId, whole, { persist: false, emit: false })
      }
    }
    if (selectionDelta) {
      const whole = { x: Math.trunc(selectionDelta.x), y: Math.trunc(selectionDelta.y) }
      pendingSelectionDeltaRef.current = { x: selectionDelta.x - whole.x, y: selectionDelta.y - whole.y }
      if (whole.x !== 0 || whole.y !== 0) {
        moveSelectedNodes(whole, { persist: false, emit: false })
      }
    }
  }, [moveGroupNodes, moveSelectedNodes])

  const emitGroupDragSettled = React.useCallback((groupId: string) => {
    const state = useGenerationCanvasStore.getState()
    const group = state.groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    const nodeIds = new Set(group.nodeIds)
    const movedEvents = state.nodes
      .filter((node) => nodeIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
      .map((node) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: node.id, position: node.position } }))
    // 空框搬家一个节点都没动，但**框自己动了**（frameBounds 跟着 delta 走，见 moveGroupNodes）。
    // 以前这里按「没有 movedEvents 就当没发生」提前返回，于是空框的位移不进事件账。
    if (!movedEvents.length && !group.frameBounds) return
    emitCanvasGesture([...movedEvents, { type: 'canvas.group.updated', payload: { group } }])
  }, [])

  const emitSelectionDragSettled = React.useCallback(() => {
    const state = useGenerationCanvasStore.getState()
    const selected = new Set(state.selectedNodeIds)
    if (!selected.size) return
    const movedEvents = state.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: node.id, position: node.position } }))
    if (movedEvents.length) emitCanvasGesture(movedEvents)
  }, [])

  const requestDragMoveFrame = React.useCallback(() => {
    if (dragMoveFrameRef.current !== null) return
    dragMoveFrameRef.current = window.requestAnimationFrame(flushPendingDragMove)
  }, [flushPendingDragMove])

  const scheduleGroupMove = React.useCallback((groupId: string, delta: Delta) => {
    const pending = pendingGroupDeltaRef.current
    pendingGroupDeltaRef.current = pending && pending.groupId === groupId
      ? { groupId, x: pending.x + delta.x, y: pending.y + delta.y }
      : { groupId, x: delta.x, y: delta.y }
    requestDragMoveFrame()
  }, [requestDragMoveFrame])

  const scheduleSelectionMove = React.useCallback((delta: Delta) => {
    const pending = pendingSelectionDeltaRef.current
    pendingSelectionDeltaRef.current = pending ? { x: pending.x + delta.x, y: pending.y + delta.y } : delta
    requestDragMoveFrame()
  }, [requestDragMoveFrame])

  const flushScheduledDragMove = React.useCallback(() => {
    if (dragMoveFrameRef.current !== null) window.cancelAnimationFrame(dragMoveFrameRef.current)
    flushPendingDragMove()
  }, [flushPendingDragMove])

  React.useEffect(() => () => {
    if (dragMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(dragMoveFrameRef.current)
      dragMoveFrameRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (readOnly) return undefined
    const handleMove = (event: PointerEvent) => {
      const drag = draggingGroupRef.current
      const scale = zoomRef.current || 1
      if (drag) {
        const delta = { x: (event.clientX - drag.clientX) / scale, y: (event.clientY - drag.clientY) / scale }
        if (delta.x === 0 && delta.y === 0) return
        if (!drag.historyCaptured) {
          captureHistory()
          drag.historyCaptured = true
        }
        Object.assign(drag, { clientX: event.clientX, clientY: event.clientY, moved: true })
        setCanvasDragging(null, true, CANVAS_DRAGGING_OWNER.group) // 拖组框 = 组里的节点在动：浮层与拖单个节点一样收起
        scheduleGroupMove(drag.groupId, delta)
        return
      }
      const selectionDrag = draggingSelectionRef.current
      if (!selectionDrag) return
      const delta = {
        x: (event.clientX - selectionDrag.clientX) / scale,
        y: (event.clientY - selectionDrag.clientY) / scale,
      }
      if (delta.x === 0 && delta.y === 0) return
      if (!selectionDrag.historyCaptured) {
        captureHistory()
        selectionDrag.historyCaptured = true
      }
      Object.assign(selectionDrag, { clientX: event.clientX, clientY: event.clientY, moved: true })
      setCanvasDragging(null, true, CANVAS_DRAGGING_OWNER.selection)
      scheduleSelectionMove(delta)
    }
    const handleUp = () => {
      const drag = draggingGroupRef.current
      const selectionDrag = draggingSelectionRef.current
      if (drag) setCanvasDragging(null, false, CANVAS_DRAGGING_OWNER.group)
      if (selectionDrag) setCanvasDragging(null, false, CANVAS_DRAGGING_OWNER.selection)
      if (drag?.moved || selectionDrag?.moved) flushScheduledDragMove()
      if (drag) {
        draggingGroupRef.current = null
        if (drag.moved) {
          emitGroupDragSettled(drag.groupId)
          commitPersistedChange()
        }
      }
      if (selectionDrag) {
        draggingSelectionRef.current = null
        if (selectionDrag.moved) {
          emitSelectionDragSettled()
          commitPersistedChange()
        }
      }
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('blur', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('blur', handleUp)
    }
  }, [
    captureHistory,
    commitPersistedChange,
    emitGroupDragSettled,
    emitSelectionDragSettled,
    flushScheduledDragMove,
    readOnly,
    scheduleGroupMove,
    scheduleSelectionMove,
    zoomRef,
  ])

  const handleGroupFramePointerDown = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    groupId: string,
    options?: { selectMembers?: boolean },
  ) => {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const state = useGenerationCanvasStore.getState()
    const group = state.groups.find((candidate) => candidate.id === groupId)
    if (options?.selectMembers !== false && group?.nodeIds.length) {
      const groupNodeIds = new Set(group.nodeIds)
      const memberIds = state.nodes
        .filter((node) => groupNodeIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
        .map((node) => node.id)
      if (memberIds.length) selectNodes(memberIds)
    }
    // 新的一次拖动从零起账：上一次留下的亚像素余数不该跟着走（同一个框连拖两次时会）。
    pendingGroupDeltaRef.current = null
    draggingGroupRef.current = { groupId, clientX: event.clientX, clientY: event.clientY, moved: false, historyCaptured: false }
  }, [readOnly, selectNodes])

  const handleSelectionBoundsPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0 || selectedNodeCount < 2) return
    event.preventDefault()
    event.stopPropagation()
    pendingSelectionDeltaRef.current = null
    draggingSelectionRef.current = { clientX: event.clientX, clientY: event.clientY, moved: false, historyCaptured: false }
  }, [readOnly, selectedNodeCount])

  return { handleGroupFramePointerDown, handleSelectionBoundsPointerDown }
}
