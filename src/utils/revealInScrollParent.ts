import { shouldReduceMotion } from '../design/motion'

/**
 * 把一段滚进离它最近的可滚容器的可视区（最近对齐）：下沿在外就往下滚刚好够；段比可视区还高就让顶对齐。
 * 不用 `scrollIntoView`：它连 overflow-hidden 的祖先（画布卡、画布本身）一起滚。
 * 从 InlineParameterBar 搬出（按职责拆：这是 DOM 滚动小工具，不是底栏逻辑），行为不变。
 */
export function revealInScrollParent(el: HTMLElement): void {
  let scroller: HTMLElement | null = el.parentElement
  while (scroller) {
    const overflowY = getComputedStyle(scroller).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const box = el.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const viewTop = view.top + scroller.clientTop
  const viewBottom = viewTop + scroller.clientHeight
  if (box.bottom <= viewBottom + 0.5 && box.top >= viewTop - 0.5) return
  const delta = box.height > scroller.clientHeight ? box.top - viewTop : box.bottom > viewBottom ? box.bottom - viewBottom : box.top - viewTop
  const reduce = shouldReduceMotion()
  scroller.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}
