import { describe, expect, it } from 'vitest'
import { dominantAxis, elementCanScrollInDirection } from './canvasScroll'

describe('dominantAxis — 按 |dx| vs |dy| 选主轴（含正负方向）', () => {
  it('纵向占优 → 返回 y 轴及其 delta', () => {
    expect(dominantAxis(2, -30)).toEqual({ axis: 'y', delta: -30 })
    expect(dominantAxis(-5, 40)).toEqual({ axis: 'y', delta: 40 })
  })
  it('横向占优 → 返回 x 轴及其 delta（触控板横滑场景）', () => {
    expect(dominantAxis(50, 3)).toEqual({ axis: 'x', delta: 50 })
    expect(dominantAxis(-44, 10)).toEqual({ axis: 'x', delta: -44 })
  })
  it('相等时按 y（与原 max(|dy|,|dx|) 偏向纵轴一致）', () => {
    expect(dominantAxis(20, 20)).toEqual({ axis: 'y', delta: 20 })
  })
})

describe('elementCanScrollInDirection — 纯几何判定（替代热路径里重复 getComputedStyle）', () => {
  const scrollableY = { overflow: 'auto', scrollSize: 500, clientSize: 200 }
  const scrollableX = { overflow: 'scroll', scrollSize: 800, clientSize: 300 }

  it('overflow 非 auto/scroll → 永远不滚（即便内容溢出）', () => {
    expect(elementCanScrollInDirection({ overflow: 'visible', scrollSize: 999, clientSize: 100 }, 1, 30)).toBe(false)
    expect(elementCanScrollInDirection({ overflow: 'hidden', scrollSize: 999, clientSize: 100 }, 1, 30)).toBe(false)
  })

  it('scrollSize 不超过 clientSize → 不可滚', () => {
    expect(elementCanScrollInDirection({ overflow: 'auto', scrollSize: 200, clientSize: 200 }, 1, 30)).toBe(false)
  })

  it('向下/右且未到底 → 可滚', () => {
    expect(elementCanScrollInDirection(scrollableY, 0, 30)).toBe(true) // 在顶，往下有空间
    expect(elementCanScrollInDirection(scrollableX, 0, 30)).toBe(true)
  })

  it('向下到底 → 不可滚（让画布接管平移）', () => {
    // scrollPos + clientSize >= scrollSize - 1 视为到底
    expect(elementCanScrollInDirection(scrollableY, 300, 30)).toBe(false) // 300+200=500=scrollSize
  })

  it('向上且未到顶 → 可滚；在顶 → 不可滚', () => {
    expect(elementCanScrollInDirection(scrollableY, 120, -30)).toBe(true)
    expect(elementCanScrollInDirection(scrollableY, 0, -30)).toBe(false)
  })

  it('delta 为 0 → 不消费（交画布）', () => {
    expect(elementCanScrollInDirection(scrollableY, 120, 0)).toBe(false)
  })
})
