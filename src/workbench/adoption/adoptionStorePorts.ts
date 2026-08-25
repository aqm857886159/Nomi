import { useWorkbenchStore } from '../workbenchStore'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import type { AdoptionApplyPorts } from './adoptionTypes'

/**
 * 采纳桥 ↔ workbenchStore 的**唯一**接线处。
 *
 * 为什么单独一个文件而不是往 store 里加动作：`workbenchStore.ts` 正好 800 行，
 * 是 `check:filesize` 的硬上限，一行都加不得。这里用 `setState` 从外面写，
 * 语义与 store 内的离散编辑完全一致（压栈 + 清 redo + bump persistRevision）。
 */

/** 与 workbenchStore 内 TIMELINE_UNDO_LIMIT 同值。那个是模块私有，这里显式对齐。 */
const TIMELINE_UNDO_LIMIT = 30

/**
 * 原子提交：**一次** set 落定整批 + **压一层**撤销栈。
 *
 * 这一层就是「一步 Undo」的全部实现。旧路径逐个调 `addTimelineClipAtFrame`，
 * 每次都压一层——批量落 12 个镜头，用户要按 12 次 Cmd+Z 才回得去。
 * 这里把整批当**一次编辑**：压入的是采纳前的 base，撤一次全回去。
 */
function commitTimeline(next: TimelineState, base: TimelineState): void {
  useWorkbenchStore.setState((state) => {
    const stack = [...state.timelineUndoStack, base]
    if (stack.length > TIMELINE_UNDO_LIMIT) stack.shift()
    return {
      timeline: normalizeTimeline(next),
      timelineUndoStack: stack,
      // 新编辑使 redo 失效（与 store 内 addTimelineClipAtFrame 一致）。
      timelineRedoStack: [],
      persistRevision: state.persistRevision + 1,
    }
  })
}

/**
 * 补偿：把轴放回 base。返回是否真的放回去了。
 *
 * 这里**不**碰撤销栈——补偿是「这次采纳没发生过」，不是一次可撤销的编辑。
 * 若把补偿也压栈，用户按 Cmd+Z 会撤到一个他从没见过的中间态。
 */
function restoreTimeline(base: TimelineState): boolean {
  const expected = normalizeTimeline(base)
  useWorkbenchStore.setState({ timeline: expected })
  const after = useWorkbenchStore.getState().timeline
  // 只比 clip id 会把半落的字幕/转场、URL 或 trim 丢失误判成「已补回」；
  // compensation 的成功条件是旧时间轴的完整值回来了。
  return JSON.stringify(after) === JSON.stringify(expected)
}

export const workbenchAdoptionPorts: AdoptionApplyPorts = {
  readTimeline: () => useWorkbenchStore.getState().timeline,
  commitTimeline,
  restoreTimeline,
}
