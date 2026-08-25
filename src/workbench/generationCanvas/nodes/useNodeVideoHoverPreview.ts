import React from 'react'

const mutedBeforeHover = new WeakMap<HTMLVideoElement, boolean>()
const userPlaybackVideos = new WeakSet<HTMLVideoElement>()
const pendingHoverPreviewPlay = new WeakSet<HTMLVideoElement>()

/**
 * Hover playback must be muted to satisfy autoplay policies, but that mute is
 * temporary. Keep the element's user-facing state intact after the preview.
 */
export function startNodeVideoHoverPreview(video: HTMLVideoElement): void {
  if (userPlaybackVideos.has(video)) return
  if (!mutedBeforeHover.has(video)) mutedBeforeHover.set(video, video.muted)
  video.muted = true
  pendingHoverPreviewPlay.add(video)
  const playPromise = video.play()
  if (playPromise && typeof playPromise.catch === 'function') {
    void playPromise.catch(() => {
      pendingHoverPreviewPlay.delete(video)
    })
  }
}

/** Mark an explicit media interaction so pointer-leave does not stop it. */
export function markNodeVideoUserPlayback(video: HTMLVideoElement): void {
  pendingHoverPreviewPlay.delete(video)
  const previousMuted = mutedBeforeHover.get(video)
  if (previousMuted !== undefined) {
    video.muted = previousMuted
    mutedBeforeHover.delete(video)
  }
  userPlaybackVideos.add(video)
}

/** Clear the explicit-playback marker after pause or natural end. */
export function clearNodeVideoUserPlayback(video: HTMLVideoElement): void {
  pendingHoverPreviewPlay.delete(video)
  userPlaybackVideos.delete(video)
}

/** Return whether the next play event belongs to the automatic hover preview. */
export function consumeNodeVideoHoverPreviewPlay(video: HTMLVideoElement): boolean {
  const isHoverPreviewPlay = pendingHoverPreviewPlay.has(video)
  pendingHoverPreviewPlay.delete(video)
  return isHoverPreviewPlay
}

export function stopNodeVideoHoverPreview(video: HTMLVideoElement): void {
  pendingHoverPreviewPlay.delete(video)
  if (userPlaybackVideos.has(video)) return
  video.pause()
  try {
    video.currentTime = 0
  } catch {
    // Some browsers can reject seeking before metadata is ready.
  }
  const previousMuted = mutedBeforeHover.get(video)
  if (previousMuted !== undefined) {
    video.muted = previousMuted
    mutedBeforeHover.delete(video)
  }
}

function playPreviewVideo(host: HTMLElement): void {
  const video = host.querySelector<HTMLVideoElement>('[data-node-preview-video="true"]')
  if (!video) return
  startNodeVideoHoverPreview(video)
}

function stopPreviewVideo(host: HTMLElement): void {
  const video = host.querySelector<HTMLVideoElement>('[data-node-preview-video="true"]')
  if (!video) return
  stopNodeVideoHoverPreview(video)
}

export function useNodeVideoHoverPreview(resultType: string | undefined): {
  handleVideoNodePointerEnter: (event: React.PointerEvent<HTMLElement>) => void
  handleVideoNodePointerLeave: (event: React.PointerEvent<HTMLElement>) => void
} {
  const handleVideoNodePointerEnter = React.useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (resultType !== 'video') return
    playPreviewVideo(event.currentTarget)
  }, [resultType])

  const handleVideoNodePointerLeave = React.useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (resultType !== 'video') return
    stopPreviewVideo(event.currentTarget)
  }, [resultType])

  return { handleVideoNodePointerEnter, handleVideoNodePointerLeave }
}
