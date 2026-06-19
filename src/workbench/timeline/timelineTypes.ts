import type { ClipFraming } from './clipFraming'

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
  // 取景（适应/填充 + 缩放 + 平移）。缺省 = DEFAULT_CLIP_FRAMING（contain/1/0/0）。
  // 这是 P0-5「所见即所得」的关键：取景从预览局部 state 提升为时间轴数据，导出据此复现构图。
  framing?: ClipFraming
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
  // 帧率：默认 30，但允许持久化/导入携带其它值（导出维度/duration/adelay 都按它 derive）。
  // 钉死字面量 30 会让任何非 30fps 的时间轴在类型层就装不下、在运行时被 normalize 抹平。
  fps: number
  scale: number
  playheadFrame: number
  tracks: TimelineTrack[]
  // 文字轨（字幕/标题卡）。独立层，不挂 tracks[]（它没有媒体 clip 心智）。
  textClips: TimelineTextClip[]
}

// 轨道名与「图片轨」对称用「视频轨」（type 仍是 video；audio clip 也落此轨，少见）。
// 原 v0.7.1 叫「媒体轨」求泛指，但和「图片轨」不对称、纯图片项目里也显得空泛——2026-06-19 走查改回对称命名。
export const TIMELINE_TRACK_DEFINITIONS: Array<Pick<TimelineTrack, 'id' | 'type' | 'label'>> = [
  { id: 'imageTrack', type: 'image', label: '图片轨' },
  { id: 'videoTrack', type: 'video', label: '视频轨' },
]

// audio / video clip 共用一条轨道；helper 用于决定 clip 该挂哪条
export function getTrackTypeForClipType(clipType: TimelineClipType): TimelineTrackType {
  return clipType === 'image' ? 'image' : 'video'
}
