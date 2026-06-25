import { canPlaceClip, frameToPixel, withClipStartFrame } from './timelineEdit'
import type { TimelineClip, TimelineTrack } from './timelineTypes'
import { getTrackTypeForClipType } from './timelineTypes'

export type TimelineDropPreview = {
  clip: TimelineClip
  canPlace: boolean
  startFrame: number
  endFrame: number
  left: number
  width: number
  timecode: string
  reason?: string
}

function trackTypeLabel(type: TimelineClip['type']): string {
  if (type === 'image') return '图片轨'
  if (type === 'video') return '视频轨'
  if (type === 'audio') return '音频轨'
  return '对应轨道'
}

export function formatTimelineDropTimecode(frame: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  const totalSeconds = Math.floor(Math.max(0, frame) / safeFps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function buildTimelineDropPreview(params: {
  track: TimelineTrack
  clip: TimelineClip
  startFrame: number
  scale: number
  fps: number
}): TimelineDropPreview {
  const startFrame = Math.max(0, Math.floor(Number(params.startFrame) || 0))
  const placed = withClipStartFrame(params.clip, startFrame)
  // v0.7.1: audio clip 落到 video 轨；getTrackTypeForClipType 做映射
  const typeMatches = params.track.type === getTrackTypeForClipType(placed.type)
  const canPlace = typeMatches && canPlaceClip(params.track, placed)
  const reason = canPlace
    ? undefined
    : typeMatches
      ? '这里已有片段，试试拖到空白位置'
      : `这个素材需要放到${trackTypeLabel(placed.type)}`

  return {
    clip: placed,
    canPlace,
    startFrame: placed.startFrame,
    endFrame: placed.endFrame,
    left: frameToPixel(placed.startFrame, params.scale),
    width: Math.max(36, frameToPixel(placed.endFrame - placed.startFrame, params.scale)),
    timecode: formatTimelineDropTimecode(placed.startFrame, params.fps),
    ...(reason ? { reason } : {}),
  }
}
