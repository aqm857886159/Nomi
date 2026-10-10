import React from 'react'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { getUndoJournalGeneration } from '../events/canvasUndoJournal'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { CANVAS_DRAGGING_OWNER, beginCanvasDragging, type CanvasDragLease } from './canvasDraggingFlag'
import type { GenerationCanvasState } from '../store/canvasStoreTypes'

type DragRecord = {
  project: ProjectExecutionContext
  generation: number
  pointerId: number
  pointerCaptureTarget: HTMLElement
  lease?: CanvasDragLease
  clientX: number
  clientY: number
  moved: boolean
  historyCaptured: boolean
  totalDelta: Delta
  previewNodeIds?: string[]
}

/**
 * `duplicateOnMove`：按下时按着 Alt/⌥（Option + 拖动 = 复制，同画布惯例）。第一次真的移动时才复制——
 * 只点一下不拖不会凭空多出一个框（tldraw Translating.startCloning / Excalidraw 同样在移动时才复制）。
 */
type GroupDragRecord = DragRecord & {
  groupId: string
  duplicateOnMove: boolean
  memberIds: string[]
}
type Delta = { x: number; y: number }

function isDragTargetCurrent(drag: DragRecord): boolean {
  return !drag.project.signal.aborted && drag.generation === getUndoJournalGeneration()
}

type CanvasSelectionDragOptions = {
  readOnly: boolean
  selectedNodeCount: number
  zoomRef: React.MutableRefObject<number>
  captureHistory: GenerationCanvasState['captureHistory']
  commitPersistedChange: GenerationCanvasState['commitPersistedChange']
  moveGroupNodes: GenerationCanvasState['moveGroupNodes']
  moveSelectedNodes: GenerationCanvasState['moveSelectedNodes']
  selectNodes: GenerationCanvasState['selectNodes']
  /** 点中的框里没有可选的成员：框本身成为选区（交给框动作层记着，Delete / 菜单删它）。 */
  onSelectEmptyFrame?: (groupId: string | null) => void
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
  onSelectEmptyFrame,
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
   * 拖动期间只累计浮点 delta 并更新视觉 shell；节点/框的持久位置在共享 settle 边界一次性写回。
   * 这样既保留缩放下的亚像素余数，也不让每个 pointer sample 触发全图 store 订阅者和边投影。
   */
  const groupPreviewSelector = React.useCallback(
    (drag: GroupDragRecord) =>
      [
        `[data-group-id="${CSS.escape(drag.groupId)}"]`,
        // Keep React Flow's measured wrapper stationary during the preview. Moving
        // that wrapper makes its ResizeObserver recalculate every connected edge on
        // every pointer sample. The shell is the visual surface, so translating it
        // preserves the preview without invalidating edge anchors until commit.
        ...drag.memberIds.map(
          (id) => [
            `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__node-shell`,
            `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle`,
            `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle-hit`,
            `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle-icon`,
          ].join(','),
        ),
      ].join(','),
    [],
  )

  const clearGroupPreview = React.useCallback(
    (drag: GroupDragRecord) => {
      document.querySelectorAll<HTMLElement>(groupPreviewSelector(drag)).forEach((element) => {
        element.style.translate = ''
      })
    },
    [groupPreviewSelector],
  )

  const applyGroupPreview = React.useCallback(
    (drag: GroupDragRecord) => {
      const value = `${drag.totalDelta.x}px ${drag.totalDelta.y}px`
      document.querySelectorAll<HTMLElement>(groupPreviewSelector(drag)).forEach((element) => {
        element.style.translate = value
      })
    },
    [groupPreviewSelector],
  )

  const selectionPreviewSelector = React.useCallback(
    (drag: DragRecord) =>
      (drag.previewNodeIds ?? [])
        .map((id) => [
          `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__node-shell`,
          `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle`,
          `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle-hit`,
          `.react-flow__node[data-id="${CSS.escape(id)}"] .generation-canvas-react-flow__handle-icon`,
        ].join(','))
        .join(','),
    [],
  )

  const clearSelectionPreview = React.useCallback(
    (drag: DragRecord) => {
      const selector = selectionPreviewSelector(drag)
      if (!selector) return
      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        element.style.translate = ''
      })
    },
    [selectionPreviewSelector],
  )

  const applySelectionPreview = React.useCallback(
    (drag: DragRecord) => {
      const selector = selectionPreviewSelector(drag)
      if (!selector) return
      const value = `${drag.totalDelta.x}px ${drag.totalDelta.y}px`
      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        element.style.translate = value
      })
    },
    [selectionPreviewSelector],
  )

  const flushPendingDragMove = React.useCallback(() => {
    dragMoveFrameRef.current = null
    const drag = draggingGroupRef.current ?? draggingSelectionRef.current
    if (!drag || !isDragTargetCurrent(drag)) return
    const groupDelta = pendingGroupDeltaRef.current
    const selectionDelta = pendingSelectionDeltaRef.current
    if (groupDelta) {
      const drag = draggingGroupRef.current
      if (drag && drag.groupId === groupDelta.groupId) applyGroupPreview(drag)
      pendingGroupDeltaRef.current = null
    }
    if (selectionDelta) {
      const drag = draggingSelectionRef.current
      if (drag) applySelectionPreview(drag)
      pendingSelectionDeltaRef.current = null
    }
  }, [applyGroupPreview, applySelectionPreview])

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

  const scheduleGroupMove = React.useCallback(
    (groupId: string, delta: Delta) => {
      const pending = pendingGroupDeltaRef.current
      pendingGroupDeltaRef.current =
        pending && pending.groupId === groupId
          ? { groupId, x: pending.x + delta.x, y: pending.y + delta.y }
          : { groupId, x: delta.x, y: delta.y }
      requestDragMoveFrame()
    },
    [requestDragMoveFrame],
  )

  const scheduleSelectionMove = React.useCallback(
    (delta: Delta) => {
      const drag = draggingSelectionRef.current
      if (!drag) return
      drag.totalDelta.x += delta.x
      drag.totalDelta.y += delta.y
      pendingSelectionDeltaRef.current = { ...drag.totalDelta }
      requestDragMoveFrame()
    },
    [requestDragMoveFrame],
  )

  const flushScheduledDragMove = React.useCallback(() => {
    if (dragMoveFrameRef.current !== null) window.cancelAnimationFrame(dragMoveFrameRef.current)
    flushPendingDragMove()
  }, [flushPendingDragMove])

  const settleDrag = React.useCallback(() => {
    const group = draggingGroupRef.current
    const selection = draggingSelectionRef.current
    const drag = group ?? selection
    try {
      drag?.pointerCaptureTarget.releasePointerCapture(drag.pointerId)
    } catch {
      /* capture may already be released */
    }
    group?.lease?.release()
    selection?.lease?.release()
    // Group and selection previews stay in DOM/kernel geometry until this shared
    // settle boundary. Interruptions settle the original graph, never a newly
    // hydrated target.
    if (drag?.moved && isDragTargetCurrent(drag)) {
      flushScheduledDragMove()
      if (group) {
        moveGroupNodes(
          group.groupId,
          {
            x: Math.trunc(group.totalDelta.x),
            y: Math.trunc(group.totalDelta.y),
          },
          { persist: false, emit: false },
        )
        clearGroupPreview(group)
        emitGroupDragSettled(group.groupId)
      } else if (selection) {
        clearSelectionPreview(selection)
        const whole = { x: Math.trunc(selection.totalDelta.x), y: Math.trunc(selection.totalDelta.y) }
        if (whole.x !== 0 || whole.y !== 0) moveSelectedNodes(whole, { persist: false, emit: false })
        emitSelectionDragSettled()
      }
      commitPersistedChange()
    } else if (group) {
      clearGroupPreview(group)
    } else if (selection) {
      clearSelectionPreview(selection)
    }
    draggingGroupRef.current = null
    draggingSelectionRef.current = null
    if (dragMoveFrameRef.current !== null) window.cancelAnimationFrame(dragMoveFrameRef.current)
    dragMoveFrameRef.current = null
    pendingGroupDeltaRef.current = null
    pendingSelectionDeltaRef.current = null
  }, [
    clearGroupPreview,
    clearSelectionPreview,
    commitPersistedChange,
    emitGroupDragSettled,
    emitSelectionDragSettled,
    flushScheduledDragMove,
    moveGroupNodes,
    moveSelectedNodes,
  ])

  React.useEffect(() => {
    if (readOnly) return undefined
    const handleMove = (event: PointerEvent) => {
      const drag = draggingGroupRef.current
      const active = drag ?? draggingSelectionRef.current
      if (active && !isDragTargetCurrent(active)) {
        settleDrag()
        return
      }
      const scale = zoomRef.current || 1
      if (drag) {
        if (event.pointerId !== drag.pointerId) return
        const delta = { x: (event.clientX - drag.clientX) / scale, y: (event.clientY - drag.clientY) / scale }
        if (delta.x === 0 && delta.y === 0) return
        if (drag.duplicateOnMove) {
          drag.duplicateOnMove = false
          // 复制本身就是这次手势的撤销点（duplicateGroupForDrag 打了 barrier），后面的搬动不再另打。
          const copyId = useGenerationCanvasStore.getState().duplicateGroupForDrag(drag.groupId)
          if (copyId) {
            const copiedGroup = useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === copyId)
            Object.assign(drag, { groupId: copyId, memberIds: copiedGroup?.nodeIds ?? [], historyCaptured: true })
          }
        }
        if (!drag.historyCaptured) {
          captureHistory()
          drag.historyCaptured = true
        }
        Object.assign(drag, { clientX: event.clientX, clientY: event.clientY, moved: true })
        drag.totalDelta.x += delta.x
        drag.totalDelta.y += delta.y
        drag.lease?.activate() // 拖组框 = 组里的节点在动：浮层与拖单个节点一样收起
        scheduleGroupMove(drag.groupId, delta)
        return
      }
      const selectionDrag = draggingSelectionRef.current
      if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return
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
      selectionDrag.lease?.activate()
      scheduleSelectionMove(delta)
    }
    const handleUp = (event: PointerEvent) => {
      const active = draggingGroupRef.current ?? draggingSelectionRef.current
      if (!active || event.pointerId !== active.pointerId) return
      settleDrag()
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      settleDrag()
    }
  }, [
    settleDrag,
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

  const handleGroupFramePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, groupId: string, options?: { selectMembers?: boolean }) => {
      if (readOnly || event.button !== 0) return
      const project = withProjectAction((project) => project)
      if (!project) return
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* capture may be unavailable in headless DOMs */
      }
      settleDrag()
      const state = useGenerationCanvasStore.getState()
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (options?.selectMembers !== false && group) {
        const groupNodeIds = new Set(group.nodeIds)
        const memberIds = state.nodes
          .filter((node) => groupNodeIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
          .map((node) => node.id)
        // 空框：以前这里什么都不做，上一次的选区原样留着——点了空框再按 Delete，删掉的是别处的卡。
        // 现在点空框 = 选中这个框本身（节点选区清空），Delete / 菜单「删除」删的就是它。
        selectNodes(memberIds)
        onSelectEmptyFrame?.(memberIds.length ? null : groupId)
      } else if (group) {
        // 折叠编组卡（selectMembers:false）：成员藏在卡里，选区就是这张卡本身——走框选中态，
        // 于是出「+」圈（model/selectedGroup.ts）、Delete 删的是这个编组连同成员（一次撤销，2026-09-24 拍板）。
        selectNodes([])
        onSelectEmptyFrame?.(groupId)
      }
      // 新的一次拖动从零起账：上一次留下的亚像素余数不该跟着走（同一个框连拖两次时会）。
      pendingGroupDeltaRef.current = null
      draggingGroupRef.current = {
        project,
        generation: getUndoJournalGeneration(),
        lease: beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.group, {
          pointerId: event.pointerId,
          active: false,
          onCancel: settleDrag,
        }),
        pointerId: event.pointerId,
        pointerCaptureTarget: event.currentTarget,
        groupId,
        memberIds: group?.nodeIds ?? [],
        totalDelta: { x: 0, y: 0 },
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        historyCaptured: false,
        duplicateOnMove: event.altKey,
      }
    },
    [settleDrag, onSelectEmptyFrame, readOnly, selectNodes],
  )

  const handleSelectionBoundsPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || event.button !== 0 || selectedNodeCount < 2) return
      const project = withProjectAction((project) => project)
      if (!project) return
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* capture may be unavailable in headless DOMs */
      }
      settleDrag()
      draggingSelectionRef.current = {
        project,
        generation: getUndoJournalGeneration(),
        lease: beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.selection, {
          pointerId: event.pointerId,
          active: false,
          onCancel: settleDrag,
        }),
        pointerId: event.pointerId,
        pointerCaptureTarget: event.currentTarget,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        historyCaptured: false,
        totalDelta: { x: 0, y: 0 },
        previewNodeIds: [...useGenerationCanvasStore.getState().selectedNodeIds],
      }
    },
    [settleDrag, readOnly, selectedNodeCount],
  )

  return { handleGroupFramePointerDown, handleSelectionBoundsPointerDown }
}
