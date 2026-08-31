function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function buildVideoPlaybackUrl(rawVideoUrl: string): string {
  const trimmed = rawVideoUrl.trim()
  if (!trimmed || !isHttpUrl(trimmed)) return trimmed
  return trimmed
}

/** Ask Chromium to decode a paused first frame; metadata alone can still render black. */
export function primePausedVideoFrame(video: HTMLVideoElement): void {
  if (video.readyState >= 2) return
  video.currentTime = Math.min(0.01, video.duration || 0.01)
}
