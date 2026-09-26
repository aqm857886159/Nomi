// 画布节点视频的播放策略——唯一 owner（2026-09-25 画布跟手方案第 1 步）：
// ① 悬停静音试播 / 离开复位；② 哪些播放算用户主动（离开卡片也不停）；③ 全画布同时只有一个在播。
// 「什么时候挂 <video>」归 NodeVideoPlaybackGuard；这里只管已经挂上的元素怎么播。
// 时间轴、大图预览等其他播放面不经过这里（它们一次只有一个播放器）。

const mutedBeforeHover = new WeakMap<HTMLVideoElement, boolean>()
const userPlaybackVideos = new WeakSet<HTMLVideoElement>()
const pendingHoverPreviewPlay = new WeakSet<HTMLVideoElement>()
/** 当前在播的那一个节点视频；新的一个开始播时，上一个被暂停。 */
let playingVideo: HTMLVideoElement | null = null

function userIsWatching(video: HTMLVideoElement | null): boolean {
  return Boolean(video && userPlaybackVideos.has(video) && !video.paused)
}

/**
 * Hover playback must be muted to satisfy autoplay policies, but that mute is
 * temporary. Keep the element's user-facing state intact after the preview.
 * 用户正在看（带声、主动播放）另一个视频时，悬停试播不抢它。
 */
export function startNodeVideoHoverPreview(video: HTMLVideoElement): void {
  if (userPlaybackVideos.has(video)) return
  if (playingVideo !== video && userIsWatching(playingVideo)) return
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

/**
 * 一次音量变化算不算「用户接手」：只有**正在播**时被取消静音才算（试播中点开声音 = 要接着看）。
 * 试播结束的复位是先 pause 再恢复静音，那次 volumechange 到达时视频已暂停——按状态判，不按时序猜
 * （2026-09-25 实测：按「没静音就算」判，离开卡片的复位被当成用户操作，播放器卸不掉、再悬停不播）。
 */
export function isNodeVideoVolumeTakeover(video: HTMLVideoElement): boolean {
  return !video.paused && !video.muted
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

/** 一个节点视频开始播放（`play` 事件）：它成为唯一在播者，上一个被暂停。 */
export function claimNodeVideoPlayback(video: HTMLVideoElement): void {
  const previous = playingVideo
  playingVideo = video
  if (previous && previous !== video && !previous.paused) previous.pause()
}

/** 暂停、播完或卸载：不再占着「唯一在播者」。 */
export function releaseNodeVideoPlayback(video: HTMLVideoElement): void {
  if (playingVideo === video) playingVideo = null
}
