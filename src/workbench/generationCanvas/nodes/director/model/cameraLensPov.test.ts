import { describe, expect, it } from 'vitest'
import { exportAspectRatio, frameGuideSize, povVerticalFov } from './cameraLens'

describe('cameraLens pov helpers', () => {
  it('parses export ratios and treats free as null', () => {
    expect(exportAspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(exportAspectRatio('9:16')).toBeCloseTo(9 / 16)
    expect(exportAspectRatio('free')).toBeNull()
  })

  it('keeps the camera fov when there is no frame (free ratio) or the frame fills the viewport height', () => {
    expect(povVerticalFov(45, null, 1600, 900)).toBe(45)
    // 框高 = 视口高时不补（理论边界）
    expect(frameGuideSize(1600, 900, 16 / 9).height).toBeCloseTo(740)
  })

  it('widens the fov so the guide frame (80px padding) keeps the camera fov', () => {
    const guide = frameGuideSize(1600, 900, 16 / 9)
    const widened = povVerticalFov(45, 16 / 9, 1600, 900)
    const expected = (Math.atan(Math.tan((45 * Math.PI) / 360) * (900 / guide.height)) * 360) / Math.PI
    expect(widened).toBeCloseTo(expected)
    // 竖屏画幅：框按高度装（900-160=740 高，宽 = 740·9/16）
    const portrait = frameGuideSize(1600, 900, 9 / 16)
    expect(portrait.height).toBeCloseTo(740)
    expect(portrait.width).toBeCloseTo(740 * (9 / 16))
  })
})
