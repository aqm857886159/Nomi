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

  it('上下都放不下的超高浮层：放在剩得多的那一边、收高度滚动——不盖锚点，也不被切（2026-10-06 起；旧版是「宁可盖住锚点」）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 400, bottom: 420, width: 40 }),
      { width: 200, height: 780 }, 'start', 6, viewport,
    )
    // 上面剩 400-6-8=386，下面剩 800-8-426=366 → 放上面，顶到边距，高度收到 386。
    expect(at).toEqual({ top: 8, left: 100, maxHeight: 386 })
    expect(at.top + (at.maxHeight ?? 0)).toBeLessThanOrEqual(400 - 6)
  })

  it('锚点自己滚出了窗口：浮层夹回窗口里，不跟着锚点出去（浮层里打开子下拉时页面滚动，composerLifecycle 那条）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 200, right: 430, top: 1160, bottom: 1225, width: 230 }),
      { width: 820, height: 31 }, 'start', 6, { width: 1280, height: 720 },
    )
    expect(at.top).toBeGreaterThanOrEqual(8)
    expect(at.top + 31).toBeLessThanOrEqual(720 - 8)
  })

  it('不变量普查：任意锚点 × 尺寸 × 偏好方向，浮层都不与锚点相交、都在视口里', () => {
    const misses: string[] = []
    for (const side of ['top', 'bottom'] as const) {
      for (let top = 0; top <= 780; top += 20) {
        for (const height of [40, 150, 360, 600, 790]) {
          const a = anchor({ left: 100, right: 140, top, bottom: top + 20, width: 40 })
          const at = resolveAnchoredPopoverPlacement(a, { width: 200, height }, 'start', 6, viewport, side)
          const shown = Math.min(height, at.maxHeight ?? height)
          const bottom = at.top + shown
          const overlaps = at.top < a.bottom && bottom > a.top
          const outside = at.top < 0 || bottom > viewport.height
          if (overlaps || outside) misses.push(`${side} top=${top} h=${height} → ${JSON.stringify(at)}`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('end 对齐把浮层右缘对到锚点右缘', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 400, right: 500, top: 100, bottom: 120, width: 100 }),
      { width: 200, height: 150 }, 'end', 6, viewport,
    )
    expect(at.left).toBe(300)
  })

  it('side=top 上方放得下就贴在锚点上面（节点浮条的下拉：不压在图上）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 400, bottom: 420, width: 40 }),
      { width: 200, height: 150 }, 'start', 6, viewport, 'top',
    )
    expect(at.top).toBe(400 - 6 - 150)
  })

  it('side=top 上方放不下就翻到下面（节点贴着画布上沿）', () => {
    const at = resolveAnchoredPopoverPlacement(
      anchor({ left: 100, right: 140, top: 60, bottom: 80, width: 40 }),
      { width: 200, height: 150 }, 'start', 6, viewport, 'top',
    )
    expect(at.top).toBe(86)
  })
})
