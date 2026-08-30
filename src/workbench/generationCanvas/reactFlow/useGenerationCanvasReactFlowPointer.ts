import React from 'react'
import type { Viewport } from '@xyflow/react'
import { canvasViewportFromFlow } from './generationCanvasReactFlowAdapter'
import { createPanZoomTakeoverReconciler } from './panZoomTakeoverReconciler'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from '../components/canvasDraggingFlag'

type CanvasStoredViewport = { zoom: number; offset: { x: number; y: number } }
type FlowViewportApi = {
  getViewport: () => Viewport
  setViewport: (viewport: Viewport, options?: { duration?: number }) => Promise<boolean>
}

type UseGenerationCanvasReactFlowPointerArgs = {
  readOnly: boolean
  hostRef: React.RefObject<HTMLDivElement>
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
    if (readOnly || event.pointerType === 'touch') return
    const isBlankPrimaryPan =
      event.button === 0 &&
      event.isPrimary &&
      !event.shiftKey &&
      !spaceHeldRef.current &&
      event.target instanceof Element &&
      Boolean(event.target.closest('.react-flow__pane'))
    if (isBlankPrimaryPan) {
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
    auxiliaryPanRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      button: event.button as 1 | 2,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture can be unavailable in test DOMs.
    }
  }, [readOnly])

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
    setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowPan)
    // React Flow's native drag listener may still apply this move after capture.
    // Reconcile once on the next frame so the delta has one final owner.
    nativePanReconciler.queueDelta({ x: deltaX, y: deltaY })
  }, [hostRef, nativePanReconciler])

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
        setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowPan)
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
  }, [flow, hostRef, setLiveViewport])

  const handleCanvasPointerEnd = React.useCallback(() => {
    const nativeLeftPan = nativeLeftPanRef.current
    nativeLeftPanRef.current = null
    if (nativeLeftPan?.takeoverAfterWheel) {
      setCanvasDragging(hostRef.current, false, CANVAS_DRAGGING_OWNER.reactFlowPan)
      const current = nativePanReconciler.flush() ?? flow.getViewport()
      setLiveViewport(current)
      rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(current))
    }
    const auxiliaryPan = auxiliaryPanRef.current
    if (auxiliaryPan) {
      auxiliaryPanRef.current = null
      setCanvasDragging(hostRef.current, false, CANVAS_DRAGGING_OWNER.reactFlowPan)
      const current = flow.getViewport()
      setLiveViewport(current)
      rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(current))
      try {
        hostRef.current?.releasePointerCapture(auxiliaryPan.pointerId)
      } catch {
        // Pointer capture can be unavailable in test DOMs.
      }
    }
    canvasPointerStartRef.current = null
  }, [activeCategoryId, flow, hostRef, nativePanReconciler, rememberCategoryViewport, setLiveViewport])

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
      if (auxiliaryPanRef.current) handleCanvasPointerEnd()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
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
