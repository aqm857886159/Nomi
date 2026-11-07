import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_CONTENT_FLOOR,
  ASSISTANT_DOCK_CONTENT_FLOOR,
  ASSISTANT_DOCK_TRACK_MIN,
  ASSISTANT_WIDTH_MIN,
  assistantDockColumns,
  assistantDockColumnsAnimated,
  assistantWidthMaxFor,
  clampAssistantWidth,
  normalizeAssistantWidth,
} from './assistantWidthBounds'
import { SHELL_GUTTER, SHELL_RAIL_WIDTH } from '../ui/app-shell/shellGeometry'

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

  // 只有人亲手拖 / 按键走 clampAssistantWidth；窗口变窄本身不写存档（store 层见 preview/assistantWidthWriteback.test.ts）。
  it('手拖时只收上限，不改没超限的宽', () => {
    // 用户在宽屏拖到 340，窗口 1100 再拖：340 正好等于上限，一个像素都不动。
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

describe('存档只认静态界、显示让步交给 Grid（方向检查 2026-11-08 选项 2a）', () => {
  it('normalizeAssistantWidth 不看窗口：只夹 300–600', () => {
    expect(normalizeAssistantWidth(450)).toBe(450)
    expect(normalizeAssistantWidth(120)).toBe(300)
    expect(normalizeAssistantWidth(900)).toBe(600)
    expect(normalizeAssistantWidth(Number.NaN)).toBe(340)
  })

  it('窗口宽正好是窄窗阈值（760 + 300）时，内容地板 + 最窄停靠栏正好排满工作面', () => {
    const threshold = ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN
    const stage = threshold - SHELL_RAIL_WIDTH - SHELL_GUTTER
    expect(ASSISTANT_DOCK_CONTENT_FLOOR + ASSISTANT_DOCK_TRACK_MIN).toBe(stage)
  })

  it('两列：内容先保底（容器比地板还窄时不撑破），停靠栏最宽 = 存的宽 + 缝、最窄 308', () => {
    expect(assistantDockColumns(390)).toBe(`minmax(min(${ASSISTANT_DOCK_CONTENT_FLOOR}px, 100%), 1fr) minmax(min(398px, ${ASSISTANT_DOCK_TRACK_MIN}px), 398px)`)
    // 生成页：最宽给会动画的变量，变量 0px 时这一轨收成 0（收起 / 展开逐帧插值）。
    expect(assistantDockColumnsAnimated('var(--generation-assistant-width)')).toBe(`minmax(min(${ASSISTANT_DOCK_CONTENT_FLOOR}px, 100%), 1fr) minmax(min(var(--generation-assistant-width), ${ASSISTANT_DOCK_TRACK_MIN}px), var(--generation-assistant-width))`)
  })
})
