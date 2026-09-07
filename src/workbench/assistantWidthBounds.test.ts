import { describe, expect, it } from 'vitest'
import { assistantWidthMaxFor, clampAssistantWidth } from './assistantWidthBounds'

describe('面板宽度界 · 09-01 定稿 §11.2 窄窗态', () => {
  it('宽屏上限就是 600，不因视口大小往上飘', () => {
    expect(assistantWidthMaxFor(1920)).toBe(600)
    expect(assistantWidthMaxFor(1440)).toBe(600)
    // 1360 是拐点：再宽一点点上限仍是 600，从这儿往下才开始缩水。
    expect(assistantWidthMaxFor(1360)).toBe(600)
  })

  it('1360 以下上限按定稿逐档缩水：视口 − 760', () => {
    expect(assistantWidthMaxFor(1280)).toBe(520)
    expect(assistantWidthMaxFor(1200)).toBe(440)
    // 最小窗 1100：上限正好等于默认宽 340——面板仍可停靠，只是拖不动了。
    expect(assistantWidthMaxFor(1100)).toBe(340)
  })

  it('上限压到下限以下时以 300 为准，绝不产出负宽', () => {
    expect(assistantWidthMaxFor(900)).toBe(300)
    expect(assistantWidthMaxFor(0)).toBe(600)
  })

  it('窄窗只收上限，不偷改没超限的当前宽', () => {
    // 用户在宽屏拖到 340，窗口缩到 1100：340 正好等于上限，一个像素都不动。
    expect(clampAssistantWidth(340, 1100)).toBe(340)
    // 拖到 560 之后缩窗，超限的那份才被钳回。
    expect(clampAssistantWidth(560, 1200)).toBe(440)
    expect(clampAssistantWidth(560, 1920)).toBe(560)
  })

  it('下限恒 300：再窄一份计划卡就折不出行来', () => {
    expect(clampAssistantWidth(120, 1920)).toBe(300)
    expect(clampAssistantWidth(Number.NaN, 1920)).toBe(340)
  })
})
