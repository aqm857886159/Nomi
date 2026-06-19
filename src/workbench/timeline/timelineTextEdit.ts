import type { TimelineState, TimelineTextClip, TimelineTextStyle } from './timelineTypes'
import { DEFAULT_TEXT_CLIP_SECONDS, defaultTextForStyle } from './textLayout'
import { clampCenter, clampScale, type Vec2 } from './overlayTransform'

function clampInteger(value: number, min: number): number {
  const next = Math.floor(Number(value))
  return Number.isFinite(next) ? Math.max(min, next) : min
}

// 文字 clip id 必须全局唯一且与「已落盘的旧 clip」不冲突。早先用每次加载归零的自增序列，
// 反序列化出的旧 clip 仍带上一会话 text-1/2…，新建时序列从 0 重数 → text-1 撞旧 clip：
// updateTextClipText 的 map 同时命中两条、React key 重复 → 改一条把另一条也改了。
// 改用 crypto.randomUUID（仓库既有 id 范式），无论持久化都不撞，根除整类。
function createTextClipId(): string {
  return `text-${crypto.randomUUID()}`
}

function sortTextClips(clips: TimelineTextClip[]): TimelineTextClip[] {
  return [...clips].sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
}

/** 在 playhead 处新增一条字幕/标题卡（默认 3s）。返回新 timeline + 新 clip id。 */
export function addTextClip(
  timeline: TimelineState,
  style: TimelineTextStyle,
  startFrame: number,
): { timeline: TimelineState; id: string } {
  const id = createTextClipId()
  const start = clampInteger(startFrame, 0)
  const duration = Math.max(1, Math.round(DEFAULT_TEXT_CLIP_SECONDS * timeline.fps))
  const clip: TimelineTextClip = {
    id,
    text: defaultTextForStyle(style),
    style,
    startFrame: start,
    endFrame: start + duration,
  }
  return {
    timeline: { ...timeline, textClips: sortTextClips([...timeline.textClips, clip]) },
    id,
  }
}

export function updateTextClipText(timeline: TimelineState, id: string, text: string): TimelineState {
  let changed = false
  const textClips = timeline.textClips.map((clip) => {
    if (clip.id !== id || clip.text === text) return clip
    changed = true
    return { ...clip, text }
  })
  return changed ? { ...timeline, textClips } : timeline
}

/** 移动文字 clip 起点（保持时长），夹到 ≥0。 */
export function moveTextClip(timeline: TimelineState, id: string, startFrame: number): TimelineState {
  let changed = false
  const textClips = timeline.textClips.map((clip) => {
    if (clip.id !== id) return clip
    const duration = clip.endFrame - clip.startFrame
    const nextStart = clampInteger(startFrame, 0)
    if (nextStart === clip.startFrame) return clip
    changed = true
    return { ...clip, startFrame: nextStart, endFrame: nextStart + duration }
  })
  return changed ? { ...timeline, textClips: sortTextClips(textClips) } : timeline
}

/** 调整文字 clip 某一边（裁时长），保证至少 1 帧。 */
export function resizeTextClip(
  timeline: TimelineState,
  id: string,
  edge: 'left' | 'right',
  frame: number,
): TimelineState {
  let changed = false
  const textClips = timeline.textClips.map((clip) => {
    if (clip.id !== id) return clip
    if (edge === 'left') {
      const nextStart = Math.min(clampInteger(frame, 0), clip.endFrame - 1)
      if (nextStart === clip.startFrame) return clip
      changed = true
      return { ...clip, startFrame: nextStart }
    }
    const nextEnd = Math.max(clampInteger(frame, 0), clip.startFrame + 1)
    if (nextEnd === clip.endFrame) return clip
    changed = true
    return { ...clip, endFrame: nextEnd }
  })
  return changed ? { ...timeline, textClips: sortTextClips(textClips) } : timeline
}

export function updateTextClipFont(timeline: TimelineState, id: string, fontId: string): TimelineState {
  let changed = false
  const textClips = timeline.textClips.map((clip) => {
    if (clip.id !== id || clip.fontFamily === fontId) return clip
    changed = true
    return { ...clip, fontFamily: fontId }
  })
  return changed ? { ...timeline, textClips } : timeline
}

export function removeTextClip(timeline: TimelineState, id: string): TimelineState {
  const textClips = timeline.textClips.filter((clip) => clip.id !== id)
  return textClips.length === timeline.textClips.length ? timeline : { ...timeline, textClips }
}

/** 更新文字 clip 的通用变换（位置/缩放）。position 夹在画面内、scale 夹到合法区间。 */
export function updateTextClipTransform(
  timeline: TimelineState,
  id: string,
  patch: { position?: Vec2; scale?: number },
): TimelineState {
  let changed = false
  const textClips = timeline.textClips.map((clip) => {
    if (clip.id !== id) return clip
    const next: TimelineTextClip = { ...clip }
    if (patch.position) { next.position = clampCenter(patch.position); changed = true }
    if (patch.scale !== undefined) { next.scale = clampScale(patch.scale); changed = true }
    return next
  })
  return changed ? { ...timeline, textClips } : timeline
}
