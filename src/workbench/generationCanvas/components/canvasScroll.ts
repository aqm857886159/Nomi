// 滚轮命中判定：从 target 往上找「能在主滚动方向继续滚动」的可滚祖先（到 boundary 为止）。
// 找到 = 这次 wheel 该交给原生滚动（卡内提示词编辑器等），画布不缩放/不平移。
//
// 两处根治（审计 P3）：
// 1) **横轴支持**：旧版只查 overflowY/scrollHeight/deltaY；调用方却按 dominant=max(|dy|,|dx|)
//    喂进来——横向 dominant 时仍按纵轴判定必返 false，触控板横滑卡内横向滚区会被画布误平移。
//    现按主轴（dominantAxis）分别查 overflowX/scrollWidth 或 overflowY/scrollHeight。
// 2) **去掉热路径里逐级 getComputedStyle**：wheel 是高频热路径，每 tick 逐级 getComputedStyle
//    会强制 style 重算（与「丝滑」相悖）。overflow 这种 CSS 属性几乎不随滚动变化，按元素
//    缓存一次（OVERFLOW_CACHE），后续 tick 直接命中缓存，不再反复触发重排。
// 几何判定（能否在某方向继续滚）抽成纯函数 elementCanScrollInDirection，可单测、无 DOM 依赖。

export type ScrollAxis = 'x' | 'y'

/** 主滚动轴 = |dx| 与 |dy| 较大者；相等偏向纵轴（与旧 max(|dy|,|dx|) 行为一致）。 */
export function dominantAxis(deltaX: number, deltaY: number): { axis: ScrollAxis; delta: number } {
  return Math.abs(deltaX) > Math.abs(deltaY)
    ? { axis: 'x', delta: deltaX }
    : { axis: 'y', delta: deltaY }
}

export type AxisScrollMetrics = {
  /** 该轴的 overflow 计算值（overflowX 或 overflowY）。 */
  overflow: string
  /** 该轴可滚动内容尺寸（scrollWidth 或 scrollHeight）。 */
  scrollSize: number
  /** 该轴可视尺寸（clientWidth 或 clientHeight）。 */
  clientSize: number
}

/**
 * 纯几何判定：给定某元素在主轴上的 overflow/尺寸/当前滚动位置 + 滚动方向 delta，
 * 它能否在该方向继续原生滚动（还有剩余空间）。
 * - overflow 必须是 auto/scroll（visible/hidden 即便内容溢出也不会滚）。
 * - scrollSize 须大于 clientSize（有可滚内容）。
 * - delta>0 往下/右：未到底才可滚；delta<0 往上/左：未到顶才可滚；delta=0 不消费。
 */
export function elementCanScrollInDirection(metrics: AxisScrollMetrics, scrollPos: number, delta: number): boolean {
  if (delta === 0) return false
  const scrollable = (metrics.overflow === 'auto' || metrics.overflow === 'scroll') && metrics.scrollSize > metrics.clientSize
  if (!scrollable) return false
  if (delta > 0) {
    const atEnd = scrollPos + metrics.clientSize >= metrics.scrollSize - 1
    return !atEnd
  }
  const atStart = scrollPos <= 0
  return !atStart
}

// 每元素 overflow 缓存：避免 wheel 热路径逐级 getComputedStyle 触发的强制 style 重算。
// overflow 几乎不随滚动变化；首查写入，后续命中缓存。元素被 GC 时自动清理（WeakMap）。
const OVERFLOW_CACHE = new WeakMap<HTMLElement, { x: string; y: string }>()

function readOverflow(el: HTMLElement): { x: string; y: string } {
  const cached = OVERFLOW_CACHE.get(el)
  if (cached) return cached
  const style = window.getComputedStyle(el)
  const value = { x: style.overflowX, y: style.overflowY }
  OVERFLOW_CACHE.set(el, value)
  return value
}

export function findScrollableAncestor(
  target: Element,
  boundary: HTMLElement | null,
  deltaX: number,
  deltaY: number,
): boolean {
  const { axis, delta } = dominantAxis(deltaX, deltaY)
  let el: Element | null = target
  while (el && el !== boundary) {
    if (el instanceof HTMLElement) {
      const overflow = readOverflow(el)
      const metrics: AxisScrollMetrics = axis === 'x'
        ? { overflow: overflow.x, scrollSize: el.scrollWidth, clientSize: el.clientWidth }
        : { overflow: overflow.y, scrollSize: el.scrollHeight, clientSize: el.clientHeight }
      const scrollPos = axis === 'x' ? el.scrollLeft : el.scrollTop
      // 还有可滚空间（往下/右没到底、往上/左没到顶）才放行；到边界则继续找上层，最终回落画布。
      if (elementCanScrollInDirection(metrics, scrollPos, delta)) return true
    }
    el = el.parentElement
  }
  return false
}
