export type TimelineTrackType = 'image' | 'video'

export type TimelineClip = {
  id: string
  type: TimelineTrackType
  sourceNodeId: string
  label: string
  startFrame: number
  endFrame: number
  frameCount: number
  offsetStartFrame: number
  offsetEndFrame: number
  text?: string
  url?: string
  thumbnailUrl?: string
}

export type TimelineTrack = {
  id: string
  type: TimelineTrackType
  label: string
  clips: TimelineClip[]
}

export type TimelineState = {
  version: 1
  fps: 30
  scale: number
  playheadFrame: number
  tracks: TimelineTrack[]
}

export const TIMELINE_TRACK_DEFINITIONS: Array<Pick<TimelineTrack, 'id' | 'type' | 'label'>> = [
  { id: 'imageTrack', type: 'image', label: '图片轨' },
  { id: 'videoTrack', type: 'video', label: '视频轨' },
]
