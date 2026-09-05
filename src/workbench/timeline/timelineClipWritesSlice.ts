import type { StateCreator } from 'zustand'
import { setClipFraming } from './timelineEdit'
import type { ClipFraming } from './clipFraming'
import { applyTimelineOperation } from './kernel/timelineKernel'
import type { TimelineClipAudio, TimelineState } from './timelineTypes'
import type { TimelineUndoEntry } from './timelineUndoHistory'

/**
 * 片段级写入：取景（适应/填充 · 缩放 · 平移）与音频（音量 · 静音 · 淡入淡出）。
 * 从 workbenchStore 拆出来守 R9/R12 巨壳门；两者是同一类东西——属性面板里改一个值，
 * 落到同一条时间轴上。
 *
 * 两者的落盘语义**故意不同**，别把它们统一：
 *  · 取景是纯几何投影（setClipFraming），不进内核、不进撤销栈——拖动时每帧都在变，
 *    压栈会把撤销历史冲垮；commit:false 时连 persistRevision 都不 bump。
 *  · 音频要过内核校验（timelineKernel 的 clip-audio：dB 越界、淡入淡出重叠、图片轨不支持），
 *    所以走 applyTimelineOperation 并压撤销栈，一次 ⌘Z 能还原。
 */
export type TimelineClipWritesSlice = {
  /** 设置 clip 取景。拖动/连续缩放传 commit:false，落定 commit:true 落盘一次。 */
  setTimelineClipFraming: (clipId: string, patch: Partial<ClipFraming>, options?: { commit?: boolean }) => void
  /** 写入 clip.audio，经内核校验；图片片段直接忽略（clip_audio_unsupported）。 */
  setTimelineClipAudio: (clipId: string, patch: Partial<TimelineClipAudio>, options?: { commit?: boolean }) => void
}

type ClipWritesHostState = {
  timeline: TimelineState
  timelineUndoStack: TimelineUndoEntry[]
  timelineRedoStack: TimelineState[]
  selectedTimelineClipIds: string[]
  persistRevision: number
} & TimelineClipWritesSlice

export function createTimelineClipWritesSlice(
  pushTimelineUndo: (stack: TimelineUndoEntry[], entry: TimelineState) => TimelineUndoEntry[],
): StateCreator<ClipWritesHostState, [['zustand/subscribeWithSelector', never]], [], TimelineClipWritesSlice> {
  return (set) => ({
    setTimelineClipFraming: (clipId, patch, options) => {
      const commit = options?.commit !== false
      set((state) => {
        const next = setClipFraming(state.timeline, clipId, patch)
        const changed = next !== state.timeline
        return { timeline: next, persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision }
      })
    },
    setTimelineClipAudio: (clipId, patch, options) => {
      const commit = options?.commit !== false
      set((state) => {
        const source = state.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
        if (!source || source.type === 'image') return state
        const result = applyTimelineOperation(state.timeline, { kind: 'clip-audio', clipId, audio: { ...(source.audio ?? {}), ...patch } })
        if (!result.ok || !result.diff.changed) return state
        return {
          timeline: result.timeline,
          timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline),
          timelineRedoStack: [],
          selectedTimelineClipIds: [clipId],
          persistRevision: commit ? state.persistRevision + 1 : state.persistRevision,
        }
      })
    },
  })
}
