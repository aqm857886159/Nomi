import { describe, expect, it } from 'vitest'
import {
  containedBox,
  densityBox,
  frameMediaBox,
  isPortraitBox,
  parseAspectRatio,
  sameAspectAsBox,
  visualColumnWidth,
} from './shotFrameGeometry'
import { planDefaultAspect } from '../../../generationCanvas/agent/storyboardShotScope'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'

/**
 * 视觉列几何（2026-10-06 第二 / 三轮，版面由协调会话定、用户拍板）：
 * 横版宽固定 240、竖版高固定 240、1:1 为 180；窄档整只按 176/240 缩；竖版视觉列与横版同宽（参考在框右边）。
 */
describe('预览框：由画幅定的那只框', () => {
  it('横版宽 240、高 = 240 ÷ 比例', () => {
    expect(frameMediaBox('16:9')).toEqual({ width: 240, height: 135 })
    expect(frameMediaBox('4:3')).toEqual({ width: 240, height: 180 })
    expect(frameMediaBox('21:9')).toEqual({ width: 240, height: 103 })
  })

  it('竖版高 240、宽 = 240 × 比例', () => {
    expect(frameMediaBox('9:16')).toEqual({ width: 135, height: 240 })
    expect(frameMediaBox('3:4')).toEqual({ width: 180, height: 240 })
  })

  it('1:1 是 180×180（不做成一块 240 的大方砖）', () => {
    expect(frameMediaBox('1:1')).toEqual({ width: 180, height: 180 })
  })

  it('窄档整只等比缩：横版宽 176、竖版高 176、方图 132', () => {
    expect(densityBox(frameMediaBox('16:9'), true)).toEqual({ width: 176, height: 99 })
    expect(densityBox(frameMediaBox('9:16'), true)).toEqual({ width: 99, height: 176 })
    expect(densityBox(frameMediaBox('1:1'), true)).toEqual({ width: 132, height: 132 })
    expect(densityBox(frameMediaBox('16:9'), false)).toEqual(frameMediaBox('16:9'))
  })

  it('解析不出画幅时兜底竖版，不抛也不编造一个横版', () => {
    expect(parseAspectRatio('nonsense')).toBeNull()
    expect(frameMediaBox(undefined)).toEqual(frameMediaBox('9:16'))
  })

  it('接受 16x9 与小数写法', () => {
    expect(parseAspectRatio('16x9')).toEqual({ width: 16, height: 9 })
    expect(frameMediaBox('16x9')).toEqual(frameMediaBox('16:9'))
  })
})

describe('表级：全表同一只框 = 整片默认画幅的框', () => {
  // 2026-10-06：表格递整片默认画幅（planDefaultAspect，与落画布同一个 resolver），不再按「镜数最多的画幅」近似。
  const shot = (index: number, aspect?: string): PlanShot => ({
    index, shotId: `s${index}`, durationSec: 5, anchorIds: [], prompt: '', ...(aspect ? { params: { aspect_ratio: aspect } } : {}),
  })
  it('覆盖了画幅的镜占多数，框照样是整片默认的那只（少数派不带着整张表变形）', () => {
    const plan: StoryboardPlan = { title: 't', anchors: [], aspectRatio: '16:9', shots: [shot(1, '9:16'), shot(2, '9:16'), shot(3)] }
    expect(frameMediaBox(planDefaultAspect(plan))).toEqual(frameMediaBox('16:9'))
  })
  it('整片没设画幅 → 按 planDefaultAspect 的规则 derive（全镜共同值）', () => {
    const plan: StoryboardPlan = { title: 't', anchors: [], shots: [shot(1, '1:1'), shot(2, '1:1')] }
    expect(frameMediaBox(planDefaultAspect(plan))).toEqual(frameMediaBox('1:1'))
  })
})

describe('单镜画幅 ≠ 框：在框里按比例完整放下', () => {
  it('9:16 放进 16:9 框：高贴满、宽按比例', () => {
    expect(containedBox(frameMediaBox('16:9'), '9:16')).toEqual({ width: 76, height: 135 })
    expect(containedBox(frameMediaBox('16:9'), '1:1')).toEqual({ width: 135, height: 135 })
  })

  it('同比例才不标画幅角标', () => {
    expect(sameAspectAsBox(frameMediaBox('16:9'), '16:9')).toBe(true)
    expect(sameAspectAsBox(frameMediaBox('16:9'), '9:16')).toBe(false)
  })
})

describe('竖版（用户选 A）：视觉列与横版同宽，参考在框右边', () => {
  it('竖版视觉列 240；横版与方图视觉列 = 框宽', () => {
    expect(isPortraitBox(frameMediaBox('9:16'))).toBe(true)
    expect(visualColumnWidth(frameMediaBox('9:16'))).toBe(240)
    expect(visualColumnWidth(frameMediaBox('3:4'))).toBe(240)
    expect(visualColumnWidth(frameMediaBox('16:9'))).toBe(240)
    expect(visualColumnWidth(frameMediaBox('1:1'))).toBe(180)
  })
})
