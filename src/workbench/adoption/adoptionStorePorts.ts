import { useWorkbenchStore } from '../workbenchStore'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import type { TimelineUndoEntry } from '../timeline/timelineUndoHistory'
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

type AdoptionUndoStacks = {
  undo: readonly TimelineUndoEntry[]
  redo: readonly TimelineState[]
}

/**
 * 最近一次 commit **写入前**的撤销/重做栈快照。
 *
 * 只在 `applyAdoption` 内部的 commit → restore 这一段同步窗口里有意义：
 * `applyAdoption` 是同步函数，commit 抛错或写后校验失败时立刻在同一个调用栈里补偿，
 * 中间不会插进第二次采纳。commit 成功后即清空，避免把陈旧快照带给下一次补偿。
 */
let lastCommittedStacks: AdoptionUndoStacks | null = null

/**
 * 原子提交：**一次** set 落定整批 + **压一层**撤销栈。
 *
 * 这一层就是「一步 Undo」的全部实现。旧路径逐个调 `addTimelineClipAtFrame`，
 * 每次都压一层——批量落 12 个镜头，用户要按 12 次 Cmd+Z 才回得去。
 * 这里把整批当**一次编辑**：压入的是采纳前的 base，撤一次全回去。
 */
function commitTimeline(next: TimelineState, base: TimelineState, undoEntry: TimelineUndoEntry = base): void {
  useWorkbenchStore.setState((state) => {
    // 记下压栈**前**的两个栈，供补偿对称还原（见 restoreTimeline）。
    lastCommittedStacks = { undo: state.timelineUndoStack, redo: state.timelineRedoStack }
    const stack = [...state.timelineUndoStack, undoEntry]
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
 * 补偿：把轴**和撤销/重做栈**一起放回采纳前。返回是否真的放回去了。
 *
 * 这里**不**给补偿本身压栈——补偿是「这次采纳没发生过」，不是一次可撤销的编辑。
 * 但光还原 `timeline` 是不够的：`commitTimeline` 在失败前已经把 base 压进了
 * `timelineUndoStack` 并清空了 `timelineRedoStack`。只还原轴会在栈顶留一条**幽灵记录**
 * ——它和补偿后的当前轴是同一个值，用户下一次 Cmd+Z（`workbenchStore.ts:532` 无条件弹栈）
 * 因此什么都不会变，看起来就是撤销键坏了；同时那次被清掉的 redo 历史再也回不来。
 * 所以补偿的还原范围必须和 commit 的写入范围**对称**：轴 + 两个栈一起回。
 */
function restoreTimeline(base: TimelineState): boolean {
  const expected = normalizeTimeline(base)
  const stacks = lastCommittedStacks
  lastCommittedStacks = null
  useWorkbenchStore.setState({
    timeline: expected,
    ...(stacks
      ? { timelineUndoStack: [...stacks.undo], timelineRedoStack: [...stacks.redo] }
      : {}),
  })
  const after = useWorkbenchStore.getState()
  // 只比 clip id 会把半落的字幕/转场、URL 或 trim 丢失误判成「已补回」；
  // compensation 的成功条件是旧时间轴的完整值回来了。
  if (JSON.stringify(after.timeline) !== JSON.stringify(expected)) return false
  if (!stacks) return true
  // 栈也必须真的回到 commit 前——否则「补偿成功」只是补了一半。
  return after.timelineUndoStack.length === stacks.undo.length
    && after.timelineRedoStack.length === stacks.redo.length
}

export const workbenchAdoptionPorts: AdoptionApplyPorts = {
  readTimeline: () => useWorkbenchStore.getState().timeline,
  commitTimeline,
  restoreTimeline,
}

/** 采纳成功收尾：丢掉快照，别把它留给下一次不相干的补偿。 */
export function clearAdoptionUndoSnapshot(): void {
  lastCommittedStacks = null
}
