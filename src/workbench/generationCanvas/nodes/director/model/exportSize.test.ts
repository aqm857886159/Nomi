import { describe, expect, it } from 'vitest'
import { exportDimensions, exportFrameCount } from './exportSize'

describe('exportDimensions', () => {
  it('横幅按短边给高，宽取偶数', () => {
    expect(exportDimensions('16:9', '1080')).toEqual({ width: 1920, height: 1080 })
    expect(exportDimensions('21:9', '1080')).toEqual({ width: 2520, height: 1080 })
  })
  it('竖幅按短边给宽', () => {
    expect(exportDimensions('9:16', '1080')).toEqual({ width: 1080, height: 1920 })
    expect(exportDimensions('3:4', '4k')).toEqual({ width: 2160, height: 2880 })
  })
  it('free 用视口比', () => {
    expect(exportDimensions('free', '1080', 2)).toEqual({ width: 2160, height: 1080 })
  })
})

describe('exportFrameCount', () => {
  it('30fps 向上取整，至少 1 帧，封顶 1800', () => {
    expect(exportFrameCount(0)).toBe(1)
    expect(exportFrameCount(4.01)).toBe(121)
    expect(exportFrameCount(90)).toBe(1800)
  })
})
