// 拖片段 / 拖手柄 / 拖播放头时指针贴到轴的左右边缘，轴自己滚。每帧按 edgeScrollStep 滚一点，
// 滚完通知调用方按「同一个指针位置 + 新的滚动量」重算落点（滚动不产生指针事件，不重算就停在原地）。
import { edgeScrollStep } from './clipNodeGestureModel'

export function startEdgeAutoScroll(input: {
  scroller: HTMLElement | null
  canvasZoom: number
  getClientX: () => number
  onScrolled: () => void
}): () => void {
  const { scroller } = input
  if (!scroller || typeof window === 'undefined') return () => {}
  let frame = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    const rect = scroller.getBoundingClientRect()
    const step = edgeScrollStep({ clientX: input.getClientX(), viewportLeft: rect.left, viewportRight: rect.right, canvasZoom: input.canvasZoom })
    if (step !== 0) {
      const before = scroller.scrollLeft
      scroller.scrollLeft = before + step
      if (scroller.scrollLeft !== before) input.onScrolled()
    }
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    stopped = true
    window.cancelAnimationFrame(frame)
  }
}
