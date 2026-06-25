import type { ClipFraming } from './clipFraming'

// 三轨：图片 / 视频 / 音频。audio 自 2026-06-25 起有独立音频轨（此前寄生 video 轨、跟视频抢位）。
export type TimelineTrackType = 'image' | 'video' | 'audio'
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

// 三轨对称命名。audio 自 2026-06-25 起独立成「音频轨」（配乐/BGM，不再跟视频抢位）。
export const TIMELINE_TRACK_DEFINITIONS: Array<Pick<TimelineTrack, 'id' | 'type' | 'label'>> = [
  { id: 'imageTrack', type: 'image', label: '图片轨' },
  { id: 'videoTrack', type: 'video', label: '视频轨' },
  { id: 'audioTrack', type: 'audio', label: '音频轨' },
]

// clip type → 该挂哪条轨道（现在一一对应，audio 有独立轨）。
export function getTrackTypeForClipType(clipType: TimelineClipType): TimelineTrackType {
  return clipType
}
