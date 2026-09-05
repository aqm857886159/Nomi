import React from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { createViewportAnimationCoordinator, type ViewportAnimationCoordinator } from '../components/viewportAnimationCoordinator'
import type { ViewportAnimationSettlementOutcome } from '../components/viewportAnimationSettlement'
import { createViewportTargetTracker, type ViewportTargetTracker } from '../components/viewportTargetTracker'

type Offset = { x: number; y: number }

/**
 * React Flow 画布上所有「自动让位」（新建节点露出 / composer 推开画布 / 聚焦跳转）的唯一入口。
 * 从 GenerationCanvasReactFlow 拆出来只为 R9 单文件上限；语义与调用点一字未改。
 */
export function useReactFlowViewportAnimation(input: {
  flow: Pick<ReactFlowInstance, 'getViewport' | 'setViewport'>
  zoomRef: React.MutableRefObject<number>
  offsetRef: React.MutableRefObject<Offset>
}) {
  const { flow, zoomRef, offsetRef } = input
  // 所有自动让位（新建节点露出 / composer 推开画布）共用这一个入口，动画由我们自己的
  // rAF 调度器逐帧以 duration=0 直写 React Flow，而**不用** React Flow 的 setViewport({ duration })：
  //   ① 它的 d3 过渡对被打断的调用永不结算 promise（composer 的让位请求闩会卡死）；
  //   ② 它的缩放插值读的是 XYPanZoom 里一份 ResizeObserver 缓存的 extent，pane 只要有一帧 0×0
  //      （建卡当帧就会发生），缓存就是 0，接下来任何一次过渡都算出 NaN transform，
  //      onlyRenderVisibleElements 把所有节点判不可见——画布整片空白、节点却还在（走查 ~30% 复现）。
  // 直写不经过插值，也不看那份缓存；调度器自己负责 cancelled/completed。
  // 每个请求都从「正在去的目标」出发算增量（viewportTargetTracker），后到的不抹掉先到的。
  const viewportTargetRef = React.useRef<ViewportTargetTracker | null>(null)
  if (viewportTargetRef.current === null) {
    viewportTargetRef.current = createViewportTargetTracker(() => ({ zoom: zoomRef.current, offset: offsetRef.current }))
  }
  const readViewportTarget = React.useCallback(() => viewportTargetRef.current!.read(), [])
  const readLastAutoTarget = React.useCallback(() => viewportTargetRef.current!.readLastAutoTarget(), [])
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
  /** 直接写视口（切分类还原 / 聚焦还原）前先取得所有权，别让在飞的自动让位下一帧又把它盖回去。 */
  const cancelViewportAnimation = React.useCallback(() => {
    animationCoordinatorRef.current?.takeOwnershipAndCancel()
  }, [])
  /** React Flow 吐出非有限视口时：不记、不信，用最后一份好视口把它拉回来（否则画布永久空白）。 */
  const healViewport = React.useCallback((broken: { x: number; y: number; zoom: number }) => {
    console.error('[generation-canvas] React Flow 交出了非有限视口，已用最后一份好视口恢复', broken)
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
        console.error('[generation-canvas] animateViewportTo 拒收非有限视口', { zoom, offset, stack: new Error().stack })
        onSettled?.('cancelled')
        return
      }
      const coordinator = animationCoordinatorRef.current
      if (!coordinator) {
        onSettled?.('cancelled')
        return
      }
      const tracker = viewportTargetRef.current!
      const token = tracker.begin({ zoom, offset }, duration)
      coordinator.animateTo(zoom, offset, duration, (outcome) => {
        tracker.settle(token)
        onSettled?.(outcome)
      })
    },
    [],
  )

  return { animateViewportTo, readViewportTarget, readLastAutoTarget, cancelViewportAnimation, healViewport }
}
