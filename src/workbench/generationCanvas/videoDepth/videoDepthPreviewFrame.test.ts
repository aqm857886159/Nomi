import { describe, expect, it } from 'vitest'
import {
  VIDEO_DEPTH_PREVIEW_MAX_WIDTH,
  packVideoDepthPreviewRgba,
  videoDepthPreviewSize,
} from './videoDepthPreviewFrame'

describe('packVideoDepthPreviewRgba', () => {
  it('spreads a gray byte across all three channels and opaque alpha', () => {
    // 深度帧是单通道。只写 R 会画出一张纯红的图——那看起来像「模型跑错了」，不像代码写错了。
    const rgba = packVideoDepthPreviewRgba({
      bytes: new Uint8Array([0, 128, 255, 64]),
      width: 2,
      height: 2,
    })
    expect(Array.from(rgba ?? [])).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 64, 64, 64, 255])
  })

  it('refuses a short buffer instead of padding it with zeros', () => {
    // 补零画出来的是「下半截全黑」，而深度图远处本来就是黑的——假证据混在真图里最难发现。
    expect(packVideoDepthPreviewRgba({ bytes: new Uint8Array([1, 2]), width: 2, height: 2 })).toBeNull()
    expect(packVideoDepthPreviewRgba({ bytes: new Uint8Array([1]), width: 0, height: 1 })).toBeNull()
  })
})

describe('videoDepthPreviewSize', () => {
  it('shrinks a wide frame to the cap and keeps the aspect ratio', () => {
    expect(videoDepthPreviewSize(518, 290)).toEqual({ width: VIDEO_DEPTH_PREVIEW_MAX_WIDTH, height: 107 })
  })

  it('never upscales a frame that is already smaller than the cap', () => {
    expect(videoDepthPreviewSize(120, 80)).toEqual({ width: 120, height: 80 })
  })
})
