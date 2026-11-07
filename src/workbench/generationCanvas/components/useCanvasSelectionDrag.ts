import { canvasWindowInput } from '../../shortcutSurface'
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
  /**
   * 预览要平移的 DOM 元素：按下时解析一次并持有，帧内只写 `style.translate`，不再做任何全局查询
   * （每帧一次 241 个分支的 `querySelectorAll` 曾占拖组框可归因耗时的 96%，P-dragframe）。
   * `null` = 还没解析（复制拖动换了新框，等新框渲染出来再解析一次）。
   */
  previewElements: HTMLElement[] | null
  resolveAttempts: number
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

// Keep React Flow's measured wrapper stationary during the preview. Moving that wrapper makes its
// ResizeObserver recalculate every connected edge on every pointer sample. The shell is the visual
// surface, so translating it preserves the preview without invalidating edge anchors until commit.
const NODE_PREVIEW_PARTS = [
  '.generation-canvas-react-flow__node-shell',
  '.generation-canvas-react-flow__handle',
  '.generation-canvas-react-flow__handle-hit',
  '.generation-canvas-react-flow__handle-icon',
]
const MAX_RESOLVE_ATTEMPTS = 8

/** 全文件唯一的 DOM 查询：只在手势开始（或复制拖动换框）时调用，不在帧内调用。 */
function resolvePreviewElements(groupId: string, nodeIds: readonly string[]): HTMLElement[] {
  const selectors = [
    `[data-group-id="${CSS.escape(groupId)}"]`,
    ...nodeIds.flatMap((id) =>
      NODE_PREVIEW_PARTS.map((part) => `.react-flow__node[data-id="${CSS.escape(id)}"] ${part}`),
    ),
  ]
  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
}

function resolveDragPreview(drag: GroupDragRecord): void {
  const found = resolvePreviewElements(drag.groupId, drag.memberIds)
  drag.resolveAttempts += 1
  // 复制拖动：新框的 DOM 要等 React 渲染；框本身还没出现就下一帧再解析（有上限，找不到就不预览）。
  if (!found.some((element) => element.dataset.groupId === drag.groupId) && drag.resolveAttempts < MAX_RESOLVE_ATTEMPTS) return
  drag.previewElements = found
}

function applyDragPreview(drag: GroupDragRecord): void {
  if (!drag.previewElements) resolveDragPreview(drag)
  const elements = drag.previewElements
  if (!elements) return
  const value = `${drag.totalDelta.x}px ${drag.totalDelta.y}px`
  let gone = 0
  for (const element of elements) {
    // 拖动途中被卸载的节点：引用失效，跳过、不报错（落点位置由 store 的 settle 决定，与 DOM 无关）。
    if (!element.isConnected) gone += 1
    else element.style.translate = value
  }
  if (gone) drag.previewElements = elements.filter((element) => element.isConnected)
}

function clearDragPreview(drag: GroupDragRecord): void {
  for (const element of drag.previewElements ?? []) if (element.isConnected) element.style.translate = ''
  drag.previewElements = null
}

function isDragTargetCurrent(drag: DragRecord): boolean {
  return !drag.project.signal.aborted && drag.generation === getUndoJournalGeneration()
}

type CanvasSelectionDragOptions = {
  readOnly: boolean
  zoomRef: React.MutableRefObject<number>
  captureHistory: GenerationCanvasState['captureHistory']
  commitPersistedChange: GenerationCanvasState['commitPersistedChange']
  moveGroupNodes: GenerationCanvasState['moveGroupNodes']
  selectNodes: GenerationCanvasState['selectNodes']
  /** 点中的框里没有可选的成员：框本身成为选区（交给框动作层记着，Delete / 菜单删它）。 */
  onSelectEmptyFrame?: (groupId: string | null) => void
}

/** 拖组框：唯一的入口（原「选区框拖动」在生产代码里从未接上，已删）。 */
export function useCanvasSelectionDrag({
  readOnly,
  zoomRef,
  captureHistory,
  commitPersistedChange,
  moveGroupNodes,
  selectNodes,
  onSelectEmptyFrame,
}: CanvasSelectionDragOptions): {
  handleGroupFramePointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    groupId: string,
    options?: { selectMembers?: boolean },
  ) => void
} {
  const draggingGroupRef = React.useRef<GroupDragRecord | null>(null)
  const dragMoveFrameRef = React.useRef<number | null>(null)
  const pendingGroupDeltaRef = React.useRef<(Delta & { groupId: string }) | null>(null)

  const flushPendingDragMove = React.useCallback(() => {
    dragMoveFrameRef.current = null
    const drag = draggingGroupRef.current
    if (!drag || !isDragTargetCurrent(drag)) return
    const groupDelta = pendingGroupDeltaRef.current
    if (groupDelta) {
      if (drag.groupId === groupDelta.groupId) applyDragPreview(drag)
      pendingGroupDeltaRef.current = null
    }
  }, [])

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

  const flushScheduledDragMove = React.useCallback(() => {
    if (dragMoveFrameRef.current !== null) window.cancelAnimationFrame(dragMoveFrameRef.current)
    flushPendingDragMove()
  }, [flushPendingDragMove])

  const settleDrag = React.useCallback(() => {
    const group = draggingGroupRef.current
    try {
      group?.pointerCaptureTarget.releasePointerCapture(group.pointerId)
    } catch {
      /* capture may already be released */
    }
    group?.lease?.release()
    // The preview stays in DOM geometry until this shared settle boundary.
    // Interruptions settle the original graph, never a newly hydrated target.
    if (group?.moved && isDragTargetCurrent(group)) {
      flushScheduledDragMove()
      moveGroupNodes(
        group.groupId,
        {
          x: Math.trunc(group.totalDelta.x),
          y: Math.trunc(group.totalDelta.y),
        },
        { persist: false, emit: false },
      )
      clearDragPreview(group)
      emitGroupDragSettled(group.groupId)
      commitPersistedChange()
    } else if (group) {
      clearDragPreview(group)
    }
    draggingGroupRef.current = null
    if (dragMoveFrameRef.current !== null) window.cancelAnimationFrame(dragMoveFrameRef.current)
    dragMoveFrameRef.current = null
    pendingGroupDeltaRef.current = null
  }, [commitPersistedChange, emitGroupDragSettled, flushScheduledDragMove, moveGroupNodes])

  React.useEffect(() => {
    if (readOnly) return undefined
    const handleMove = (event: PointerEvent) => {
      const drag = draggingGroupRef.current
      if (!drag) return
      if (!isDragTargetCurrent(drag)) {
        settleDrag()
        return
      }
      if (event.pointerId !== drag.pointerId) return
      const scale = zoomRef.current || 1
      const delta = { x: (event.clientX - drag.clientX) / scale, y: (event.clientY - drag.clientY) / scale }
      if (delta.x === 0 && delta.y === 0) return
      if (drag.duplicateOnMove) {
        drag.duplicateOnMove = false
        // 复制本身就是这次手势的撤销点（duplicateGroupForDrag 打了 barrier），后面的搬动不再另打。
        const copyId = useGenerationCanvasStore.getState().duplicateGroupForDrag(drag.groupId)
        if (copyId) {
          const copiedGroup = useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === copyId)
          Object.assign(drag, {
            groupId: copyId,
            memberIds: copiedGroup?.nodeIds ?? [],
            historyCaptured: true,
            previewElements: null,
            resolveAttempts: 0,
          })
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
    }
    const handleUp = (event: PointerEvent) => {
      const active = draggingGroupRef.current
      if (!active || event.pointerId !== active.pointerId) return
      settleDrag()
    }
    canvasWindowInput.addEventListener('pointermove', handleMove)
    canvasWindowInput.addEventListener('pointerup', handleUp)
    return () => {
      canvasWindowInput.removeEventListener('pointermove', handleMove)
      canvasWindowInput.removeEventListener('pointerup', handleUp)
      settleDrag()
    }
  }, [settleDrag, captureHistory, readOnly, scheduleGroupMove, zoomRef])

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
        previewElements: null,
        resolveAttempts: 0,
      }
      resolveDragPreview(draggingGroupRef.current)
    },
    [settleDrag, onSelectEmptyFrame, readOnly, selectNodes],
  )

  return { handleGroupFramePointerDown }
}
