import { describe, it, expect } from 'vitest'
import { computeMediaMetaPatch, shouldApplyLoadedImageDimensions } from './nodeSizing'

describe('computeMediaMetaPatch 媒体回填', () => {
  it('有独立预览图时不把预览尺寸写回节点', () => {
    expect(shouldApplyLoadedImageDimensions(true)).toBe(false)
    expect(shouldApplyLoadedImageDimensions(false)).toBe(true)
  })
  it('视频 loadedmetadata 把真实时长写进 meta.videoDuration（修「拖入视频一律 5 秒」的 catch-all）', () => {
    const patch = computeMediaMetaPatch({
      resultType: 'video',
      meta: {},
      currentSize: { width: 0, height: 0 },
      width: 1920,
      height: 1080,
      durationSeconds: 12.34,
    })
    expect(patch?.meta.videoDuration).toBe(12.34)
    expect(patch?.meta.videoWidth).toBe(1920)
  })

  it('图片不写 videoDuration（时长仅视频概念）', () => {
    const patch = computeMediaMetaPatch({
      resultType: 'image',
      meta: {},
      currentSize: { width: 0, height: 0 },
      width: 800,
      height: 600,
      durationSeconds: 9,
    })
    expect(patch?.meta.videoDuration).toBeUndefined()
    expect(patch?.meta.imageWidth).toBe(800)
  })

  it('W/H 与时长都没变 → null（不发空 update）', () => {
    const meta = { videoWidth: 1920, videoHeight: 1080, videoDuration: 12, userResized: true }
    const patch = computeMediaMetaPatch({
      resultType: 'video',
      meta,
      currentSize: { width: 480, height: 270 },
      width: 1920,
      height: 1080,
      durationSeconds: 12,
    })
    expect(patch).toBeNull()
  })
})

it('preserves an acknowledged generation footprint when the returned frame has a different aspect ratio', () => {
  const patch = computeMediaMetaPatch({ resultType: 'image', meta: {}, currentSize: { width: 340, height: 240 }, width: 640, height: 360, preserveSize: true })
  expect(patch?.size).toBeUndefined()
  expect(patch?.meta.previewHeight).toBe(240)
})
