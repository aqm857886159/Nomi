import React from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { createViewportAnimationCoordinator, type ViewportAnimationCoordinator } from '../components/viewportAnimationCoordinator'
import type { ViewportAnimationSettlementOutcome } from '../components/viewportAnimationSettlement'
import { logRendererError } from '../../../desktop/rendererLog'

type Offset = { x: number; y: number }
type FlowViewport = { x: number; y: number; zoom: number }

/**
 * 画布视口动画的唯一入口。2026-09-25 起它只服务**用户自己点出来的**移动：适应视图、复位、
 * 定位（侧栏 / 定位来源 / 通知跳转）、画布边缘提示。程序不再为「新建露出 / 落地适应 / 复制后聚焦」
 * 主动移动画布（用户拍板），所以原来为「连续自动露出、撤销时退回」而记的目标追踪器已删除。
 *
 * 为什么是自研的逐帧直写，而**不用** React Flow 自带的 `setViewport({ duration })`（2026-09-25 复核
 * `@xyflow/system 0.0.81` + `d3-zoom 3.0.0` 源码，仍成立）：带时长的移动走 d3-zoom 过渡，每一帧用面板
 * 宽度做除数（`d3-zoom/src/zoom.js` schedule：`k = w / l[2]`），而这个宽度是 XYPanZoom 用 ResizeObserver
 * 缓存的（`@xyflow/system` XYPanZoom 的 cachedExtent）。面板只要有一帧量成 0×0（「创作」页藏着画布、
 * 切分类重挂），每帧就算出 NaN，React Flow 把所有节点判不可见——画布整片空白、节点却还在（走查约 30% 复现）。
 * 直写 duration=0 不经过插值，也不读那份缓存。退出条件：上游在 w=0 时不再产出 NaN，就改回框架自带并删掉
 * viewportAnimationCoordinator（记在 docs/fixes/2026-09-25-canvas-no-auto-viewport.root-cause.json）。
 *
 * 逐帧直写会让 React Flow 每一帧都报一次「移动结束」。落盘方用 `isViewportAnimating` 跳过中间帧，
 * 动画走完时由 `onAnimationSettled` 记一次（`GenerationCanvasReactFlowViewport` 的 onMoveEnd）。
 */
export function useReactFlowViewportAnimation(input: {
  flow: Pick<ReactFlowInstance, 'getViewport' | 'setViewport'>
  zoomRef: React.MutableRefObject<number>
  offsetRef: React.MutableRefObject<Offset>
  /** 一段动画走完（没被打断）时，最终视口交给视口的落盘方记一次。 */
  onAnimationSettled: (viewport: FlowViewport) => void
}) {
  const { flow, zoomRef, offsetRef } = input
  const onAnimationSettledRef = React.useRef(input.onAnimationSettled)
  onAnimationSettledRef.current = input.onAnimationSettled
  const animationCoordinatorRef = React.useRef<ViewportAnimationCoordinator | null>(null)
  React.useEffect(() => {
    const coordinator = createViewportAnimationCoordinator({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
      readViewport: () => {
        const live = flow.getViewport()
        return { zoom: live.zoom, offset: { x: live.x, y: live.y } }
      },
      writeViewport: (next) => {
        void flow.setViewport({ x: next.offset.x, y: next.offset.y, zoom: next.zoom }, { duration: 0 })
      },
    })
    animationCoordinatorRef.current = coordinator
    return () => {
      if (animationCoordinatorRef.current === coordinator) animationCoordinatorRef.current = null
      coordinator.dispose()
    }
  }, [flow])
  /** 直接写视口（切分类还原 / 零时长适应 / 用户自己开始拖、滚）前先取得所有权，别让在飞的动画下一帧把它盖回去。 */
  const cancelViewportAnimation = React.useCallback(() => {
    animationCoordinatorRef.current?.takeOwnershipAndCancel()
  }, [])
  const isViewportAnimating = React.useCallback(() => animationCoordinatorRef.current?.isAnimating() ?? false, [])
  /** React Flow 吐出非有限视口时：不记、不信，用最后一份好视口把它拉回来（否则画布永久空白）。 */
  const healViewport = React.useCallback((broken: FlowViewport) => {
    logRendererError('canvas-viewport-non-finite', undefined, { x: broken.x, y: broken.y, zoom: broken.zoom })
    cancelViewportAnimation()
    void flow.setViewport({ x: offsetRef.current.x, y: offsetRef.current.y, zoom: zoomRef.current || 1 }, { duration: 0 })
  }, [cancelViewportAnimation, flow, offsetRef, zoomRef])
  const animateViewportTo = React.useCallback(
    (
      zoom: number,
      offset: { x: number; y: number },
      duration = 160,
      onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
    ) => {
      if (!Number.isFinite(zoom) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
        // 非有限的视口一旦交给 React Flow，内部 transform 变 NaN，节点全部判不可见。拒收并把调用栈亮出来。
        logRendererError('canvas-viewport-rejected', new Error('non-finite viewport target'), { zoom, offsetX: offset.x, offsetY: offset.y })
        onSettled?.('cancelled')
        return
      }
      const coordinator = animationCoordinatorRef.current
      if (!coordinator) {
        onSettled?.('cancelled')
        return
      }
      coordinator.animateTo(zoom, offset, duration, (outcome) => {
        if (outcome === 'completed') onAnimationSettledRef.current(flow.getViewport())
        onSettled?.(outcome)
      })
    },
    [flow],
  )

  return { animateViewportTo, cancelViewportAnimation, isViewportAnimating, healViewport }
}
