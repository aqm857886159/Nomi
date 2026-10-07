// 撤销/重做 = 会话日志前缀重放(harness S5-b-2,取代 canvasHistory 的状态栈)。
// 模型:journal 只追加(发射器同步喂);undo 栈存的不是状态拷贝,是**日志长度位置**(barrier);
// undo = replay(base, journal[0..barrier))。redo 同理存撤销前的位置。
// 等价性:barrier 落点 = 原 pushUndoSnapshot 调用点(同名导出,调用方零改动)——
// 撤销粒度与旧栈逐手势一致(addNode 后的默认参数 patch 不设 barrier,跟旧行为一样随上一 barrier 回退)。
// 内存:HISTORY_LIMIT=80 维持;最老 barrier 被挤出时把前缀压进 base(紧凑化),journal 不无界。
// 撤销只回退**用户编辑**:生成结局落地(run-updated 事件带 `landed`)是系统事实,前缀重放会把 barrier
// 之后落地的结果一起丢掉(钱花了、图没了)——所以 undo/redo 连同目标位置之后的全部落地一起交出去,
// 由 store 重新叠回(store/nodeRunOutcome.reapplyLandedOutcomes)。
import { replayCanvasEvents, emptyCanvasProjection, type CanvasProjection } from './canvasEventReducer'
import { getActiveCanvasGestureContext } from './canvasGestureContext'
import { interruptPendingCanvasWrite } from './canvasWriteBoundary'

type JournalEvent = { type: string; payload: Record<string, unknown>; source?: string; txnId?: string }

export type CanvasChangeConflict = Readonly<{
  changeId: string
  objectIds: readonly string[]
  conflictingEventTypes: readonly string[]
  /** 这笔改动碰过、之后又被别的事务改到的那些对象。 */
  conflictingObjectIds: readonly string[]
}>

const HISTORY_LIMIT = 80

let base: CanvasProjection = emptyCanvasProjection()
let journal: JournalEvent[] = []
let undoBarriers: number[] = []
let redoBarriers: number[] = []
let generation = 0
let journalBasePosition = 0
export type UndoHistoryEviction = { generation: number; oldestReachablePosition: number }

const historyEvictionHandlers = new Set<(eviction: UndoHistoryEviction) => void | Promise<void>>()

export function registerUndoHistoryEvictionHandler(handler: (eviction: UndoHistoryEviction) => void | Promise<void>): () => void {
  historyEvictionHandlers.add(handler)
  return () => historyEvictionHandlers.delete(handler)
}

function replayTo(position: number): CanvasProjection {
  return replayCanvasEvents(journal.slice(0, position), base)
}

/** 一次生成结局落地:哪个节点、落了什么(结局原样,store 侧解释)。 */
export type CanvasLanding = Readonly<{ nodeId: string; landed: Readonly<Record<string, unknown>> }>
/** 撤销/重做的结果:用户编辑回到目标位置的投影 + 目标位置之后发生的全部落地(必须叠回,不许丢)。 */
export type UndoRestore = Readonly<{ projection: CanvasProjection; landingsAfter: readonly CanvasLanding[] }>

// 落地记账两种：节点在时落下的（run-updated 带 landed）；节点不在时到达、暂存的（outcome-held）。
function landingsAfter(position: number): CanvasLanding[] {
  return journal.slice(position).flatMap((event) => {
    const landed = event.payload.landed
    const nodeId = event.type === 'canvas.node.run-updated'
      ? (event.payload.node as { id?: unknown } | undefined)?.id
      : event.type === 'canvas.node.outcome-held' ? event.payload.nodeId : undefined
    if (!landed || typeof landed !== 'object' || typeof nodeId !== 'string') return []
    return [{ nodeId, landed: landed as Record<string, unknown> }]
  })
}

function restoreTo(position: number): UndoRestore {
  return { projection: replayTo(position), landingsAfter: landingsAfter(position) }
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
  interruptPendingCanvasWrite()
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
    journalBasePosition += dropTo
    const oldestReachablePosition = getOldestReachableUndoPosition()
    for (const handler of historyEvictionHandlers) void handler({ generation, oldestReachablePosition })
  }
}

/** undo:弹出最近 barrier,返回该位置的前缀重放投影(+ 其后的落地);当前长度入 redo 栈。 */
export function popUndo(): UndoRestore | undefined {
  interruptPendingCanvasWrite()
  const barrier = undoBarriers.at(-1)
  if (barrier === undefined) return undefined
  undoBarriers = undoBarriers.slice(0, -1)
  redoBarriers = [...redoBarriers, journal.length].slice(-HISTORY_LIMIT)
  return restoreTo(barrier)
}

/** redo:回到撤销前的日志位置(该位置前缀=撤销前画布,因为日志只追加)。 */
export function popRedo(): UndoRestore | undefined {
  interruptPendingCanvasWrite()
  const position = redoBarriers.at(-1)
  if (position === undefined) return undefined
  redoBarriers = redoBarriers.slice(0, -1)
  undoBarriers = [...undoBarriers, journal.length].slice(-HISTORY_LIMIT)
  return restoreTo(position)
}

/** S6-2 事务边界:记录当前日志位置(abort 清理的锚点)。 */
export function getUndoJournalPosition(): number {
  return journal.length
}

export function getLatestUndoBarrierAbsolutePosition(): number | undefined {
  const barrier = undoBarriers.at(-1)
  return barrier === undefined ? undefined : journalBasePosition + barrier
}

export function getOldestReachableUndoPosition(): number {
  const reachable = [...undoBarriers, ...redoBarriers]
  return reachable.length === 0
    ? journalBasePosition + journal.length
    : journalBasePosition + Math.min(...reachable)
}

/** Loaded-canvas identity, not a content revision. A new chat does not change
 * the transaction's compensation target; replacing/clearing its canvas does. */
export function getUndoJournalGeneration(): number {
  return generation
}

/** Read conflict evidence from the same session journal used by Cmd+Z. */
export function findCanvasChange(changeId: string): CanvasChangeConflict | null {
  const commitIndex = journal.findIndex((event) => event.type === 'agent.txn.committed' && event.payload.changeId === changeId)
  if (commitIndex < 0) return null
  const payload = journal[commitIndex].payload
  const objectIds = Array.isArray(payload.objectIds)
    ? payload.objectIds.filter((value): value is string => typeof value === 'string')
    : []
  const ids = new Set(objectIds)
  const conflictingEventTypes = new Set<string>()
  const conflictingObjectIds = new Set<string>()
  for (const event of journal.slice(commitIndex + 1)) {
    if (event.payload.changeId === changeId || event.txnId === journal[commitIndex].txnId) continue
    const payloadIds = Object.values(event.payload).flatMap((value) => {
      if (typeof value === 'string') return [value]
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
      if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter((item): item is string => typeof item === 'string')
      return []
    })
    const touched = payloadIds.filter((id) => ids.has(id))
    touched.forEach((id) => conflictingObjectIds.add(id))
    if (event.type === 'canvas.snapshot.restored' || touched.length) conflictingEventTypes.add(event.type)
  }
  return { changeId, objectIds, conflictingEventTypes: [...conflictingEventTypes], conflictingObjectIds: [...conflictingObjectIds] }
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
  generation += 1
  journalBasePosition = 0
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
  generation += 1
  journalBasePosition = 0
  base = { nodes: projection.nodes, edges: projection.edges, groups: projection.groups }
  journal = []
  undoBarriers = []
  redoBarriers = []
}

export function __resetCanvasUndoJournalForTests(): void {
  clearHistory()
}
