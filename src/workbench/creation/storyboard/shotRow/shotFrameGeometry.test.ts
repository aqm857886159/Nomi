import { describe, expect, it } from 'vitest'
import { frameMediaBox, parseAspectRatio } from './shotFrameGeometry'

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
