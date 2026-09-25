import React from 'react'

/**
 * 指针在视频卡上（整张卡，不只视频区）= 请播放守卫挂播放器并静音试播。「何时挂 <video>」归 NodeVideoPlaybackGuard，
 * 这里只记意图。只有视频卡记这份状态——图片卡悬停不重渲。
 */
export function useNodeVideoPreviewIntent(hasVideo: boolean): {
  requested: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
} {
  const [requested, setRequested] = React.useState(false)
  if (!hasVideo) return { requested: false }
  return { requested, onPointerEnter: () => setRequested(true), onPointerLeave: () => setRequested(false) }
}
