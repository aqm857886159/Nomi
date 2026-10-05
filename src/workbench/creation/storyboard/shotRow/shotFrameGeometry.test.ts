import { describe, expect, it } from 'vitest'
import {
  containedBox,
  densityBox,
  frameMediaBox,
  isPortraitBox,
  parseAspectRatio,
  sameAspectAsBox,
  tableFrameMediaBox,
  visualColumnWidth,
} from './shotFrameGeometry'

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

describe('表级：全表同一只框（各行左右边缘逐行对齐的唯一几何输入）', () => {
  it('全表同一画幅 → 就是那个画幅的框', () => {
    expect(tableFrameMediaBox(['16:9', '16x9', '32:18'])).toEqual(frameMediaBox('16:9'))
    expect(tableFrameMediaBox(['9:16'])).toEqual(frameMediaBox('9:16'))
  })

  it('混排 → 镜数最多的那个画幅（少数行在框里 contain），与行数无关、同数取先出现的', () => {
    expect(tableFrameMediaBox(['16:9', '9:16', '16:9', '1:1'])).toEqual(frameMediaBox('16:9'))
    expect(tableFrameMediaBox(['9:16', '16:9'])).toEqual(frameMediaBox('9:16'))
  })

  it('空表走兜底（竖版）', () => {
    expect(tableFrameMediaBox([])).toEqual(frameMediaBox('9:16'))
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
