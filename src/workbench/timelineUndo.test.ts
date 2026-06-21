import { describe, expect, it, beforeEach } from 'vitest'
import { useWorkbenchStore } from './workbenchStore'
import { createDefaultTimeline } from './timeline/timelineMath'
import type { TimelineClip } from './timeline/timelineTypes'

function imageClip(id: string, start: number, frames: number): TimelineClip {
  return {
    id,
    type: 'image',
    sourceNodeId: 'node-' + id,
    label: id,
    url: '',
    startFrame: start,
    endFrame: start + frames,
    frameCount: frames,
  } as TimelineClip
}

describe('时间轴撤销栈', () => {
  beforeEach(() => {
    const tl = createDefaultTimeline()
    useWorkbenchStore.setState({ timeline: tl, timelineUndoStack: [], timelineRedoStack: [], selectedTimelineClipIds: [], selectedTextClipId: '' })
  })

  it('离散编辑（分割）压栈，undo 还原', () => {
    const s = useWorkbenchStore.getState()
    s.addTimelineClipAtFrame(imageClip('a', 0, 90), 'image', 0)
    const beforeSplit = useWorkbenchStore.getState().timeline
    const clipCountBefore = beforeSplit.tracks.flatMap((t) => t.clips).length
    useWorkbenchStore.getState().splitTimelineClip('a', 45)
    const afterSplit = useWorkbenchStore.getState().timeline
    expect(afterSplit.tracks.flatMap((t) => t.clips).length).toBe(clipCountBefore + 1)
    // 撤销 → 回到分割前
    useWorkbenchStore.getState().undoTimeline()
    expect(useWorkbenchStore.getState().timeline.tracks.flatMap((t) => t.clips).length).toBe(clipCountBefore)
  })

  it('无变更的操作不压栈（避免空 undo）', () => {
    useWorkbenchStore.getState().addTimelineClipAtFrame(imageClip('a', 0, 90), 'image', 0)
    const stackLen = useWorkbenchStore.getState().timelineUndoStack.length
    // 在片段边缘分割 = no-op
    useWorkbenchStore.getState().splitTimelineClip('a', 0)
    expect(useWorkbenchStore.getState().timelineUndoStack.length).toBe(stackLen)
  })

  it('captureTimelineUndo 去重：连续压同一状态只入一次', () => {
    useWorkbenchStore.getState().captureTimelineUndo()
    useWorkbenchStore.getState().captureTimelineUndo()
    expect(useWorkbenchStore.getState().timelineUndoStack.length).toBe(1)
  })

  it('栈封顶 30', () => {
    for (let i = 0; i < 40; i += 1) {
      // 每次改个不同 timeline 引用以便去重不挡
      useWorkbenchStore.setState({ timeline: { ...createDefaultTimeline(), playheadFrame: i } })
      useWorkbenchStore.getState().captureTimelineUndo()
    }
    expect(useWorkbenchStore.getState().timelineUndoStack.length).toBeLessThanOrEqual(30)
  })

  it('空栈 undo 安全无操作', () => {
    const before = useWorkbenchStore.getState().timeline
    useWorkbenchStore.getState().undoTimeline()
    expect(useWorkbenchStore.getState().timeline).toBe(before)
  })

  it('redo：undo 后能重做回去', () => {
    const s = useWorkbenchStore.getState()
    s.addTimelineClipAtFrame(imageClip('a', 0, 90), 'image', 0)
    s.splitTimelineClip('a', 45)
    const splitCount = useWorkbenchStore.getState().timeline.tracks.flatMap((t) => t.clips).length
    useWorkbenchStore.getState().undoTimeline()
    const undoneCount = useWorkbenchStore.getState().timeline.tracks.flatMap((t) => t.clips).length
    expect(undoneCount).toBe(splitCount - 1)
    useWorkbenchStore.getState().redoTimeline()
    expect(useWorkbenchStore.getState().timeline.tracks.flatMap((t) => t.clips).length).toBe(splitCount)
  })

  it('新编辑清空 redo 栈（undo 后再做新编辑 → 不能 redo 回陈旧态）', () => {
    const s = useWorkbenchStore.getState()
    s.addTimelineClipAtFrame(imageClip('a', 0, 90), 'image', 0)
    s.splitTimelineClip('a', 45)
    useWorkbenchStore.getState().undoTimeline()
    expect(useWorkbenchStore.getState().timelineRedoStack.length).toBe(1)
    // 撤销后做一个新编辑 → redo 栈必须清空
    useWorkbenchStore.getState().addTimelineClipAtFrame(imageClip('b', 100, 60), 'image', 100)
    expect(useWorkbenchStore.getState().timelineRedoStack.length).toBe(0)
    const before = useWorkbenchStore.getState().timeline
    useWorkbenchStore.getState().redoTimeline() // 空 redo → no-op
    expect(useWorkbenchStore.getState().timeline).toBe(before)
  })

  it('空栈 redo 安全无操作', () => {
    const before = useWorkbenchStore.getState().timeline
    useWorkbenchStore.getState().redoTimeline()
    expect(useWorkbenchStore.getState().timeline).toBe(before)
  })
})
