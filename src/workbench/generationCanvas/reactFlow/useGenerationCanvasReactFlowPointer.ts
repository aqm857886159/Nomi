import { canvasWindowInput } from '../../shortcutSurface'
import { isCanvasMenuTarget } from '../components/canvasPointerGestureModel'
import React from 'react'
import type { Viewport } from '@xyflow/react'
import { canvasViewportFromFlow } from './generationCanvasReactFlowAdapter'
import { createPanZoomTakeoverReconciler } from './panZoomTakeoverReconciler'
import { CANVAS_DRAGGING_OWNER, beginCanvasDragging, type CanvasDragLease } from '../components/canvasDraggingFlag'

type CanvasStoredViewport = { zoom: number; offset: { x: number; y: number } }
type FlowViewportApi = {
  getViewport: () => Viewport
  setViewport: (viewport: Viewport, options?: { duration?: number }) => Promise<boolean>
}

type UseGenerationCanvasReactFlowPointerArgs = {
  readOnly: boolean
  hostRef: React.RefObject<HTMLDivElement | null>
  flow: FlowViewportApi
  activeCategoryId: string
  rememberCategoryViewport: (categoryId: string, viewport: CanvasStoredViewport) => void
  setLiveViewport: React.Dispatch<React.SetStateAction<Viewport>>
}

export function useGenerationCanvasReactFlowPointer({
  readOnly,
  hostRef,
  flow,
  activeCategoryId,
  rememberCategoryViewport,
  setLiveViewport,
}: UseGenerationCanvasReactFlowPointerArgs) {
  const panLeaseRef = React.useRef<CanvasDragLease | null>(null)
  const captureRef = React.useRef<{ target: HTMLDivElement; pointerId: number } | null>(null)
  const panOriginRef = React.useRef<HTMLDivElement | null>(null)
  const cancelPanRef = React.useRef<() => void>(() => {})
  const canvasPanMovedRef = React.useRef(false)
  const canvasPointerStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const spaceHeldRef = React.useRef(false)
  const auxiliaryPanRef = React.useRef<{
    pointerId: number
    lastX: number
    lastY: number
    button: 1 | 2
    moved: boolean
  } | null>(null)
  const nativeLeftPanRef = React.useRef<{
    pointerId: number
    lastX: number
    lastY: number
    takeoverAfterWheel: boolean
  } | null>(null)
  const nativePanReconciler = React.useMemo(() => createPanZoomTakeoverReconciler({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    readViewport: () => flow.getViewport(),
    writeViewport: (next) => {
      void flow.setViewport(next, { duration: 0 })
      setLiveViewport(next)
    },
  }), [flow, setLiveViewport])

  React.useEffect(() => () => nativePanReconciler.cancel(), [nativePanReconciler])

  const handleCanvasPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || !(event.target instanceof Element) || !event.target.closest('.react-flow__pane')) return
    canvasPointerStartRef.current = { x: event.clientX, y: event.clientY }
    canvasPanMovedRef.current = false
  }, [readOnly])

  const handleCanvasPointerDownCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.pointerType === 'touch' || isCanvasMenuTarget(event.target)) return
    const isBlankPrimaryPan =
      event.button === 0 &&
      event.isPrimary &&
      !event.shiftKey &&
      !spaceHeldRef.current &&
      event.target instanceof Element &&
      Boolean(event.target.closest('.react-flow__pane'))
    if (isBlankPrimaryPan) {
      cancelPanRef.current()
      panOriginRef.current = event.currentTarget
      panLeaseRef.current = beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.reactFlowPan, { pointerId: event.pointerId, active: false, onCancel: () => cancelPanRef.current() })
      // React Flow owns the ordinary left-drag until a wheel zoom interrupts it.
      // Its drag baseline is invalid after that zoom, so the host takes over the
      // remainder of this pointer gesture using the current viewport incrementally.
      nativeLeftPanRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        takeoverAfterWheel: false,
      }
      return
    }
    const isAuxiliaryPan = event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeldRef.current)
    if (!isAuxiliaryPan || !event.isPrimary) return
    event.preventDefault()
    event.stopPropagation()
    cancelPanRef.current()
    panOriginRef.current = event.currentTarget
    panLeaseRef.current = beginCanvasDragging(event.currentTarget, CANVAS_DRAGGING_OWNER.reactFlowPan, { pointerId: event.pointerId, active: false, onCancel: () => cancelPanRef.current() })
    captureRef.current = { target: event.currentTarget, pointerId: event.pointerId }
    auxiliaryPanRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      button: event.button as 1 | 2,
      moved: false,
    }
    // 中键 / 右键 / 空格+左键平移：CSS 的 `:active` 认不出这三种入口（它只跟主键走），
    // 光标会一直停在 grab 上，手已经在拖了画面却说「可以拖」。裸左键**不写**这个属性——
    // 它由 `:active` 管，写属性等于给整个 stage 子树白白排一次样式（旧内核同一处判据：
    // OLD useCanvasViewportGestures.ts:302 `button !== 0 || spaceHeld`）。
    hostRef.current?.setAttribute('data-panning', 'true')
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture can be unavailable in test DOMs.
    }
  }, [hostRef, readOnly])

  const handleCanvasPointerMoveCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const nativeLeftPan = nativeLeftPanRef.current
    if (!nativeLeftPan || nativeLeftPan.pointerId !== event.pointerId) return
    const deltaX = event.clientX - nativeLeftPan.lastX
    const deltaY = event.clientY - nativeLeftPan.lastY
    nativeLeftPan.lastX = event.clientX
    nativeLeftPan.lastY = event.clientY
    if (!nativeLeftPan.takeoverAfterWheel) return
    event.preventDefault()
    event.stopPropagation()
    if (deltaX === 0 && deltaY === 0) return
    canvasPanMovedRef.current = true
    panLeaseRef.current?.activate()
    // React Flow's native drag listener may still apply this move after capture.
    // Reconcile once on the next frame so the delta has one final owner.
    nativePanReconciler.queueDelta({ x: deltaX, y: deltaY })
  }, [nativePanReconciler])

  const handleCanvasWheelCapture = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const nativeLeftPan = nativeLeftPanRef.current
    if (!nativeLeftPan) return
    nativeLeftPan.lastX = event.clientX
    nativeLeftPan.lastY = event.clientY
    nativeLeftPan.takeoverAfterWheel = true
  }, [])

  const handleCanvasPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const auxiliaryPan = auxiliaryPanRef.current
    if (auxiliaryPan && auxiliaryPan.pointerId === event.pointerId) {
      event.preventDefault()
      const deltaX = event.clientX - auxiliaryPan.lastX
      const deltaY = event.clientY - auxiliaryPan.lastY
      const distance = Math.hypot(deltaX, deltaY)
      auxiliaryPan.lastX = event.clientX
      auxiliaryPan.lastY = event.clientY
      if (!auxiliaryPan.moved && distance >= 2) {
        auxiliaryPan.moved = true
        panLeaseRef.current?.activate()
      }
      if (deltaX === 0 && deltaY === 0) return
      const current = flow.getViewport()
      const next = { x: current.x + deltaX, y: current.y + deltaY, zoom: current.zoom }
      void flow.setViewport(next, { duration: 0 })
      setLiveViewport(next)
      return
    }
    const start = canvasPointerStartRef.current
    if (!start || canvasPanMovedRef.current) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 2) return
    canvasPanMovedRef.current = true
  }, [flow, setLiveViewport])

  const finishPan = React.useCallback((commit: boolean) => {
    const native = nativeLeftPanRef.current
    const auxiliary = auxiliaryPanRef.current
    nativeLeftPanRef.current = null
    auxiliaryPanRef.current = null
    canvasPointerStartRef.current = null
    panLeaseRef.current?.release()
    panLeaseRef.current = null
    panOriginRef.current?.removeAttribute('data-panning')
    panOriginRef.current = null
    const capture = captureRef.current
    captureRef.current = null
    // 一次平移只有两种收尾：提交 pending 的那一帧，或者丢掉它。**记不记视口不在这两者之列**——
    // 只要手真的把画布移过了，屏幕上的视口就已经变了，中断不会把它移回去
    // （`panZoomTakeoverReconciler.cancel()` 只丢还没应用的 delta，不回滚已应用的视口）。
    // 所以中断路径也必须把**当前真实视口**记下来：只丢不记 = 记住的 ≠ 屏幕上的，
    // 下次切分类回来、或任何视口同步 effect 跑一次，画布就跳回中断前的位置
    // （这正是 blur/pointercancel 之后「画布自己弹回去」的成因）。
    // 不选「中断就回滚」那一版：手一抖画布就弹回原处，比记住当前位置更难用。
    const panned = !readOnly && Boolean(native?.takeoverAfterWheel || auxiliary)
    const current = commit && panned ? (nativePanReconciler.flush() ?? flow.getViewport()) : (nativePanReconciler.cancel(), flow.getViewport())
    if (panned) {
      setLiveViewport(current)
      rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(current))
    }
    if (!commit) canvasPanMovedRef.current = false
    try { capture?.target.releasePointerCapture(capture.pointerId) } catch { /* capture may already be lost */ }
  }, [activeCategoryId, flow, nativePanReconciler, readOnly, rememberCategoryViewport, setLiveViewport])
  cancelPanRef.current = () => finishPan(false)
  const handleCanvasPointerEnd = React.useCallback((event?: { type: string; pointerId?: number }) => {
    const pointerId = auxiliaryPanRef.current?.pointerId ?? nativeLeftPanRef.current?.pointerId
    if (event?.pointerId !== undefined && pointerId !== undefined && event.pointerId !== pointerId) return
    finishPan(!event || event.type === 'pointerup')
  }, [finishPan])
  React.useEffect(() => () => cancelPanRef.current(), [activeCategoryId, readOnly])

  const shouldSuppressContextMenu = React.useCallback(() => {
    const auxiliaryPan = auxiliaryPanRef.current
    return Boolean(auxiliaryPan?.button === 2 && auxiliaryPan.moved)
  }, [])

  React.useEffect(() => {
    if (readOnly) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      spaceHeldRef.current = true
      hostRef.current?.setAttribute('data-space-pan', 'true')
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      spaceHeldRef.current = false
      hostRef.current?.removeAttribute('data-space-pan')
      if (auxiliaryPanRef.current) handleCanvasPointerEnd()
    }
    const handleBlur = () => {
      spaceHeldRef.current = false
      hostRef.current?.removeAttribute('data-space-pan')
      cancelPanRef.current()
    }
    canvasWindowInput.addEventListener('keydown', handleKeyDown)
    canvasWindowInput.addEventListener('keyup', handleKeyUp)
    canvasWindowInput.addEventListener('blur', handleBlur)
    return () => {
      canvasWindowInput.removeEventListener('keydown', handleKeyDown)
      canvasWindowInput.removeEventListener('keyup', handleKeyUp)
      canvasWindowInput.removeEventListener('blur', handleBlur)
      handleBlur()
    }
  }, [handleCanvasPointerEnd, hostRef, readOnly])

  return {
    canvasPanMovedRef,
    canvasPointerStartRef,
    handleCanvasPointerDown,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasWheelCapture,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
    shouldSuppressContextMenu,
  }
}
