import React from 'react'

function playPreviewVideo(host: HTMLElement): void {
  const video = host.querySelector<HTMLVideoElement>('[data-node-preview-video="true"]')
  if (!video) return
  video.muted = true
  const playPromise = video.play()
  if (playPromise && typeof playPromise.catch === 'function') {
    void playPromise.catch(() => {})
  }
}

function stopPreviewVideo(host: HTMLElement): void {
  const video = host.querySelector<HTMLVideoElement>('[data-node-preview-video="true"]')
  if (!video) return
  video.pause()
  try {
    video.currentTime = 0
  } catch {
    // Some browsers can reject seeking before metadata is ready.
  }
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
