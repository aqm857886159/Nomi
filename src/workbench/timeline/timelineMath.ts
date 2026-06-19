import {
  TIMELINE_TRACK_DEFINITIONS,
  type TimelineClip,
  type TimelineState,
  type TimelineTextClip,
  type TimelineTextStyle,
  type TimelineTrack,
  type TimelineTrackType,
} from './timelineTypes'
import { resolveClipFraming, type ClipFraming } from './clipFraming'

const DEFAULT_TIMELINE_SCALE = 1
const DEFAULT_TIMELINE_FPS = 30

/**
 * 帧率 derive：接受持久化/导入携带的 fps，非正/非有限值回退默认 30。
 * 导出维度、duration、adelay 等全链路都按这个 fps 走，所以这里是单一真相源——
 * 不能像旧 normalizeTimeline 那样硬钉 30 把外部 fps 抹掉。
 */
function normalizeFps(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next) || next <= 0) return DEFAULT_TIMELINE_FPS
  return next
}

function toFiniteNonNegativeInteger(value: unknown, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, Math.floor(next))
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeClip(input: unknown, fallbackType: TimelineTrackType): TimelineClip | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = normalizeString(raw.id)
  const sourceNodeId = normalizeString(raw.sourceNodeId)
  if (!id || !sourceNodeId) return null

  // v0.7.1: 接受 audio clip type
  const type = raw.type === 'image' || raw.type === 'video' || raw.type === 'audio'
    ? raw.type
    : fallbackType
  const startFrame = toFiniteNonNegativeInteger(raw.startFrame, 0)
  const rawFrameCount = toFiniteNonNegativeInteger(raw.frameCount, 0)
  const rawEndFrame = toFiniteNonNegativeInteger(raw.endFrame, startFrame + rawFrameCount)
  const endFrame = Math.max(startFrame, rawEndFrame)
  const frameCount = Math.max(0, rawFrameCount || endFrame - startFrame)

  return {
    id,
    type,
    sourceNodeId,
    label: normalizeString(raw.label),
    startFrame,
    // video/audio 的 frameCount 是素材全长（可 > 可见窗口），不能用它撑大 endFrame；
    // endFrame 缺省时已由上方 rawEndFrame（startFrame + rawFrameCount）兜底。image 行为不变。
    endFrame,
    frameCount,
    offsetStartFrame: toFiniteNonNegativeInteger(raw.offsetStartFrame, 0),
    offsetEndFrame: toFiniteNonNegativeInteger(raw.offsetEndFrame, 0),
    ...(normalizeString(raw.url) ? { url: normalizeString(raw.url) } : {}),
    ...(normalizeString(raw.thumbnailUrl) ? { thumbnailUrl: normalizeString(raw.thumbnailUrl) } : {}),
    // 取景随时间轴落盘：present 才挂（清洗成合法 framing），缺省则不挂 → 切项目/重载不蒸发。
    ...(raw.framing && typeof raw.framing === 'object'
      ? { framing: resolveClipFraming({ framing: raw.framing as Partial<ClipFraming> }) }
      : {}),
  }
}

function normalizeUnitInterval(value: unknown): number | null {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return null
  return Math.min(1, Math.max(0, next))
}

function normalizeTextClip(input: unknown): TimelineTextClip | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = normalizeString(raw.id)
  if (!id) return null
  const style: TimelineTextStyle = raw.style === 'title' ? 'title' : 'caption'
  const startFrame = toFiniteNonNegativeInteger(raw.startFrame, 0)
  const endFrame = Math.max(startFrame + 1, toFiniteNonNegativeInteger(raw.endFrame, startFrame + 1))
  const clip: TimelineTextClip = {
    id,
    text: typeof raw.text === 'string' ? raw.text : '',
    style,
    startFrame,
    endFrame,
  }
  // 通用变换（可选）：旧 clip 无 → 缺省，渲染时回退预设位。
  const rawPos = raw.position
  if (rawPos && typeof rawPos === 'object') {
    const px = normalizeUnitInterval((rawPos as Record<string, unknown>).x)
    const py = normalizeUnitInterval((rawPos as Record<string, unknown>).y)
    if (px !== null && py !== null) clip.position = { x: px, y: py }
  }
  if (Number.isFinite(Number(raw.scale))) clip.scale = Math.min(5, Math.max(0.2, Number(raw.scale)))
  if (Number.isFinite(Number(raw.rotation))) clip.rotation = Number(raw.rotation)
  if (typeof raw.fontFamily === 'string' && raw.fontFamily) clip.fontFamily = raw.fontFamily
  return clip
}

function createDefaultTrack(definition: Pick<TimelineTrack, 'id' | 'type' | 'label'>): TimelineTrack {
  return {
    ...definition,
    clips: [],
  }
}

export function createDefaultTimeline(): TimelineState {
  return {
    version: 1,
    fps: DEFAULT_TIMELINE_FPS,
    scale: DEFAULT_TIMELINE_SCALE,
    playheadFrame: 0,
    tracks: TIMELINE_TRACK_DEFINITIONS.map(createDefaultTrack),
    textClips: [],
  }
}

export function normalizeTimeline(input: unknown): TimelineState {
  if (!input || typeof input !== 'object') return createDefaultTimeline()
  const raw = input as Record<string, unknown>
  const inputTracks = Array.isArray(raw.tracks) ? raw.tracks : []

  const tracks = TIMELINE_TRACK_DEFINITIONS.map((definition) => {
    const persisted = inputTracks.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false
      const record = candidate as Record<string, unknown>
      return record.id === definition.id || record.type === definition.type
    }) as Record<string, unknown> | undefined
    const rawClips = Array.isArray(persisted?.clips) ? persisted.clips : []
    const clips = rawClips
      .map((clip) => normalizeClip(clip, definition.type))
      .filter((clip): clip is TimelineClip => Boolean(clip))
      .filter((clip) => clip.type === definition.type)
      .sort((left, right) => left.startFrame - right.startFrame)

    return {
      ...definition,
      clips,
    }
  })

  // 迁移：旧工程无 textClips → []。
  // 自愈：早先的自增-归零 id 生成器会让「跨会话新建」的 clip 撞上落盘旧 clip 的 id
  //（详见 timelineTextEdit.createTextClipId 注释）。已损坏工程里可能存着重复 id，
  // 重复 id 会让编辑一条串改另一条 + React key 重复。这里加载时把重复 id 重新铸成唯一 id。
  const seenTextIds = new Set<string>()
  const textClips = (Array.isArray(raw.textClips) ? raw.textClips : [])
    .map(normalizeTextClip)
    .filter((clip): clip is TimelineTextClip => Boolean(clip))
    .map((clip) => {
      if (!seenTextIds.has(clip.id)) {
        seenTextIds.add(clip.id)
        return clip
      }
      return { ...clip, id: `text-${crypto.randomUUID()}` }
    })
    .sort((left, right) => left.startFrame - right.startFrame)

  return {
    version: 1,
    fps: normalizeFps(raw.fps),
    scale: Math.max(0.1, Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : DEFAULT_TIMELINE_SCALE),
    playheadFrame: toFiniteNonNegativeInteger(raw.playheadFrame, 0),
    tracks,
    textClips,
  }
}

export function computeTimelineDuration(timeline: TimelineState): number {
  // 防御缺字段：textClips 是后加的字段，旧时间轴 / 直接构造的对象可能没有；tracks 同理保险。
  // 无文本片段 = 不撑时长（textMax 0），不应 undefined.reduce 崩掉整条导出/时长计算。
  const trackMax = (timeline.tracks ?? []).reduce((maxFrame, track) => {
    const clipMax = (track.clips ?? []).reduce((current, clip) => Math.max(current, clip.endFrame), 0)
    return Math.max(maxFrame, clipMax)
  }, 0)
  // 末尾的标题卡/字幕也应撑出时长（如片尾标题）。
  const textMax = (timeline.textClips ?? []).reduce((maxFrame, clip) => Math.max(maxFrame, clip.endFrame), 0)
  return Math.max(trackMax, textMax)
}

export function resolveActiveClipsAtFrame(timeline: TimelineState, frame: number): TimelineClip[] {
  const targetFrame = toFiniteNonNegativeInteger(frame, 0)
  return timeline.tracks.flatMap((track) =>
    track.clips.filter((clip) => clip.startFrame <= targetFrame && targetFrame < clip.endFrame),
  )
}

export function resolveActiveTextClipsAtFrame(timeline: TimelineState, frame: number): TimelineTextClip[] {
  const targetFrame = toFiniteNonNegativeInteger(frame, 0)
  return (timeline.textClips ?? []).filter((clip) => clip.startFrame <= targetFrame && targetFrame < clip.endFrame)
}

export function hasClipOverlap(track: TimelineTrack, clip: TimelineClip): boolean {
  return track.clips.some((current) => {
    if (current.id === clip.id) return false
    return clip.startFrame < current.endFrame && current.startFrame < clip.endFrame
  })
}

export function findAppendFrame(track: TimelineTrack): number {
  return track.clips.reduce((maxFrame, clip) => Math.max(maxFrame, clip.endFrame), 0)
}
