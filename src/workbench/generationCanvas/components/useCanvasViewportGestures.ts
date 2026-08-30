// 画布视口手势控制器（从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 收口三类输入（2026-07-31 用户拍板 #832，2026-08-03 补齐二选一，2026-08-08 平移改回默认手势）：
//   · 滚轮：**语义可配**（canvasGesturePreference）——默认缩放锚光标（ComfyUI 式），
//     可切成平移（Figma 式，给触控板党）；⌘/Ctrl+滚轮与捏合**两档恒缩放**。卡内可滚区放行原生滚动。
//   · 空白左键拖 = 平移（bubble 阶段接，节点/控件的 stopPropagation 先赢）；未超阈值的那一下算「点空白」，
//     由上层清空选区。Shift+左键留给 useMarqueeSelection 框选。
//   · 空格+左键拖 / 中键拖 / 右键拖 = 平移（capture 阶段接，压在节点上也生效；右键拖超阈值才吞掉右键菜单）。
// 同时托管视口变换原语（scheduleOffset / setViewportTransform / zoomAtStagePoint），
// 平移与离散缩放都走 rAF 批处理，消除快速输入的多次 setState 抖动。
import React from 'react'
import { clampNumber, getWheelZoomFactor } from './generationCanvasGeometry'
import { findScrollableAncestor } from './canvasScroll'
import { resolveWheelIntent, useCanvasGestureScheme } from '../../../utils/canvasGesturePreference'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from './canvasDraggingFlag'
import {
  createViewportAnimationCoordinator,
  type ViewportAnimationCoordinator,
} from './viewportAnimationCoordinator'
import type { ViewportAnimationSettlementOutcome } from './viewportAnimationSettlement'
import {
  canvasDragExceededThreshold,
  isCanvasCapturePanPointer,
  isCanvasMenuTarget,
  isCanvasPanButtonHeld,
  resolveCanvasPanButtonFromMove,
  shouldPreventDefaultForCanvasPanStart,
} from './canvasPointerGestureModel'

type Offset = { x: number; y: number }
type Viewport = { zoom: number; offset: Offset }

type UseCanvasViewportGesturesArgs = {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>
  setContextNodeMenu: (value: null) => void
  setActiveEdge: (value: null) => void
  activeEdgeId: string | null
}

export type CanvasViewportGestures = {
  scheduleOffset: (offset: Offset) => void
  setViewportTransform: (zoom: number, offset: Offset) => void
  animateViewportTo: (
    zoom: number,
    offset: Offset,
    duration?: number,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => void
  zoomAtStagePoint: (zoom: number, point: { x: number; y: number }) => void
  handlePointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  /** bubble 阶段的空白左键平移入口：由上层仲裁确认「这是画布空白」后才调。 */
  handleEmptyPanPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => boolean
  /** 返回 true 表示「这一下是空白点击（没拖动）」，上层据此清空选区。 */
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => boolean
  handlePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
  /** onContextMenu 先调它：右键拖平移后返回 true 表示该吞掉菜单 */
  shouldSuppressContextMenu: () => boolean
}

export function useCanvasViewportGestures({
  readOnly,
  stageRef,
  offsetRef,
  zoomRef,
  setViewport,
  setContextNodeMenu,
  setActiveEdge,
  activeEdgeId,
}: UseCanvasViewportGesturesArgs): CanvasViewportGestures {
  const offsetFrameRef = React.useRef<number | null>(null)
  const pendingOffsetRef = React.useRef<Offset | null>(null)
  const animationCoordinatorRef = React.useRef<ViewportAnimationCoordinator | null>(null)
  const isPanningRef = React.useRef(false)
  const panStartRef = React.useRef<{
    pointerId: number
    /** 按下点：只用来判「拖了没有」（4px 阈值 / 是不是一次点击），**不用来算位移**。 */
    clientX: number
    clientY: number
    /** 位移基准 = 上一次指针位置。增量而非「起点+总位移」，见 handlePointerMove 处注释。 */
    lastClientX: number
    lastClientY: number
    button: 0 | 1 | 2
    /** 空格发起的左键平移：松开空格要立刻收尾（裸左键平移不能被空格的 keyup 打断）。 */
    spaceInitiated: boolean
    moved: boolean
  } | null>(null)
  const lastPointerPositionRef = React.useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null)
  const activePointerButtonsRef = React.useRef(0)
  const suppressContextMenuRef = React.useRef(false)
  const spaceHeldRef = React.useRef(false)
  const gestureScheme = useCanvasGestureScheme()

  // 光标是**纯表现状态**，不进 React（2026-08-08 用户报「点一下空白，连线层按下松开各刷新一次」的根因：
  // 它原本是 useState → 每次按下/松开都让整个画布组件重渲 + 写属性 + 全 stage 子树重算样式，
  // 而它只干一件事：把光标从 grab 换成 grabbing）。
  //   · 左键（最高频）→ 交给 CSS `:active`，零 JS、零属性写入、零渲染。
  //   · 空格 / 中键 / 右键 → CSS 表达不了（空格没按键、:active 只认主键），补一个 data 属性，
  //     但走 imperative DOM 写，仍然不惊动 React。
  const setStagePanFlag = React.useCallback((attribute: 'data-panning' | 'data-space-pan', on: boolean) => {
    const stage = stageRef.current
    if (!stage) return
    if (on) stage.setAttribute(attribute, 'true')
    else stage.removeAttribute(attribute) // 属性本就不在时是 no-op，不会白白触发样式重算
  }, [stageRef])

  const resetPanState = React.useCallback(() => {
    isPanningRef.current = false
    setStagePanFlag('data-panning', false)
    setCanvasDragging(stageRef.current, false, CANVAS_DRAGGING_OWNER.viewport)
    panStartRef.current = null
    lastPointerPositionRef.current = null
  }, [setStagePanFlag, stageRef])

  const releaseSpace = React.useCallback(() => {
    if (!spaceHeldRef.current) return
    spaceHeldRef.current = false
    setStagePanFlag('data-space-pan', false)
  }, [setStagePanFlag])

  React.useEffect(() => {
    const coordinator = createViewportAnimationCoordinator({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
      readViewport: () => ({ zoom: zoomRef.current || 1, offset: { ...offsetRef.current } }),
      writeViewport: (next) => {
        zoomRef.current = next.zoom
        offsetRef.current = next.offset
        setViewport(next)
      },
      prepareForAnimation: () => {
        if (offsetFrameRef.current !== null) {
          window.cancelAnimationFrame(offsetFrameRef.current)
          offsetFrameRef.current = null
        }
        pendingOffsetRef.current = null
      },
    })
    animationCoordinatorRef.current = coordinator
    return () => {
      // StrictMode replays setup → cleanup → setup without another render. Only
      // the generation being cleaned may clear shared scheduled-offset state;
      // a late cleanup for an older generation must not tear down its successor.
      if (animationCoordinatorRef.current === coordinator) {
        animationCoordinatorRef.current = null
        if (offsetFrameRef.current !== null) {
          window.cancelAnimationFrame(offsetFrameRef.current)
          offsetFrameRef.current = null
        }
        pendingOffsetRef.current = null
      }
      coordinator.dispose()
    }
  }, [offsetRef, setViewport, zoomRef])

  const scheduleOffset = React.useCallback((nextOffset: Offset) => {
    // 任何手动平移先取得最新命令所有权。若旧动画的取消回调同步重入了更新动画，本次手动命令让路。
    const animationCoordinator = animationCoordinatorRef.current
    if (!animationCoordinator) return
    if (!animationCoordinator.takeOwnershipAndCancel()) return
    offsetRef.current = nextOffset
    pendingOffsetRef.current = nextOffset
    if (offsetFrameRef.current !== null) return
    offsetFrameRef.current = window.requestAnimationFrame(() => {
      offsetFrameRef.current = null
      const pending = pendingOffsetRef.current
      pendingOffsetRef.current = null
      if (pending) setViewport((current) => ({ ...current, offset: pending }))
    })
  }, [offsetRef, setViewport])

  const setViewportTransform = React.useCallback((nextZoom: number, nextOffset: Offset) => {
    const animationCoordinator = animationCoordinatorRef.current
    if (!animationCoordinator) return
    if (!animationCoordinator.takeOwnershipAndCancel()) return
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    pendingOffsetRef.current = null
    zoomRef.current = nextZoom
    offsetRef.current = nextOffset
    setViewport({ zoom: nextZoom, offset: nextOffset })
  }, [offsetRef, setViewport, zoomRef])

  // 离散跳转（适应视图 / 重置 / 聚焦节点）的平滑过渡：rAF 在 ~140ms（--nomi-transition-fast）
  // 内 easeOutCubic 插值 zoom+offset。连续控件（缩放条/捏合）不走这里，保持即时跟手。
  const animateViewportTo = React.useCallback((
    targetZoom: number,
    targetOffset: Offset,
    duration = 140,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => {
    animationCoordinatorRef.current?.animateTo(targetZoom, targetOffset, duration, onSettled)
  }, [])

  const zoomAtStagePoint = React.useCallback((nextZoom: number, point: { x: number; y: number }) => {
    const currentZoom = zoomRef.current || 1
    const currentOffset = offsetRef.current
    const zoomRatio = nextZoom / currentZoom
    setViewportTransform(nextZoom, {
      x: point.x - (point.x - currentOffset.x) * zoomRatio,
      y: point.y - (point.y - currentOffset.y) * zoomRatio,
    })
  }, [offsetRef, setViewportTransform, zoomRef])

  const finishPan = React.useCallback((pointerId?: number) => {
    resetPanState()
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    if (pendingOffsetRef.current) {
      const pending = pendingOffsetRef.current
      setViewport((current) => ({ ...current, offset: pending }))
      pendingOffsetRef.current = null
    }
    const stage = stageRef.current
    if (
      stage && pointerId !== undefined &&
      typeof stage.hasPointerCapture === 'function' &&
      typeof stage.releasePointerCapture === 'function' &&
      stage.hasPointerCapture(pointerId)
    ) {
      stage.releasePointerCapture(pointerId)
    }
  }, [resetPanState, setViewport, stageRef])

  React.useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      activePointerButtonsRef.current = event.buttons
      if (event.buttons === 0) lastPointerPositionRef.current = null
    }
    const handlePointerCancel = () => {
      activePointerButtonsRef.current = 0
      lastPointerPositionRef.current = null
    }
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [])

  // 空格按住 = 平移模式（光标 grab）。输入框/可编辑区放行，别抢空格输入。
  // 它不是「滚轮方案的一部分」，是正交的第四个平移入口：光标压在**节点上**时，除中键/右键外
  // 只有它能平移（空白左键拖此时会被节点接走）。故两档共用、不进设置。
  React.useEffect(() => {
    if (readOnly) return undefined
    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest(
        'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="menuitem"], .ProseMirror',
      ))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      if (isInteractiveTarget(event.target) && activePointerButtonsRef.current === 0) return
      if (!stageRef.current || stageRef.current.offsetParent === null) return
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true
        setStagePanFlag('data-space-pan', true)
      }
      event.preventDefault() // 否则空格会滚页 / 触发按钮
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      releaseSpace()
      if (panStartRef.current?.spaceInitiated) finishPan(panStartRef.current.pointerId)
    }
    const handleBlur = () => {
      releaseSpace()
      suppressContextMenuRef.current = false
      activePointerButtonsRef.current = 0
      if (panStartRef.current) finishPan(panStartRef.current.pointerId)
      else resetPanState()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur) // 切走窗口时松开，否则回来还卡在平移态
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [finishPan, readOnly, releaseSpace, resetPanState, setStagePanFlag, stageRef])

  const beginPan = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    button: 0 | 1 | 2,
    startPoint?: { clientX: number; clientY: number },
  ) => {
    setContextNodeMenu(null)
    setActiveEdge(null)
    suppressContextMenuRef.current = false
    isPanningRef.current = true
    // 裸左键平移不写属性：CSS `:active` 已经把光标切成 grabbing（见 stage 的 active:cursor-grabbing）。
    // 只有 CSS 认不出的入口（中键/右键/空格）才补属性，把高频路径的写入降到零。
    setStagePanFlag('data-panning', button !== 0 || spaceHeldRef.current)
    panStartRef.current = {
      pointerId: event.pointerId,
      clientX: startPoint?.clientX ?? event.clientX,
      clientY: startPoint?.clientY ?? event.clientY,
      lastClientX: startPoint?.clientX ?? event.clientX,
      lastClientY: startPoint?.clientY ?? event.clientY,
      button,
      spaceInitiated: button === 0 && spaceHeldRef.current,
      moved: false,
    }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 无活动指针时忽略 */ }
  }, [setActiveEdge, setContextNodeMenu, setStagePanFlag])

  // 空白左键平移（bubble 阶段）：走到这里说明上层仲裁已确认「命中的是画布空白」——
  // 节点、工具条、边命中区都在自己的 pointerdown 里 stopPropagation，压根到不了这。
  const handleEmptyPanPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault() // 挡掉原生的框选文本/拖图，光标不留残影
    beginPan(event, 0)
  }, [beginPan])

  // 捕获阶段：空格/中键/右键拖在节点之上也能平移（抢在节点 pointerdown 前）。
  const handlePointerDownCapture = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activePointerButtonsRef.current = event.buttons
    lastPointerPositionRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }
    if (isCanvasCapturePanPointer({ button: event.button, spaceHeld: spaceHeldRef.current })) {
      if (shouldPreventDefaultForCanvasPanStart(event.button)) event.preventDefault()
      event.stopPropagation()
      beginPan(event, event.button as 0 | 1 | 2)
      return
    }
    // 菜单（节点右键菜单 / 边菜单）都在 stage 里，而这是 capture 阶段：子项的 stopPropagation
    // 来不及拦。**两处收起都必须先问这一句**——否则 pointerdown 先卸载菜单，后续 click 无目标，
    // 表现为“改标签 / 断开 / 菜单项都没反应”。（曾只豁免了边菜单，节点菜单漏在上一行。）
    const menuTarget = isCanvasMenuTarget(event.target)
    if (event.button === 0 && !menuTarget) setContextNodeMenu(null)
    if (!activeEdgeId || menuTarget) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut, .generation-canvas-v2__edge-control')) return
    setActiveEdge(null)
  }, [activeEdgeId, beginPan, setActiveEdge, setContextNodeMenu])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activePointerButtonsRef.current = event.buttons
    const previousPoint = lastPointerPositionRef.current
    lastPointerPositionRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }
    if (
      isPanningRef.current && panStartRef.current &&
      !isCanvasPanButtonHeld(panStartRef.current.button, { buttons: event.buttons })
    ) {
      finishPan(event.pointerId)
      return false
    }
    if (!isPanningRef.current) {
      const panButton = resolveCanvasPanButtonFromMove({ buttons: event.buttons, spaceHeld: spaceHeldRef.current })
      if (panButton === null) return false
      beginPan(
        event,
        panButton,
        previousPoint?.pointerId === event.pointerId ? previousPoint : undefined,
      )
    }
    if (!panStartRef.current) return false
    const start = panStartRef.current
    if (!start.moved) {
      const exceededThreshold = canvasDragExceededThreshold(start.clientX, start.clientY, event.clientX, event.clientY)
      // 右键在阈值内不动画布，也**不推进基准**——超阈值那一刻要把这 4px 一次性补上（与右键菜单判定共用起点）。
      if (!exceededThreshold && start.button === 2) return true
      if (exceededThreshold) {
        start.moved = true
        // 真拖起来才升拖动态（点一下空白不升，否则又变成「点空白也在刷新」）。
        // 平移同样算「我在摆位置/找位置」：浮层一起收起（2026-08-09 用户拍板）。
        setCanvasDragging(stageRef.current, true, CANVAS_DRAGGING_OWNER.viewport)
        if (start.button === 2) suppressContextMenuRef.current = true // 右键拖→吞菜单
      }
    }
    // 位移用**增量**（当前 offset + 这一步指针位移），不是「按下时的 offset + 指针总位移」。
    // 根因（2026-08-08 用户报「按住左键滚轮缩放会抖」）：绝对式基准一旦被外部改写 offset 就过期——
    // 缩放锚光标时 zoomAtStagePoint 会修正 offset，而下一个 pointermove 又按老基准把它算回去，
    // 一滚一抹 = 每帧在两个位置间跳。增量式让平移天然继承任何外部改写（缩放/最小地图跳转/快捷键缩放）。
    const deltaX = event.clientX - start.lastClientX
    const deltaY = event.clientY - start.lastClientY
    start.lastClientX = event.clientX
    start.lastClientY = event.clientY
    scheduleOffset({ x: offsetRef.current.x + deltaX, y: offsetRef.current.y + deltaY })
    return true
  }, [beginPan, finishPan, offsetRef, scheduleOffset, stageRef])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activePointerButtonsRef.current = event.buttons
    lastPointerPositionRef.current = null
    if (!isPanningRef.current) return false
    // 没跨过 4px 阈值的裸左键平移 = 用户其实是「点了一下空白」。平移和点空白共用同一个手势，
    // 只能在抬手这一刻按位移分辨；分辨结果交给上层（清空选区不是视口层的职责）。
    const start = panStartRef.current
    const emptyClick = Boolean(start && start.button === 0 && !start.spaceInitiated && !start.moved)
    // document 级连线监听器会在 React stage handler 之后收到同一个 native pointerup。
    // 只标记会冲突的左键平移；右键必须保留默认 contextmenu 派发。
    if (event.button === 0) event.preventDefault()
    finishPan(event.pointerId)
    return emptyClick
  }, [finishPan])

  const handlePointerCancel = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activePointerButtonsRef.current = 0
    suppressContextMenuRef.current = false
    if (isPanningRef.current) finishPan(event.pointerId)
    else lastPointerPositionRef.current = null
  }, [finishPan])

  const shouldSuppressContextMenu = React.useCallback(() => {
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return true
    }
    return false
  }, [])

  // 滚轮 / 触控板：缩放还是平移由用户设置决定（#832 二选一）；⌘/Ctrl+滚轮与捏合恒缩放。
  const handleWheel = React.useCallback((event: WheelEvent) => {
    // 命中卡内可滚区（提示词编辑器等）→ 整个手势始终交给内部区域，画布不动（一处覆盖所有入口，P2）。
    // 内部到顶/到底也继续归内部；若在边界把手势交回画布，节点会突然缩放/平移出视野。
    // 捏合/⌘+滚轮（ctrlKey/metaKey）不放行——浏览器此时本来就不滚内容，仍走缩放。
    // 主轴判定在 findScrollableAncestor 内做（横/纵都支持），不在此处折成单轴 delta。
    if (
      !event.ctrlKey && !event.metaKey &&
      event.target instanceof Element &&
      findScrollableAncestor(event.target, stageRef.current, event.deltaX, event.deltaY)
    ) return
    event.preventDefault()
    setContextNodeMenu(null)
    if (resolveWheelIntent(gestureScheme, event) === 'pan') {
      // Shift+滚轮：把纵向滚动当横向（鼠标无横轴时的水平平移）
      const panX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const panY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      scheduleOffset({ x: offsetRef.current.x - panX, y: offsetRef.current.y - panY })
      return
    }
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const nextZoom = clampNumber(zoomRef.current * getWheelZoomFactor(event), 0.2, 3)
    zoomAtStagePoint(nextZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, [gestureScheme, offsetRef, scheduleOffset, setContextNodeMenu, stageRef, zoomAtStagePoint, zoomRef])

  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [handleWheel, stageRef])

  return {
    scheduleOffset,
    setViewportTransform,
    animateViewportTo,
    zoomAtStagePoint,
    handlePointerDownCapture,
    handleEmptyPanPointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    shouldSuppressContextMenu,
  }
}
