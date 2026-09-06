import { describe, expect, it } from 'vitest'
import { frameMediaBox, parseAspectRatio, tableFrameMediaBox } from './shotFrameGeometry'

describe('shotFrameGeometry', () => {
  it('三种拍板画幅落在样张的尺寸上（合同 §2.4）', () => {
    expect(frameMediaBox('9:16')).toEqual({ width: 76, height: 135 })
    expect(frameMediaBox('16:9')).toEqual({ width: 136, height: 77 })
    expect(frameMediaBox('1:1')).toEqual({ width: 108, height: 108 })
  })

  it('任何画幅都不越出 136 列宽，且短边不超过 108（否则近方形会把行撑成大方砖）', () => {
    for (const aspect of ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9']) {
      const box = frameMediaBox(aspect)
      expect(box.width).toBeLessThanOrEqual(136)
      expect(box.height).toBeLessThanOrEqual(135)
      expect(Math.min(box.width, box.height)).toBeLessThanOrEqual(108)
    }
  })

  it('解析不出画幅时兜底竖版，不抛也不编造一个横版', () => {
    expect(parseAspectRatio('nonsense')).toBeNull()
    expect(parseAspectRatio('')).toBeNull()
    expect(frameMediaBox(undefined)).toEqual({ width: 76, height: 135 })
    expect(frameMediaBox('nonsense')).toEqual({ width: 76, height: 135 })
  })

  it('接受 16x9 与小数写法（Agent 与档案都可能这么写）', () => {
    expect(parseAspectRatio('16x9')).toEqual({ width: 16, height: 9 })
    expect(frameMediaBox('16x9')).toEqual(frameMediaBox('16:9'))
    expect(parseAspectRatio('1.5')).toEqual({ width: 1.5, height: 1 })
  })
})

/**
 * 2026-09-06 用户反馈四：「不同画幅的行一放进来整个框就不齐……至少大家都同一个比例时，
 * 单个分镜行要排得很好、对齐。」盒子因此升到**表级**：全同 → 用那个画幅的框；混排 → 一只统一盒。
 */
describe('表级媒体盒（前两列对齐的唯一几何输入）', () => {
  it('全表同一画幅 → 盒就是那个画幅的框（缩略图铺满，没有一条黑边）', () => {
    expect(tableFrameMediaBox(['16:9', '16:9', '16:9', '16:9', '16:9'])).toEqual(frameMediaBox('16:9'))
    expect(tableFrameMediaBox(['9:16', '9:16'])).toEqual(frameMediaBox('9:16'))
    expect(tableFrameMediaBox(['1:1'])).toEqual(frameMediaBox('1:1'))
  })

  it('等价写法算同一个画幅（16x9 / 32:18 都是 16:9，不该被当成混排）', () => {
    expect(tableFrameMediaBox(['16:9', '16x9', '32:18'])).toEqual(frameMediaBox('16:9'))
  })

  it('混排 → 全表一只盒：宽=列宽上限、高=短边上限；横竖方三种都装得下', () => {
    const box = tableFrameMediaBox(['16:9', '9:16', '1:1'])
    expect(box).toEqual({ width: 136, height: 108 })
    // 装得下 = 每种画幅按比例缩进这只盒里都不超边（letterbox 的前提）。
    for (const aspect of ['16:9', '9:16', '1:1', '4:3', '3:2']) {
      const ratio = parseAspectRatio(aspect)!
      const fit = Math.min(box.width / ratio.width, box.height / ratio.height)
      expect(ratio.width * fit).toBeLessThanOrEqual(box.width + 0.001)
      expect(ratio.height * fit).toBeLessThanOrEqual(box.height + 0.001)
    }
  })

  it('盒子与行数无关：同一组画幅不管几行都是同一只盒（行行同高的前提）', () => {
    expect(tableFrameMediaBox(['16:9', '9:16'])).toEqual(tableFrameMediaBox(['16:9', '9:16', '16:9', '9:16', '1:1']))
  })

  it('空表 / 解析不出的画幅走同一条兜底（竖版），不抛也不编造', () => {
    expect(tableFrameMediaBox([])).toEqual(frameMediaBox('9:16'))
    expect(tableFrameMediaBox([undefined, '', 'nonsense'])).toEqual(frameMediaBox('9:16'))
  })
})
