import { getActiveCanvasGestureContext } from './canvasGestureContext'
import { interruptPendingCanvasWrite } from './canvasWriteBoundary'
import { emptyCanvasProjection, type CanvasProjection } from './canvasEventReducer'
import { applyCanvasDocumentPatches, diffCanvasDocument, type CanvasPatchBatch, type PatchDirection } from './canvasDocumentPatches'
import type { ProductionCanvasSignal } from '../../production/productionCanvasSignals'

export type CanvasChangeConflict = Readonly<{
  changeId: string
  objectIds: readonly string[]
  conflictingEventTypes: readonly string[]
  conflictingObjectIds: readonly string[]
}>
type Change = { since: number; txnId?: string; objectIds: string[]; types: Set<string>; conflicts: Set<string> }
type HistoryEvent = { type: string; payload: Record<string, unknown>; source?: string; txnId?: string }
type Landing = { nodeId: string; landed: Readonly<Record<string, unknown>> }
export type ProductionCanvasHistoryIntent = { kind: 'none' } | { kind: 'signals'; signals: readonly ProductionCanvasSignal[] }
export type UndoRestore = {
  projection: CanvasProjection
  landingsAfter: readonly Landing[]
  createdNodeIds: ReadonlySet<string>
  productionCanvasIntent: ProductionCanvasHistoryIntent
}
type Step = {
  position: number
  batches: CanvasPatchBatch[]
  touched: Set<string>
  created: Set<string>
  landings: Landing[]
  signals: ProductionCanvasSignal[]
  receipts: string[]
}

const undo: Step[] = []
const redo: Step[] = []
const changes = new Map<string, Change>()
const changesByObject = new Map<string, Set<string>>()
let lastRestore = -1
// A landing is shared with just the reachable steps which can replace that node.
const affectedSteps = new Map<string, Set<Step>>()
let generation = 0
let position = 0
let active: Step | undefined
let previous: CanvasProjection | undefined
let read = emptyCanvasProjection
let settleReachable: (restore: UndoRestore, live: CanvasProjection) => CanvasProjection = restore => restore.projection
export function bindCanvasHistoryDocument(reader: () => CanvasProjection, settle: typeof settleReachable) {
  read = reader
  settleReachable = settle
}

export type UndoHistoryEviction = { generation: number; oldestReachablePosition: number; discardedPositions?: readonly number[] }
const evictionHandlers = new Set<(eviction: UndoHistoryEviction) => void | Promise<void>>()
export function registerUndoHistoryEvictionHandler(handler: (eviction: UndoHistoryEviction) => void | Promise<void>) {
  evictionHandlers.add(handler)
  return () => evictionHandlers.delete(handler)
}

function discard(steps: Step[]) {
  if (!steps.length) return
  for (const step of steps) {
    for (const id of step.touched) {
      const owners = affectedSteps.get(id)
      owners?.delete(step)
      if (!owners?.size) affectedSteps.delete(id)
    }
    for (const id of step.receipts) {
      for (const objectId of changes.get(id)?.objectIds ?? []) {
        const receipts = changesByObject.get(objectId)
        receipts?.delete(id)
        if (!receipts?.size) changesByObject.delete(objectId)
      }
      changes.delete(id)
    }
  }
  const eviction = { generation, oldestReachablePosition: getOldestReachableUndoPosition(), discardedPositions: steps.map(step => step.position) }
  for (const handler of evictionHandlers) void handler(eviction)
}

export function pushUndoSnapshot(state?: CanvasProjection): void {
  interruptPendingCanvasWrite()
  if (getActiveCanvasGestureContext()?.suppressUndoBarriers) return
  previous = state ?? read()
  active = { position: position++, batches: [], touched: new Set(), created: new Set(), landings: [], signals: [], receipts: [] }
  undo.push(active)
  const discarded = redo.splice(0)
  if (undo.length > 80) discarded.push(undo.shift()!)
  discard(discarded)
}

function recordEdit(step: Step, before: CanvasProjection, after: CanvasProjection) {
  const batch = diffCanvasDocument(before, after)
  if (!batch.length) return
  step.batches.push(batch)
  for (const change of batch) {
    if (change.domain !== 'nodes') continue
    for (const item of change.added) step.created.add(item.entity.id)
    const ids = [...change.added, ...change.removed].map(item => item.entity.id).concat(change.updates.map(item => item.id))
    for (const id of ids) {
      if (step.touched.has(id)) continue
      step.touched.add(id)
      const owners = affectedSteps.get(id) ?? new Set()
      owners.add(step)
      affectedSteps.set(id, owners)
    }
  }
}

function observeReceipt(event: HistoryEvent) {
  const { changeId, objectIds } = event.payload
  if (event.type === 'agent.txn.committed' && typeof changeId === 'string' && active) {
    const ids = Array.isArray(objectIds) ? objectIds.filter((id): id is string => typeof id === 'string') : []
    changes.set(changeId, { since: position, txnId: event.txnId, objectIds: ids, types: new Set(), conflicts: new Set() })
    active.receipts.push(changeId)
    for (const objectId of ids) {
      const owners = changesByObject.get(objectId) ?? new Set()
      owners.add(changeId)
      changesByObject.set(objectId, owners)
    }
  }
  if (event.type === 'canvas.snapshot.restored') lastRestore = position
  if (!changes.size) return
  const ids = new Set(Object.values(event.payload).flatMap(value =>
    typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).filter((id): id is string => typeof id === 'string') : []))
  for (const objectId of ids) {
    for (const id of changesByObject.get(objectId) ?? []) {
      const change = changes.get(id)!
      if (id === changeId || change.txnId === event.txnId) continue
      change.types.add(event.type)
      if (event.source !== 'runtime') change.conflicts.add(objectId)
    }
  }
}

/** Durable gesture completion supplies provenance. Patch values come from the immutable store. */
export function observeCanvasHistoryGesture(events: readonly HistoryEvent[]): void {
  const live = read()
  if (active && previous && events.some(event => event.type !== 'canvas.node.run-updated')) recordEdit(active, previous, live)
  previous = active ? live : undefined
  for (const event of events) {
    position++
    observeReceipt(event)
    if (event.type !== 'canvas.node.run-updated') continue
    const id = (event.payload.node as { id?: string } | undefined)?.id
    const landed = event.payload.landed
    if (!id || !landed || typeof landed !== 'object') continue
    const landing = { nodeId: id, landed: landed as Record<string, unknown> }
    for (const step of affectedSteps.get(id) ?? []) step.landings.push(landing)
  }
}

export function recordProductionCanvasSignal(signal: ProductionCanvasSignal) { active?.signals.push(signal) }
export function getHistoryFlags() { return { canUndo: undo.length > 0, canRedo: redo.length > 0 } }

function travel(from: Step[], to: Step[], direction: PatchDirection): UndoRestore | undefined {
  interruptPendingCanvasWrite()
  const step = from.pop()
  if (!step) return
  active = undefined
  previous = undefined
  to.push(step)
  return restoreStep(read(), step, direction, true)
}

function restoreStep(live: CanvasProjection, step: Step, direction: PatchDirection, refreshRecovery = false): UndoRestore {
  return {
    projection: applyCanvasDocumentPatches(live, step.batches, direction, refreshRecovery),
    createdNodeIds: direction === 'inverse' ? step.created : new Set(),
    landingsAfter: step.landings,
    productionCanvasIntent: step.signals.length ? { kind: 'signals', signals: step.signals } : { kind: 'none' },
  }
}
export const popUndo = () => travel(undo, redo, 'inverse')
export const popRedo = () => travel(redo, undo, 'forward')
export const getActiveCanvasEditPosition = () => active?.position
export const getUndoJournalPosition = () => position
export const getLatestUndoBarrierAbsolutePosition = () => undo.at(-1)?.position
export const getUndoHeadToken = () => `${generation}:${position}`
export const getOldestReachableUndoPosition = () => Math.min(undo[0]?.position ?? position, redo.at(-1)?.position ?? position)
export const getUndoJournalGeneration = () => generation

/** Only the asset owner enumerates reachable states. Neither travel direction calls this. */
export function* readReachableUndoNodes() {
  for (const [stack, direction] of [[redo, 'forward'], [undo, 'inverse']] as const) {
    let projection = read()
    for (let i = stack.length - 1; i >= 0; i--) {
      const step = stack[i]
      projection = settleReachable(restoreStep(projection, step, direction), projection)
      yield { position: step.position, nodes: projection.nodes }
    }
  }
}

export function findCanvasChange(changeId: string): CanvasChangeConflict | null {
  const change = changes.get(changeId)
  if (change && lastRestore > change.since) change.types.add('canvas.snapshot.restored')
  return change ? { changeId, objectIds: change.objectIds, conflictingEventTypes: [...change.types], conflictingObjectIds: [...change.conflicts] } : null
}

export function dropUndoBarriersAfter(start: number) {
  active = undefined
  previous = undefined
  const dropped: Step[] = []
  for (const stack of [undo, redo]) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].position >= start) dropped.push(...stack.splice(i, 1))
  }
  discard(dropped)
}

export function clearHistory() {
  generation++
  position = 0
  active = undefined
  previous = undefined
  undo.length = redo.length = 0
  affectedSteps.clear()
  changes.clear()
  changesByObject.clear()
  lastRestore = -1
}

/** Read-only view for byte accounting and access probes outside the input path. */
export function inspectCanvasPatchHistory() {
  return { undo: undo as readonly Readonly<Step>[], redo: redo as readonly Readonly<Step>[],
    indexedNodes: affectedSteps.size, receipts: changes.size, hasCapture: Boolean(previous) }
}
