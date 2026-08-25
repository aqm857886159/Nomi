import { describe, expect, it, vi } from 'vitest'
import {
  clearNodeVideoUserPlayback,
  consumeNodeVideoHoverPreviewPlay,
  markNodeVideoUserPlayback,
  startNodeVideoHoverPreview,
  stopNodeVideoHoverPreview,
} from './useNodeVideoHoverPreview'

function fakeVideo(muted: boolean): HTMLVideoElement {
  return {
    muted,
    currentTime: 3,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement
}

describe('node video hover preview', () => {
  it('restores an audible canvas video after temporary autoplay mute', () => {
    const video = fakeVideo(false)

    startNodeVideoHoverPreview(video)
    expect(video.muted).toBe(true)
    expect(video.play).toHaveBeenCalledOnce()

    stopNodeVideoHoverPreview(video)
    expect(video.muted).toBe(false)
    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(0)
  })

  it('preserves a video that was already muted before hover', () => {
    const video = fakeVideo(true)

    startNodeVideoHoverPreview(video)
    stopNodeVideoHoverPreview(video)

    expect(video.muted).toBe(true)
  })

  it('keeps user-started playback running when the pointer leaves the node', () => {
    const video = fakeVideo(false)

    startNodeVideoHoverPreview(video)
    expect(consumeNodeVideoHoverPreviewPlay(video)).toBe(true)
    markNodeVideoUserPlayback(video)
    stopNodeVideoHoverPreview(video)

    expect(video.pause).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(3)
    expect(video.muted).toBe(false)

    clearNodeVideoUserPlayback(video)
  })

  it('allows a later hover preview after user playback is paused', () => {
    const video = fakeVideo(false)

    markNodeVideoUserPlayback(video)
    expect(consumeNodeVideoHoverPreviewPlay(video)).toBe(false)
    clearNodeVideoUserPlayback(video)
    startNodeVideoHoverPreview(video)
    stopNodeVideoHoverPreview(video)

    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(0)
  })
})
