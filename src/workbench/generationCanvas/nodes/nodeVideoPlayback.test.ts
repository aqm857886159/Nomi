import { describe, expect, it, vi } from 'vitest'
import {
  claimNodeVideoPlayback,
  clearNodeVideoUserPlayback,
  consumeNodeVideoHoverPreviewPlay,
  isNodeVideoVolumeTakeover,
  markNodeVideoUserPlayback,
  releaseNodeVideoPlayback,
  startNodeVideoHoverPreview,
  stopNodeVideoHoverPreview,
} from './nodeVideoPlayback'

function fakeVideo(muted: boolean, paused = true): HTMLVideoElement {
  return {
    muted,
    paused,
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

  it('the unmute that restores a stopped preview is not a user takeover', () => {
    const video = fakeVideo(false, false)

    startNodeVideoHoverPreview(video)
    expect(isNodeVideoVolumeTakeover(video)).toBe(false)
    video.muted = false
    expect(isNodeVideoVolumeTakeover(video)).toBe(true)

    video.muted = true
    ;(video as { paused: boolean }).paused = true
    stopNodeVideoHoverPreview(video)
    expect(video.muted).toBe(false)
    expect(isNodeVideoVolumeTakeover(video)).toBe(false)
  })
})

describe('only one canvas node video plays at a time', () => {
  it('a new playback pauses the previous one', () => {
    const first = fakeVideo(true, false)
    const second = fakeVideo(true, false)
    claimNodeVideoPlayback(first)
    claimNodeVideoPlayback(second)
    expect(first.pause).toHaveBeenCalledOnce()
    expect(second.pause).not.toHaveBeenCalled()
    releaseNodeVideoPlayback(second)
    releaseNodeVideoPlayback(first)
  })

  it('a hover preview never interrupts a video the user is watching', () => {
    const watching = fakeVideo(false, false)
    markNodeVideoUserPlayback(watching)
    claimNodeVideoPlayback(watching)
    const hovered = fakeVideo(false)
    startNodeVideoHoverPreview(hovered)
    expect(hovered.play).not.toHaveBeenCalled()
    expect(watching.pause).not.toHaveBeenCalled()
    clearNodeVideoUserPlayback(watching)
    releaseNodeVideoPlayback(watching)
    startNodeVideoHoverPreview(hovered)
    expect(hovered.play).toHaveBeenCalledOnce()
  })
})
