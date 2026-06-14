// v0.7.1: 加 'audio' clip type（轨道仍是 image / video 两条；audio clip 落到 video 轨）
export type TimelineTrackType = 'image' | 'video'
export type TimelineClipType = 'image' | 'video' | 'audio'

export type TimelineClip = {
  id: string
  type: TimelineClipType
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

// 文字叠加层：字幕 / 标题卡。独立于生成节点（无 sourceNodeId/url），是后期叠加的一等公民。
export type TimelineTextStyle = 'caption' | 'title'

export type TimelineTextClip = {
  id: string
  text: string
  style: TimelineTextStyle
  startFrame: number
  endFrame: number
  // 通用变换（content-agnostic，见 overlayTransform.ts）。缺省 → 用 style 预设位/默认值。
  // 拖动写 position，缩放写 scale，rotation 预留（本期不接把手）。
  position?: { x: number; y: number } // 归一化中心 0~1
  scale?: number
  rotation?: number // 度，预留
  fontFamily?: string // 字体 id（见 textFonts.ts），缺省 = 默认黑体
}

export type TimelineState = {
  version: 1
  fps: 30
  scale: number
  playheadFrame: number
  tracks: TimelineTrack[]
  // 文字轨（字幕/标题卡）。独立层，不挂 tracks[]（它没有媒体 clip 心智）。
  textClips: TimelineTextClip[]
}

// v0.7.1: 视频轨改名"媒体轨"（承载 video / audio clip）
export const TIMELINE_TRACK_DEFINITIONS: Array<Pick<TimelineTrack, 'id' | 'type' | 'label'>> = [
  { id: 'imageTrack', type: 'image', label: '图片轨' },
  { id: 'videoTrack', type: 'video', label: '媒体轨' },
]

// audio / video clip 共用一条轨道；helper 用于决定 clip 该挂哪条
export function getTrackTypeForClipType(clipType: TimelineClipType): TimelineTrackType {
  return clipType === 'image' ? 'image' : 'video'
}
