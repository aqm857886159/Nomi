import type { TimelineState, TimelineTextClip, TimelineTextStyle } from './timelineTypes'
import { DEFAULT_TEXT_CLIP_SECONDS, defaultTextForStyle } from './textLayout'

function clampInteger(value: number, min: number): number {
  const next = Math.floor(Number(value))
  return Number.isFinite(next) ? Math.max(min, next) : min
}

let textClipSeq = 0
function createTextClipId(): string {
  textClipSeq += 1
  return `text-${textClipSeq.toString(36)}-${(textClipSeq * 2654435761 % 0xffffff).toString(36)}`
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

export function removeTextClip(timeline: TimelineState, id: string): TimelineState {
  const textClips = timeline.textClips.filter((clip) => clip.id !== id)
  return textClips.length === timeline.textClips.length ? timeline : { ...timeline, textClips }
}
