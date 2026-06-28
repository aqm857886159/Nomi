import { describe, expect, it } from 'vitest'
import {
  isLikelyStillImageUrl,
  resolveTimelineClipPreviewMedia,
  shouldMountTimelineClipVideoPreview,
} from './timelineClipPreview'
import type { TimelineClip } from './timelineTypes'

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    type: 'video',
    sourceNodeId: 'node-1',
    label: 'clip',
    startFrame: 0,
    endFrame: 30,
    frameCount: 30,
    offsetStartFrame: 0,
    offsetEndFrame: 30,
    url: 'nomi-local://asset/project/assets/video.mp4',
    ...overrides,
  }
}

describe('timelineClipPreview', () => {
  it('mounts a video preview only for the single selected video clip', () => {
    const videoClip = clip()

    expect(resolveTimelineClipPreviewMedia(videoClip, { isSingleSelected: false })).toEqual({ kind: 'placeholder' })
    expect(resolveTimelineClipPreviewMedia(videoClip, { isSingleSelected: true })).toEqual({
      kind: 'video',
      src: videoClip.url,
    })
    expect(shouldMountTimelineClipVideoPreview(videoClip, { isSingleSelected: true })).toBe(true)
  })

  it('does not mount video for still-image urls even when the clip is typed as video', () => {
    const stillVideoClip = clip({
      url: 'nomi-local://asset/project/assets/generated/frame.png',
      thumbnailUrl: 'nomi-local://asset/project/assets/generated/frame.png',
    })

    expect(shouldMountTimelineClipVideoPreview(stillVideoClip, { isSingleSelected: true })).toBe(false)
    expect(resolveTimelineClipPreviewMedia(stillVideoClip, { isSingleSelected: true })).toEqual({
      kind: 'image',
      src: stillVideoClip.thumbnailUrl,
    })
  })

  it('uses a still thumbnail for an unselected video when one exists', () => {
    const videoClip = clip({
      url: 'nomi-local://asset/project/assets/video.mp4',
      thumbnailUrl: 'nomi-local://asset/project/assets/video-cover.webp',
    })

    expect(resolveTimelineClipPreviewMedia(videoClip, { isSingleSelected: false })).toEqual({
      kind: 'image',
      src: videoClip.thumbnailUrl,
    })
  })

  it('keeps image clips as lazy images', () => {
    const imageClip = clip({
      type: 'image',
      url: 'nomi-local://asset/project/assets/image.jpg?size=thumb',
    })

    expect(isLikelyStillImageUrl(imageClip.url)).toBe(true)
    expect(resolveTimelineClipPreviewMedia(imageClip, { isSingleSelected: true })).toEqual({
      kind: 'image',
      src: imageClip.url,
    })
  })
})
