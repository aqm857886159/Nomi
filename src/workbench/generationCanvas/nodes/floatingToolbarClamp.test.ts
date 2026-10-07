import { describe, expect, it } from 'vitest'
import { floatingToolbarShift, nextFloatingToolbarPlacement, type FloatingToolbarPlacement } from './floatingToolbarClamp'

// 舞台 [60, 860]（右边是 Agent 面板），浮条 700 宽。
const stage = { min: 68, max: 852 }
const at = (left: number, appliedShift = 0) => floatingToolbarShift({ rectLeft: left + appliedShift, rectRight: left + 700 + appliedShift, appliedShift, scale: 1, ...stage })

describe('floatingToolbarShift', () => {
  it('完整在舞台里：不动', () => { expect(at(100)).toBe(0) })
  it('节点贴左边，浮条左边出了舞台：右移到刚好露出', () => { expect(at(-40)).toBe(108) })
  it('节点贴右边，浮条右边压到右面板底下：左移到刚好露出', () => { expect(at(300)).toBe(-148) })
  it('画布平移回来之后，上一次的位移自己归零', () => { expect(at(100, 108)).toBe(0) })
  it('已经位移过的浮条再算一次结果不变（幂等）', () => { expect(at(-40, 108)).toBe(108) })
  it('浮条比舞台还宽：左对齐', () => {
    expect(floatingToolbarShift({ rectLeft: 0, rectRight: 900, appliedShift: 0, scale: 1, ...stage })).toBe(68)
  })
  it('净缩放不是 1 时，位移按本地单位记：屏幕上刚好露出', () => {
    // 屏幕上 1 本地单位 = 2 像素：自然左缘 -40 → 屏幕要右移 108 像素 = 本地 54。
    expect(floatingToolbarShift({ rectLeft: -40, rectRight: 660, appliedShift: 0, scale: 2, ...stage })).toBe(54)
    // 已经施加了 54（屏幕 108）：再量一次还是 54。
    expect(floatingToolbarShift({ rectLeft: 68, rectRight: 768, appliedShift: 54, scale: 2, ...stage })).toBe(54)
  })
})

/**
 * 「量 → setState → 再量」的模拟器：把浮条外壳那段 layout effect 原样跑在一块假 DOM 上。
 *
 * 假 DOM 只做外壳真实会发生的那件事：浮条的屏幕矩形 = 自然位置 + 已施加位移 × 净缩放 `k`
 * （外壳写 `translate(shift / zoom) … scale(1 / zoom)`，挂在被 React Flow 缩放 Z 的视口里，屏幕上 = shift × Z / zoom），
 * 限宽后按行折。`k ≠ 1` 就是「反向缩放用的 zoom ≠ 贴在 DOM 上的 zoom」——
 * 打开项目摆全貌那一刻 store 还是 1、React Flow 已是 2.1（2026-10-06 L-qa2 真机撞到的 #185）。
 */
function screenBox(k: number, natural: { left: number; top: number }, layout: { width: number; height: number }, p: FloatingToolbarPlacement) {
  const width = Math.min(layout.width, p.maxWidth ?? Infinity)
  const rows = Math.ceil(layout.width / width)
  const left = natural.left + p.shiftX * k
  const top = natural.top + p.shiftY * k
  return { left, right: left + width * k, top, bottom: top + layout.height * rows * k, width: width * k, layoutWidth: width }
}

function simulate({ k, natural, layout, stageRect }: {
  k: number
  natural: { left: number; top: number }
  layout: { width: number; height: number }
  stageRect: { left: number; right: number; top: number; bottom: number }
}): { commits: number; placement: FloatingToolbarPlacement; screen: ReturnType<typeof screenBox> } {
  // React 的嵌套更新上限（NESTED_UPDATE_LIMIT）：layout effect 里连续 setState 超过 50 次就抛 #185。
  const REACT_NESTED_UPDATE_LIMIT = 50
  let placement: FloatingToolbarPlacement = { shiftX: 0, shiftY: 0, maxWidth: undefined }
  const screenOf = (p: FloatingToolbarPlacement) => screenBox(k, natural, layout, p)
  const stageBox = { ...stageRect, width: stageRect.right - stageRect.left }
  for (let commits = 0; commits <= REACT_NESTED_UPDATE_LIMIT; commits += 1) {
    const screen = screenOf(placement)
    const next = nextFloatingToolbarPlacement({ rect: screen, layoutWidth: screen.layoutWidth, stage: stageBox, applied: placement })
    if (!next) return { commits, placement, screen }
    placement = next
  }
  throw new Error(`Maximum update depth exceeded (k=${k})`)
}

describe('nextFloatingToolbarPlacement：一次测量就是不动点（React #185 的类回归）', () => {
  it('报告现场：store 缩放 1、React Flow 2.1、浮条比舞台宽——三次提交内停下，不再来回打转', () => {
    // 数字取自 2026-10-06 真机诊断（tests/ux/canvas-toolbar-open-select.walk.mjs --trace）：
    // 浮条布局宽 644、屏幕宽 1352（= 644 × 2.1），舞台 [60, 858] × [88, 933]。
    const result = simulate({ k: 2.1, natural: { left: -217, top: 70 }, layout: { width: 644, height: 42 }, stageRect: { left: 60, right: 858, top: 88, bottom: 933 } })
    expect(result.commits).toBeLessThanOrEqual(3)
    expect(result.screen.left).toBeGreaterThanOrEqual(60 + 8 - 0.5)
    expect(result.screen.right).toBeLessThanOrEqual(858 - 8 + 0.5)
    expect(result.screen.top).toBeGreaterThanOrEqual(88 + 8 - 0.5)
  })

  // 类级矩阵：净缩放清单（视口滞后的各种比值、节点弹入动画的 0.82、实验室外框）× 贴边位置清单。
  it('CI 现场（2026-10-07 canvas-card-stack 节点贴左边）：舞台 [60, 858]，浮条自然左缘 38、宽 644——一次算出右移 30', () => {
    const result = simulate({ k: 1, natural: { left: 38, top: 202 }, layout: { width: 644, height: 42 }, stageRect: { left: 60, right: 858, top: 88, bottom: 932 } })
    expect(result.commits).toBeLessThanOrEqual(3)
    expect(result.screen.left).toBeCloseTo(68, 0)
  })

  const scales = [0.1, 0.5, 0.82, 1, 1.5, 1.9, 2, 2.1, 3, 10, 15]
  const placements = [
    { name: '贴左', natural: { left: -300, top: 300 } },
    { name: '贴右', natural: { left: 700, top: 300 } },
    { name: '钻进顶栏', natural: { left: 200, top: -60 } },
    { name: '贴底', natural: { left: 200, top: 880 } },
    { name: '居中', natural: { left: 300, top: 300 } },
  ]
  for (const k of scales) {
    for (const { name, natural } of placements) {
      it(`净缩放 ${k} · ${name}：三次提交内收敛，结果留在舞台里`, () => {
        const stageRect = { left: 60, right: 860, top: 48, bottom: 900 }
        const result = simulate({ k, natural, layout: { width: 420, height: 36 }, stageRect })
        expect(result.commits).toBeLessThanOrEqual(3)
        // 收敛后再量一次必须原样不变（不动点）。
        const again = nextFloatingToolbarPlacement({ rect: result.screen, layoutWidth: result.screen.layoutWidth, stage: { ...stageRect, width: 800 }, applied: result.placement })
        expect(again).toBeNull()
        expect(result.screen.left).toBeGreaterThanOrEqual(stageRect.left + 8 - 0.5)
        expect(result.screen.right).toBeLessThanOrEqual(stageRect.right - 8 + 0.5)
      })
    }
  }

  it('还没布局（宽 0）时不量、不 setState', () => {
    expect(nextFloatingToolbarPlacement({
      rect: { left: 0, right: 0, top: 0, bottom: 0, width: 0 },
      layoutWidth: 0,
      stage: { left: 0, right: 800, top: 0, bottom: 600, width: 800 },
      applied: { shiftX: 0, shiftY: 0, maxWidth: undefined },
    })).toBeNull()
  })
})
