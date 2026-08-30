// BaseGenerationNode 的拖拽 + 缩放交互（rAF 批处理 / 指针捕获 / 拖到时间轴 / 八向缩放）。
// 从 BaseGenerationNode.tsx 抽出为 hook；返回 4 个指针 handler。
//
// 拖动态只在**跨过拖拽阈值那一刻**升起（不是按下就升）：短按仍是点击，浮层不该闪一下。
// 升的是画布级标志（setCanvasDragging → stage 上一个 DOM 属性），拖任何节点都让**全部**节点的
// 工具条/提示词面板隐身（2026-08-08 起要求，2026-08-09 扩到全画布：拖 B 的时候 A 的面板也不该杵着）。
// 不进 React：可见性是 CSS 的事，位移本身仍走 ref + rAF。
import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { clientXToFrame } from '../../timeline/timelineEdit'
import { adoptGenerationNode } from '../../adoption/adoptGenerationNode'
import { reportAdoptionOutcome } from '../../adoption/adoptionReceipt'
import { toast } from '../../../ui/toast'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from '../components/canvasDraggingFlag'
import i18n from '../../../i18n'
import { useGenerationFlowNodeManagedDrag } from '../reactFlow/generationFlowNodeContext'
import {
  clampNumber,
  findTimelineDropTarget,
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  type NodeSizeBounds,
  type ResizeDirection,
} from './nodeSizing'

type StoreUpdate = (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: { persist?: boolean }) => void

type UseNodeDragResizeArgs = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly: boolean
  isMultiSelectActive: boolean
  sizeBounds: NodeSizeBounds
  visualSize: { width: number; height: number }
  selectNode: (nodeId: string, additive?: boolean) => void
  captureHistory: () => void
  moveNode: (
    nodeId: string,
    position: { x: number; y: number },
    options?: { persist?: boolean; emit?: boolean },
  ) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: { persist?: boolean; emit?: boolean }) => void
  updateNode: StoreUpdate
  commitPersistedChange: () => void
}

export function useNodeDragResize({
  node,
  selected,
  readOnly,
  isMultiSelectActive,
  sizeBounds,
  visualSize,
  selectNode,
  captureHistory,
  moveNode,
  moveSelectedNodes,
  updateNode,
  commitPersistedChange,
}: UseNodeDragResizeArgs) {
  const flowManagedDrag = useGenerationFlowNodeManagedDrag()
  const dragStartRef = React.useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    lastDeltaX: number
    lastDeltaY: number
    multi: boolean
    collapseSelectionOnClick: boolean
    dragging: boolean
  } | null>(null)
  const resizeStartRef = React.useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    width: number
    height: number
    direction: ResizeDirection
  } | null>(null)
  const moveFrameRef = React.useRef<number | null>(null)
  const pendingNodePositionRef = React.useRef<{
    x: number
    y: number
  } | null>(null)
  const pendingSelectedDeltaRef = React.useRef<{
    x: number
    y: number
  } | null>(null)

  const flushPendingMove = React.useCallback(() => {
    moveFrameRef.current = null
    const selectedDelta = pendingSelectedDeltaRef.current
    const nodePosition = pendingNodePositionRef.current
    pendingSelectedDeltaRef.current = null
    pendingNodePositionRef.current = null
    if (selectedDelta && (selectedDelta.x !== 0 || selectedDelta.y !== 0)) {
      moveSelectedNodes(selectedDelta, { persist: false, emit: false })
    }
    if (nodePosition) {
      moveNode(node.id, nodePosition, { persist: false, emit: false })
    }
  }, [moveNode, moveSelectedNodes, node.id])

  const emitDragSettled = React.useCallback(
    (multi: boolean) => {
      const state = useGenerationCanvasStore.getState()
      const selectedIds = new Set(state.selectedNodeIds)
      const movedEvents = state.nodes
        .filter((candidate) => (multi ? selectedIds.has(candidate.id) : candidate.id === node.id))
        .map((candidate) => ({
          type: 'canvas.node.moved' as const,
          payload: { nodeId: candidate.id, position: candidate.position },
        }))
      if (movedEvents.length) emitCanvasGesture(movedEvents)
    },
    [node.id],
  )

  const requestMoveFrame = React.useCallback(() => {
    if (moveFrameRef.current !== null) return
    moveFrameRef.current = window.requestAnimationFrame(flushPendingMove)
  }, [flushPendingMove])

  const scheduleNodeMove = React.useCallback(
    (position: { x: number; y: number }) => {
      pendingNodePositionRef.current = position
      requestMoveFrame()
    },
    [requestMoveFrame],
  )

  const scheduleSelectedMove = React.useCallback(
    (delta: { x: number; y: number }) => {
      const pending = pendingSelectedDeltaRef.current
      pendingSelectedDeltaRef.current = pending ? { x: pending.x + delta.x, y: pending.y + delta.y } : delta
      requestMoveFrame()
    },
    [requestMoveFrame],
  )

  const flushScheduledMove = React.useCallback(() => {
    if (moveFrameRef.current !== null) {
      window.cancelAnimationFrame(moveFrameRef.current)
    }
    flushPendingMove()
  }, [flushPendingMove])

  React.useEffect(
    () => () => {
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current)
        moveFrameRef.current = null
      }
    },
    [],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // In the React Flow PoC the outer node wrapper owns drag/selection. Leave
    // the event bubbling so React Flow can process it; the default canvas path
    // keeps the existing custom gesture implementation.
    if (flowManagedDrag) return
    const target = event.target as HTMLElement
    // C5 安全坑：放行 contenteditable / ProseMirror，否则点正文会被当成拖拽、吞掉光标。
    if (target.closest('button, input, textarea, select, [contenteditable="true"], .ProseMirror')) return
    // 视频不再整块拦截（原 `tagName==='VIDEO' return` 让视频节点拖不动也选不中——用户真机反馈）。
    // 放行 → 节点可拖可选、参数框正常弹；视频 play/pause 点击(无位移)仍工作(拖拽有位移阈值，dragging:false)。
    event.stopPropagation()
    if (readOnly) {
      selectNode(node.id, event.shiftKey)
      return
    }
    // ⚠️ 这里刻意【不】setPointerCapture。capture 一旦在按下时抢走，浏览器会把后续
    // pointerup/click 重定向到外壳 article，子元素的 click 默认行为整类死掉——
    // <label> 弹文件框（角色/场景/道具卡上传，2026-08-03 群反馈）、画板「打开」、3D 空态启动器
    // 都栽过同一坑。capture 只有「真拖起来」才需要（接住画布外的 move/up），推迟到
    // handlePointerMove 跨过拖拽阈值那一刻再抢（见 dragStart.dragging 翻 true 处）。
    captureHistory()
    const dragSelection = selected && isMultiSelectActive && !event.shiftKey
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: node.position.x,
      y: node.position.y,
      lastDeltaX: 0,
      lastDeltaY: 0,
      multi: dragSelection,
      collapseSelectionOnClick: dragSelection,
      dragging: false,
    }
    if (!dragSelection) selectNode(node.id, event.shiftKey)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (flowManagedDrag) return
    const resizeStart = resizeStartRef.current
    if (resizeStart) {
      const effectiveZoom = useGenerationCanvasStore.getState().canvasZoom || 1
      const deltaX = Math.round((event.clientX - resizeStart.pointerX) / effectiveZoom)
      const deltaY = Math.round((event.clientY - resizeStart.pointerY) / effectiveZoom)
      const pullsWest = resizeStart.direction.includes('w')
      const pullsEast = resizeStart.direction.includes('e')
      const pullsNorth = resizeStart.direction.includes('n')
      const pullsSouth = resizeStart.direction.includes('s')
      // Compute the stored media aspect ratio (image or video)
      const mediaAspect =
        typeof node.meta?.imageAspectRatio === 'number' && node.meta.imageAspectRatio > 0
          ? node.meta.imageAspectRatio
          : typeof node.meta?.videoAspectRatio === 'number' && node.meta.videoAspectRatio > 0
            ? node.meta.videoAspectRatio
            : null
      let nextWidth: number
      let nextHeight: number
      if (mediaAspect) {
        // 等比缩放：任意把手（含四角/上下边）都锁图片比例，拉完不留空框。
        // 水平把手（含四角）以宽为主导，纯上下把手以高为主导；触界时按比例回算另一维。
        if (pullsEast || pullsWest) {
          nextWidth = clampNumber(
            pullsWest ? resizeStart.width - deltaX : resizeStart.width + deltaX,
            MIN_NODE_WIDTH,
            MAX_NODE_WIDTH,
          )
          nextHeight = Math.round(nextWidth / mediaAspect)
          if (nextHeight < MIN_NODE_HEIGHT || nextHeight > MAX_NODE_HEIGHT) {
            nextHeight = clampNumber(nextHeight, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT)
            nextWidth = clampNumber(Math.round(nextHeight * mediaAspect), MIN_NODE_WIDTH, MAX_NODE_WIDTH)
          }
        } else {
          nextHeight = clampNumber(
            pullsNorth ? resizeStart.height - deltaY : resizeStart.height + deltaY,
            MIN_NODE_HEIGHT,
            MAX_NODE_HEIGHT,
          )
          nextWidth = Math.round(nextHeight * mediaAspect)
          if (nextWidth < MIN_NODE_WIDTH || nextWidth > MAX_NODE_WIDTH) {
            nextWidth = clampNumber(nextWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
            nextHeight = clampNumber(Math.round(nextWidth / mediaAspect), MIN_NODE_HEIGHT, MAX_NODE_HEIGHT)
          }
        }
      } else {
        // 无媒体比例（未生成 / text 节点）：自由拉伸，按 kind 的 bounds clamp。
        nextWidth = pullsWest
          ? clampNumber(resizeStart.width - deltaX, sizeBounds.minWidth, sizeBounds.maxWidth)
          : pullsEast
            ? clampNumber(resizeStart.width + deltaX, sizeBounds.minWidth, sizeBounds.maxWidth)
            : resizeStart.width
        nextHeight = pullsNorth
          ? clampNumber(resizeStart.height - deltaY, sizeBounds.minHeight, sizeBounds.maxHeight)
          : pullsSouth
            ? clampNumber(resizeStart.height + deltaY, sizeBounds.minHeight, sizeBounds.maxHeight)
            : resizeStart.height
      }
      updateNode(
        node.id,
        {
          position: {
            x: pullsWest ? resizeStart.x + resizeStart.width - nextWidth : resizeStart.x,
            y: pullsNorth ? resizeStart.y + resizeStart.height - nextHeight : resizeStart.y,
          },
          size: {
            width: nextWidth,
            height: nextHeight,
          },
          meta: {
            ...(node.meta || {}),
            userResized: true,
            previewHeight: nextHeight,
          },
        },
        { persist: false },
      )
      return
    }
    const dragStart = dragStartRef.current
    if (!dragStart) return
    // capture 推迟后，「阈值内松手在画布外」会收不到 pointerup——按键已松的残留 move 必须清态，
    // 否则节点会无按键跟着光标跑。
    if (event.buttons === 0) {
      dragStartRef.current = null
      setCanvasDragging(event.currentTarget, false, CANVAS_DRAGGING_OWNER.node)
      return
    }
    const effectiveZoom = useGenerationCanvasStore.getState().canvasZoom || 1
    const deltaX = Math.round((event.clientX - dragStart.pointerX) / effectiveZoom)
    const deltaY = Math.round((event.clientY - dragStart.pointerY) / effectiveZoom)
    if (!dragStart.dragging) {
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
      dragStart.dragging = true
      setCanvasDragging(event.currentTarget, true, CANVAS_DRAGGING_OWNER.node) // 真开拖：全画布的浮条/提示词面板一起收起

      // 真开拖这一刻才抢 capture：从此 move/up 稳定送达外壳（可拖出画布），且 click 会被
      // 重定向到外壳=拖完不会误触子元素（label 不弹文件框）。短按（阈值内）永远不 capture，
      // 子元素 click 默认行为（弹文件框/按钮）完好——这是「短按点、长按拖」两全的机制保证。
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }
    event.preventDefault()
    event.stopPropagation()
    if (dragStart.multi) {
      scheduleSelectedMove({
        x: deltaX - dragStart.lastDeltaX,
        y: deltaY - dragStart.lastDeltaY,
      })
      dragStart.lastDeltaX = deltaX
      dragStart.lastDeltaY = deltaY
      return
    }
    scheduleNodeMove({
      x: Math.round(dragStart.x + deltaX),
      y: Math.round(dragStart.y + deltaY),
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (flowManagedDrag) return
    flushScheduledMove()
    const dragStart = dragStartRef.current
    const hadResize = Boolean(resizeStartRef.current)
    const droppedOverTimeline = dragStart?.dragging ? findTimelineDropTarget(event.clientX, event.clientY) : null
    const timelineDropTarget = droppedOverTimeline && node.result?.url ? droppedOverTimeline : null
    // 用户把还没生成画面的节点拖到时间轴：给反馈，别静默弹回（P0-9 / I-1）。
    if (droppedOverTimeline && !node.result?.url) {
      toast(i18n.t('generationCommon.node.generateBeforeTimeline'), 'info')
    }
    if (timelineDropTarget) {
      const timeline = useWorkbenchStore.getState().timeline
      const liveNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id) || node
      const rect = timelineDropTarget.getBoundingClientRect()
      const startFrame = clientXToFrame(event.clientX, rect.left, timeline.scale)
      // P5 E1：拖到自选位置也走采纳桥（不再直写轴）。落点语义由 placement 带过去，
      // 幂等 / 新鲜度 / 原子写 / 一步撤销统一由桥负责。拖拽时用户已经在看着轴，回执不再展开面板。
      void adoptGenerationNode(liveNode, { placement: { kind: 'frame', startFrame } }).then((outcome) => {
        reportAdoptionOutcome(outcome, { revealTimeline: false })
        if (!dragStart?.multi) {
          moveNode(
            node.id,
            {
              x: dragStart?.x ?? node.position.x,
              y: dragStart?.y ?? node.position.y,
            },
            { persist: false, emit: false },
          )
        }
      })
    }
    if (dragStart?.dragging || hadResize) {
      if (dragStart?.dragging) emitDragSettled(dragStart.multi)
      commitPersistedChange()
    }
    if (dragStart && !dragStart.dragging && dragStart.collapseSelectionOnClick) {
      selectNode(node.id, false)
    }
    dragStartRef.current = null
    resizeStartRef.current = null
    if (dragStart?.dragging) setCanvasDragging(event.currentTarget, false, CANVAS_DRAGGING_OWNER.node)
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResizePointerDown = (direction: ResizeDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (flowManagedDrag) return
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    captureHistory()
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: node.position.x,
      y: node.position.y,
      width: visualSize.width,
      height: visualSize.height,
      direction,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
  return { flowManagedDrag, handlePointerDown, handlePointerMove, handlePointerUp, handleResizePointerDown }
}
