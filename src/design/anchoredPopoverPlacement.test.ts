import { describe, expect, it } from 'vitest'
import { resolveAnchoredPopoverPlacement } from './anchoredPopoverPlacement'

// AnchoredPopover 的全部几何都在这一个纯函数里。钉死它，是因为这一族的失败长得不像失败：
// 浮层放歪了不会抛错、不会消失，只会被裁掉一角或者顶出视口——DOM 断言全绿，人看不见。
const viewport = { width: 1000, height: 800 }
const anchor = (over: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON: () => ({}), ...over,
} as DOMRect)

describe('resolveAnchoredPopoverPlacement', () => {
  it('下方放得下就贴在锚点下面', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 100, bottom: 120, width: 40 }),
      { width: 200, height: 150 }, 'start', 6, viewport,
    )
    expect(at).toEqual({ top: 126, left: 100 })
  })

  it('下方放不下就翻到锚点上面（时间轴在窗口底部，转场选择器每次都走这一条）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 700, bottom: 720, width: 40 }),
      { width: 200, height: 150 }, 'center', 6, viewport,
    )
    expect(at.top).toBe(700 - 6 - 150)
  })

  it('center 对齐把浮层横向摆在锚点中线上', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 400, right: 440, top: 100, bottom: 120, width: 40 }),
      { width: 200, height: 150 }, 'center', 6, viewport,
    )
    expect(at.left).toBe(420 - 100)
  })

  it('贴着右缘的锚点：浮层被夹回视口内，不许探出去', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 960, right: 995, top: 100, bottom: 120, width: 35 }),
      { width: 200, height: 150 }, 'start', 6, viewport,
    )
    expect(at.left).toBe(viewport.width - 8 - 200)
  })

  it('贴着左缘的锚点：夹住之后仍留出边距，不会变成负数', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 2, right: 20, top: 100, bottom: 120, width: 18 }),
      { width: 200, height: 150 }, 'center', 6, viewport,
    )
    expect(at.left).toBe(8)
  })

  it('上下都放不下的超高浮层：顶到视口上边而不是溢出到负坐标（宁可盖住锚点也不许被切）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 400, bottom: 420, width: 40 }),
      { width: 200, height: 780 }, 'start', 6, viewport,
    )
    expect(at.top).toBe(8)
  })

  it('end 对齐把浮层右缘对到锚点右缘', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 400, right: 500, top: 100, bottom: 120, width: 100 }),
      { width: 200, height: 150 }, 'end', 6, viewport,
    )
    expect(at.left).toBe(300)
  })
})
