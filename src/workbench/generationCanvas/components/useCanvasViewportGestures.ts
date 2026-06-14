// 画布视口手势控制器（从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 收口三类输入为 Figma/tldraw 标准语义（2026-06-14 用户拍板）：
//   · 滚轮无修饰 = 平移（Shift 反转轴）；触控板双指滑同理（ctrlKey=false）。
//   · ⌘/Ctrl+滚轮 / 触控板捏合（浏览器合成 ctrlKey=true）= 缩放，锚在光标。
//   · 空格+拖 / 中键拖 / 右键拖 = 平移（右键拖超阈值才平移并吞掉右键菜单）。
// 同时托管视口变换原语（scheduleOffset / setViewportTransform / zoomAtStagePoint），
// 平移与离散缩放都走 rAF 批处理，消除快速输入的多次 setState 抖动。
import React from 'react'
import { clampNumber, getWheelZoomFactor } from './generationCanvasGeometry'
import { findScrollableAncestor } from './canvasScroll'

type Offset = { x: number; y: number }
type Viewport = { zoom: number; offset: Offset }

const PAN_CLICK_THRESHOLD = 4

type UseCanvasViewportGesturesArgs = {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>
  /** 左键点空白（未拖动）= 清空选择 */
  clearSelection: () => void
  cancelConnection: () => void
  pendingConnectionSourceId: string
  setContextNodeMenu: (value: null) => void
  setActiveEdge: (value: null) => void
  activeEdgeId: string | null
  /** 是否允许「左键拖空白」触发平移；B2 框选接管后传 false。 */
  allowLeftDragPan: boolean
}

export type CanvasViewportGestures = {
  isPanning: boolean
  isSpaceHeld: boolean
  scheduleOffset: (offset: Offset) => void
  setViewportTransform: (zoom: number, offset: Offset) => void
  animateViewportTo: (zoom: number, offset: Offset, duration?: number) => void
  zoomAtStagePoint: (zoom: number, point: { x: number; y: number }) => void
  handlePointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  /** onContextMenu 先调它：右键拖平移后返回 true 表示该吞掉菜单 */
  shouldSuppressContextMenu: () => boolean
}

export function useCanvasViewportGestures({
  readOnly,
  stageRef,
  offsetRef,
  zoomRef,
  setViewport,
  clearSelection,
  cancelConnection,
  pendingConnectionSourceId,
  setContextNodeMenu,
  setActiveEdge,
  activeEdgeId,
  allowLeftDragPan,
}: UseCanvasViewportGesturesArgs): CanvasViewportGestures {
  const offsetFrameRef = React.useRef<number | null>(null)
  const pendingOffsetRef = React.useRef<Offset | null>(null)
  const animFrameRef = React.useRef<number | null>(null)
  const isPanningRef = React.useRef(false)
  const panStartRef = React.useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number; button: number; moved: boolean } | null>(null)
  const suppressContextMenuRef = React.useRef(false)
  const spaceHeldRef = React.useRef(false)
  const [isPanning, setIsPanning] = React.useState(false)
  const [isSpaceHeld, setIsSpaceHeld] = React.useState(false)

  const cancelAnim = React.useCallback(() => {
    if (animFrameRef.current !== null) {
      window.cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  const scheduleOffset = React.useCallback((nextOffset: Offset) => {
    cancelAnim() // 任何手动平移立即接管，打断进行中的动画
    offsetRef.current = nextOffset
    pendingOffsetRef.current = nextOffset
    if (offsetFrameRef.current !== null) return
    offsetFrameRef.current = window.requestAnimationFrame(() => {
      offsetFrameRef.current = null
      const pending = pendingOffsetRef.current
      pendingOffsetRef.current = null
      if (pending) setViewport((current) => ({ ...current, offset: pending }))
    })
  }, [cancelAnim, offsetRef, setViewport])

  const setViewportTransform = React.useCallback((nextZoom: number, nextOffset: Offset) => {
    cancelAnim()
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    pendingOffsetRef.current = null
    zoomRef.current = nextZoom
    offsetRef.current = nextOffset
    setViewport({ zoom: nextZoom, offset: nextOffset })
  }, [cancelAnim, offsetRef, setViewport, zoomRef])

  // 离散跳转（适应视图 / 重置 / 聚焦节点）的平滑过渡：rAF 在 ~140ms（--nomi-transition-fast）
  // 内 easeOutCubic 插值 zoom+offset。连续控件（缩放条/捏合）不走这里，保持即时跟手。
  const animateViewportTo = React.useCallback((targetZoom: number, targetOffset: Offset, duration = 140) => {
    cancelAnim()
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    pendingOffsetRef.current = null
    const startZoom = zoomRef.current || 1
    const startOffset = { ...offsetRef.current }
    let startTs: number | null = null
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (ts: number) => {
      if (startTs === null) startTs = ts
      const progress = duration <= 0 ? 1 : Math.min(1, (ts - startTs) / duration)
      const e = ease(progress)
      const zoom = startZoom + (targetZoom - startZoom) * e
      const offset = {
        x: startOffset.x + (targetOffset.x - startOffset.x) * e,
        y: startOffset.y + (targetOffset.y - startOffset.y) * e,
      }
      zoomRef.current = zoom
      offsetRef.current = offset
      setViewport({ zoom, offset })
      animFrameRef.current = progress < 1 ? window.requestAnimationFrame(step) : null
    }
    animFrameRef.current = window.requestAnimationFrame(step)
  }, [cancelAnim, offsetRef, setViewport, zoomRef])

  const zoomAtStagePoint = React.useCallback((nextZoom: number, point: { x: number; y: number }) => {
    const currentZoom = zoomRef.current || 1
    const currentOffset = offsetRef.current
    const zoomRatio = nextZoom / currentZoom
    setViewportTransform(nextZoom, {
      x: point.x - (point.x - currentOffset.x) * zoomRatio,
      y: point.y - (point.y - currentOffset.y) * zoomRatio,
    })
  }, [offsetRef, setViewportTransform, zoomRef])

  React.useEffect(() => () => {
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    if (animFrameRef.current !== null) {
      window.cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  // 空格按住 = 平移模式（光标 grab）。输入框/可编辑区放行，别抢空格输入。
  React.useEffect(() => {
    if (readOnly) return undefined
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror'))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      if (isEditableTarget(event.target)) return
      if (!stageRef.current || stageRef.current.offsetParent === null) return
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true
        setIsSpaceHeld(true)
      }
      event.preventDefault() // 否则空格会滚页 / 触发按钮
    }
    const release = () => {
      if (!spaceHeldRef.current) return
      spaceHeldRef.current = false
      setIsSpaceHeld(false)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') release()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', release)
    }
  }, [readOnly, stageRef])

  const beginPan = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setContextNodeMenu(null)
    setActiveEdge(null)
    if (pendingConnectionSourceId && !readOnly) cancelConnection()
    isPanningRef.current = true
    setIsPanning(true)
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: offsetRef.current.x,
      offsetY: offsetRef.current.y,
      button: event.button,
      moved: false,
    }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 无活动指针时忽略 */ }
  }, [cancelConnection, offsetRef, pendingConnectionSourceId, readOnly, setActiveEdge, setContextNodeMenu])

  // 捕获阶段：空格/中键/右键拖在节点之上也能平移（抢在节点 pointerdown 前）。
  const handlePointerDownCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const wantsPan = spaceHeldRef.current || event.button === 1 || event.button === 2
    if (wantsPan) {
      event.preventDefault()
      event.stopPropagation()
      beginPan(event)
      return
    }
    // 旧逻辑：点空白处时收起已激活的连线高亮
    if (!activeEdgeId) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut')) return
    setActiveEdge(null)
  }, [activeEdgeId, beginPan, setActiveEdge])

  // 冒泡阶段：左键拖空白处。命中节点/工具条/控件则放行（return）。
  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isPanningRef.current) return
    setContextNodeMenu(null)
    setActiveEdge(null)
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(
      '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__minimap, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut, button, input, textarea, select, [role="menu"], [role="menuitem"]',
    )) {
      return
    }
    if (!allowLeftDragPan) return // B2 框选接管空白左键拖
    beginPan(event)
  }, [allowLeftDragPan, beginPan, setActiveEdge, setContextNodeMenu])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return
    const start = panStartRef.current
    if (!start.moved) {
      const dx = Math.abs(event.clientX - start.clientX)
      const dy = Math.abs(event.clientY - start.clientY)
      if (dx >= PAN_CLICK_THRESHOLD || dy >= PAN_CLICK_THRESHOLD) {
        start.moved = true
        if (start.button === 2) suppressContextMenuRef.current = true // 右键拖→吞菜单
      }
    }
    scheduleOffset({
      x: start.offsetX + (event.clientX - start.clientX),
      y: start.offsetY + (event.clientY - start.clientY),
    })
  }, [scheduleOffset])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (isPanningRef.current && start) {
      // 左键纯点击空白（未拖动）= 清空选择
      if (start.button === 0 && !start.moved) clearSelection()
    }
    isPanningRef.current = false
    setIsPanning(false)
    panStartRef.current = null
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    if (pendingOffsetRef.current) {
      const pending = pendingOffsetRef.current
      setViewport((current) => ({ ...current, offset: pending }))
      pendingOffsetRef.current = null
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [clearSelection, setViewport])

  const shouldSuppressContextMenu = React.useCallback(() => {
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return true
    }
    return false
  }, [])

  // 滚轮 / 触控板：ctrlKey/metaKey（含捏合合成）= 缩放；否则 = 平移。
  const handleWheel = React.useCallback((event: WheelEvent) => {
    const isZoom = event.ctrlKey || event.metaKey
    if (!isZoom) {
      // 命中卡内可滚区（提示词编辑器等）→ 交原生滚动，画布不动（一处覆盖所有入口，P2）。
      // 主轴判定在 findScrollableAncestor 内做（横/纵都支持），不在此处折成单轴 delta。
      if (event.target instanceof Element && findScrollableAncestor(event.target, stageRef.current, event.deltaX, event.deltaY)) return
      event.preventDefault()
      setContextNodeMenu(null)
      // Shift+滚轮：把纵向滚动当横向（鼠标无横轴时的水平平移）
      const panX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const panY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      scheduleOffset({ x: offsetRef.current.x - panX, y: offsetRef.current.y - panY })
      return
    }
    event.preventDefault()
    setContextNodeMenu(null)
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const nextZoom = clampNumber(zoomRef.current * getWheelZoomFactor(event), 0.2, 3)
    zoomAtStagePoint(nextZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, [offsetRef, scheduleOffset, setContextNodeMenu, stageRef, zoomAtStagePoint, zoomRef])

  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [handleWheel, stageRef])

  return {
    isPanning,
    isSpaceHeld,
    scheduleOffset,
    setViewportTransform,
    animateViewportTo,
    zoomAtStagePoint,
    handlePointerDownCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    shouldSuppressContextMenu,
  }
}
