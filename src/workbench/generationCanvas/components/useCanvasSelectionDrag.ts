import React from 'react'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
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
  handleGroupFramePointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  handleSelectionBoundsPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const draggingGroupRef = React.useRef<GroupDragRecord | null>(null)
  const draggingSelectionRef = React.useRef<DragRecord | null>(null)
  const dragMoveFrameRef = React.useRef<number | null>(null)
  const pendingGroupDeltaRef = React.useRef<(Delta & { groupId: string }) | null>(null)
  const pendingSelectionDeltaRef = React.useRef<Delta | null>(null)

  const flushPendingDragMove = React.useCallback(() => {
    dragMoveFrameRef.current = null
    const groupDelta = pendingGroupDeltaRef.current
    const selectionDelta = pendingSelectionDeltaRef.current
    pendingGroupDeltaRef.current = null
    pendingSelectionDeltaRef.current = null
    if (groupDelta && (groupDelta.x !== 0 || groupDelta.y !== 0)) {
      moveGroupNodes(groupDelta.groupId, { x: groupDelta.x, y: groupDelta.y }, { persist: false, emit: false })
    }
    if (selectionDelta && (selectionDelta.x !== 0 || selectionDelta.y !== 0)) {
      moveSelectedNodes(selectionDelta, { persist: false, emit: false })
    }
  }, [moveGroupNodes, moveSelectedNodes])

  const emitGroupDragSettled = React.useCallback((groupId: string) => {
    const state = useGenerationCanvasStore.getState()
    const group = state.groups.find((candidate) => candidate.id === groupId)
    if (!group?.nodeIds.length) return
    const nodeIds = new Set(group.nodeIds)
    const movedEvents = state.nodes
      .filter((node) => nodeIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
      .map((node) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: node.id, position: node.position } }))
    if (!movedEvents.length) return
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
      scheduleSelectionMove(delta)
    }
    const handleUp = () => {
      const drag = draggingGroupRef.current
      const selectionDrag = draggingSelectionRef.current
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

  const handleGroupFramePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>, groupId: string) => {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const state = useGenerationCanvasStore.getState()
    const group = state.groups.find((candidate) => candidate.id === groupId)
    if (group?.nodeIds.length) {
      const groupNodeIds = new Set(group.nodeIds)
      const memberIds = state.nodes
        .filter((node) => groupNodeIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
        .map((node) => node.id)
      if (memberIds.length) selectNodes(memberIds)
    }
    draggingGroupRef.current = { groupId, clientX: event.clientX, clientY: event.clientY, moved: false, historyCaptured: false }
  }, [readOnly, selectNodes])

  const handleSelectionBoundsPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0 || selectedNodeCount < 2) return
    event.preventDefault()
    event.stopPropagation()
    draggingSelectionRef.current = { clientX: event.clientX, clientY: event.clientY, moved: false, historyCaptured: false }
  }, [readOnly, selectedNodeCount])

  return { handleGroupFramePointerDown, handleSelectionBoundsPointerDown }
}
