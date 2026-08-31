// 画布 stage 指针交互总入口（合并视口手势 + 框选）。
// 把 useCanvasViewportGestures（平移/缩放）与 useMarqueeSelection（框选）组合成一组
// stage handler，让 GenerationCanvas 只挂一处、不必关心二者分工：
//   · capture 阶段：空格/中键/右键平移抢在节点之前（gestures）。
//   · bubble 阶段：**这里是唯一的仲裁点**——空白左键拖=平移、Shift+左键拖=框选、
//     空白左键点一下（没超阈值）=清空选区。命中节点/控件的事件根本到不了这（它们自己 stopPropagation）。
import React from 'react'
import { resolveCanvasPointerDownAction, isCanvasInteractiveTarget } from './canvasPointerGestureModel'
import { useCanvasViewportGestures } from './useCanvasViewportGestures'
import { useMarqueeSelection, type MarqueeRect } from './useMarqueeSelection'

type Offset = { x: number; y: number }

type Args = {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  setViewport: React.Dispatch<React.SetStateAction<{ zoom: number; offset: Offset }>>
  activeCategoryId: string
  clearSelection: () => void
  setContextNodeMenu: (value: null) => void
  setActiveEdge: (value: null) => void
  activeEdgeId: string | null
  selectNodesInRect: (rect: { x1: number; y1: number; x2: number; y2: number }, categoryId?: string, additive?: boolean) => void
}

export type CanvasPointerInteractions = {
  marqueeRect: MarqueeRect | null
  setViewportTransform: (zoom: number, offset: Offset) => void
  animateViewportTo: (zoom: number, offset: Offset, duration?: number) => void
  zoomAtStagePoint: (zoom: number, point: { x: number; y: number }) => void
  shouldSuppressContextMenu: () => boolean
  onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
}

export function useCanvasPointerInteractions(args: Args): CanvasPointerInteractions {
  const gestures = useCanvasViewportGestures({
    readOnly: args.readOnly,
    stageRef: args.stageRef,
    offsetRef: args.offsetRef,
    zoomRef: args.zoomRef,
    setViewport: args.setViewport,
    setContextNodeMenu: args.setContextNodeMenu,
    setActiveEdge: args.setActiveEdge,
    activeEdgeId: args.activeEdgeId,
  })
  const marquee = useMarqueeSelection({
    stageRef: args.stageRef,
    offsetRef: args.offsetRef,
    zoomRef: args.zoomRef,
    activeCategoryId: args.activeCategoryId,
    selectNodesInRect: args.selectNodesInRect,
  })
  const { readOnly, clearSelection } = args

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // spaceHeld 恒传 false：空格档已在 capture 阶段接走并 stopPropagation，走不到这。
    const action = resolveCanvasPointerDownAction({
      button: event.button,
      spaceHeld: false,
      shiftKey: event.shiftKey,
      interactiveTarget: isCanvasInteractiveTarget(event.target),
      readOnly,
    })
    if (action === 'pan') gestures.handleEmptyPanPointerDown(event)
    else if (action === 'marquee') marquee.handlePointerDown(event)
  }, [gestures, marquee, readOnly])
  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panOwnsPointer = gestures.handlePointerMove(event)
    if (panOwnsPointer) {
      marquee.cancel()
      return
    }
    marquee.handlePointerMove(event)
  }, [gestures, marquee])
  const onPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // 「拖动画布」与「点空白取消选中」是同一个手势，抬手时才分得开（见 gestures.handlePointerUp）。
    const emptyClick = gestures.handlePointerUp(event)
    if (emptyClick && !readOnly) clearSelection()
    marquee.handlePointerUp(event)
  }, [clearSelection, gestures, marquee, readOnly])
  const onPointerCancel = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    gestures.handlePointerCancel(event)
    marquee.handlePointerCancel(event)
  }, [gestures, marquee])

  return {
    marqueeRect: marquee.marqueeRect,
    setViewportTransform: gestures.setViewportTransform,
    animateViewportTo: gestures.animateViewportTo,
    zoomAtStagePoint: gestures.zoomAtStagePoint,
    shouldSuppressContextMenu: gestures.shouldSuppressContextMenu,
    onPointerDownCapture: gestures.handlePointerDownCapture,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
