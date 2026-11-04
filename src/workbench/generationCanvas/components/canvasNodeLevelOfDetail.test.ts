import { describe, expect, it } from 'vitest'
import { resolveLightweightNodePreview } from './canvasNodeLevelOfDetail'

// 「画整卡还是轻量卡」的判据由 canvasDetailAdmission.matrix.test.ts 按矩阵钉住；这里只管轻量卡挂什么图。
describe('resolveLightweightNodePreview', () => {
  it('uses an image thumbnail before the full image URL', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'image', thumbnailUrl: 'thumb.webp', url: 'full.png' },
      }),
    ).toEqual({ kind: 'image', src: 'thumb.webp' })
  })

  it('uses a video thumbnail as a static lightweight preview', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', thumbnailUrl: 'poster.jpg', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'image', src: 'poster.jpg' })
  })

  it('keeps videos playable when no poster was persisted', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'video', src: 'clip.mp4' })
  })

  it('does not mount media for non-visual results or empty URLs', () => {
    expect(resolveLightweightNodePreview({ result: { type: 'text' } })).toBeNull()
    expect(resolveLightweightNodePreview({ result: { type: 'image', url: '  ' } })).toBeNull()
  })
})
