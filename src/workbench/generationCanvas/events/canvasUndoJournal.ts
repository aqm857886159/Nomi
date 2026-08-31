// 撤销/重做 = 会话日志前缀重放(harness S5-b-2,取代 canvasHistory 的状态栈)。
// 模型:journal 只追加(发射器同步喂);undo 栈存的不是状态拷贝,是**日志长度位置**(barrier);
// undo = replay(base, journal[0..barrier))。redo 同理存撤销前的位置。
// 等价性:barrier 落点 = 原 pushUndoSnapshot 调用点(同名导出,调用方零改动)——
// 撤销粒度与旧栈逐手势一致(addNode 后的默认参数 patch 不设 barrier,跟旧行为一样随上一 barrier 回退)。
// 内存:HISTORY_LIMIT=80 维持;最老 barrier 被挤出时把前缀压进 base(紧凑化),journal 不无界。
import { applyCanvasEvent, emptyCanvasProjection, type CanvasProjection } from './canvasEventReducer'
import { getActiveCanvasGestureContext } from './canvasGestureContext'

type JournalEvent = { type: string; payload: Record<string, unknown> }

const HISTORY_LIMIT = 80

let base: CanvasProjection = emptyCanvasProjection()
let journal: JournalEvent[] = []
let undoBarriers: number[] = []
let redoBarriers: number[] = []

function replayTo(position: number): CanvasProjection {
  let projection = base
  for (let index = 0; index < position && index < journal.length; index += 1) {
    projection = applyCanvasEvent(projection, journal[index])
  }
  return projection
}

/** 发射器同步喂(canvas 域全部事件,含 snapshot.restored)。 */
export function appendToUndoJournal(events: readonly JournalEvent[]): void {
  for (const event of events) journal.push(event)
}

export function getHistoryFlags(): { canUndo: boolean; canRedo: boolean } {
  return { canUndo: undoBarriers.length > 0, canRedo: redoBarriers.length > 0 }
}

/** 同名兼容旧 API:在写操作前打 barrier(参数保留签名但不再拷贝状态)。
 *  S6-2:提议事务期间(suppressUndoBarriers)action 级 barrier 不打——
 *  整笔提议=一次用户意志=一个 Cmd+Z 步,事务自己在边界打。 */
export function pushUndoSnapshot(_state?: unknown): void {
  if (getActiveCanvasGestureContext()?.suppressUndoBarriers) return
  undoBarriers.push(journal.length)
  redoBarriers = []
  if (undoBarriers.length > HISTORY_LIMIT) {
    // 紧凑化:最老 barrier 之前的前缀压进 base,所有位置左移
    const dropTo = undoBarriers[0]
    base = replayTo(dropTo)
    journal = journal.slice(dropTo)
    undoBarriers = undoBarriers.slice(1).map((position) => position - dropTo)
    redoBarriers = redoBarriers.map((position) => position - dropTo)
  }
}

/** undo:弹出最近 barrier,返回该位置的前缀重放投影;当前长度入 redo 栈。 */
export function popUndo(): CanvasProjection | undefined {
  const barrier = undoBarriers.at(-1)
  if (barrier === undefined) return undefined
  undoBarriers = undoBarriers.slice(0, -1)
  redoBarriers = [...redoBarriers, journal.length].slice(-HISTORY_LIMIT)
  return replayTo(barrier)
}

/** redo:回到撤销前的日志位置(该位置前缀=撤销前画布,因为日志只追加)。 */
export function popRedo(): CanvasProjection | undefined {
  const position = redoBarriers.at(-1)
  if (position === undefined) return undefined
  redoBarriers = redoBarriers.slice(0, -1)
  undoBarriers = [...undoBarriers, journal.length].slice(-HISTORY_LIMIT)
  return replayTo(position)
}

/** S6-2 事务边界:记录当前日志位置(abort 清理的锚点)。 */
export function getUndoJournalPosition(): number {
  return journal.length
}

/**
 * S6-2 abort 清理:撤掉位置 ≥ position 的全部 barrier(含事务自己打的那个)。
 * 净零事务(应用+补偿)留在 journal 里无害——前缀重放天然容忍中段净零事件;
 * 但指向事务中段的 barrier 必须拔掉,否则 Cmd+Z 会复活半截态。
 */
export function dropUndoBarriersAfter(position: number): void {
  undoBarriers = undoBarriers.filter((barrier) => barrier < position)
  redoBarriers = redoBarriers.filter((barrier) => barrier < position)
}

/** 切项目/hydrate:历史清零(会话内撤销语义,跨会话历史只在磁盘日志供审计)。 */
export function clearHistory(): void {
  base = emptyCanvasProjection()
  journal = []
  undoBarriers = []
  redoBarriers = []
}

/**
 * restoreSnapshot 后调:以恢复出的画布当 journal 起点——否则第一笔 barrier 之前
 * 没有任何事件,undo 会回放到空白(生产路径的 genesis 事件随后追加,内容相同,幂等)。
 */
export function seedUndoJournalBase(projection: CanvasProjection): void {
  base = { nodes: projection.nodes, edges: projection.edges, groups: projection.groups }
  journal = []
  undoBarriers = []
  redoBarriers = []
}

export function __resetCanvasUndoJournalForTests(): void {
  clearHistory()
}
