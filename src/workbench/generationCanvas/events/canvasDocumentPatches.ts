import { withLiveNodeFacts } from '../../../../electron/shared/canvas/landedNodeFields'
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import type { CanvasProjection } from './canvasEventReducer'

enablePatches()

type Entity = CanvasProjection[keyof CanvasProjection][number]
type FieldBag = Record<string, unknown>
type Update = { id: string; forward: Patch[]; inverse: Patch[] }
type Recovery = { before?: string; entity: Entity }
type Changes = {
  domain: keyof CanvasProjection
  updates: Update[]
  added: Recovery[]
  removed: Recovery[]
  order?: { forward: string[]; inverse: string[] }
}
export type CanvasPatchBatch = Changes[]
export type PatchDirection = 'inverse' | 'forward'

/** IDs address edits even after asynchronous writes. Only membership changes keep an
 * immutable entity reference. A field edit keeps just its two Immer patch values. */
export function diffCanvasDocument(before: CanvasProjection, after: CanvasProjection): CanvasPatchBatch {
  const batch: Changes[] = []
  for (const domain of ['nodes', 'edges', 'groups'] as const) {
    const previous: Entity[] = before[domain]
    const current: Entity[] = after[domain]
    if (previous === current) continue
    const byId = new Map(previous.map(entity => [entity.id, entity]))
    const ids = new Set(current.map(entity => entity.id))
    const change: Changes = { domain, added: [], removed: [], updates: [] }
    current.forEach((entity, index) => {
      const old = byId.get(entity.id)
      if (!old) { change.added.push({ before: current[index + 1]?.id, entity }); return }
      if (entity === old) return
      const fields = entity as unknown as FieldBag
      const [, forward, inverse] = produceWithPatches(old as unknown as FieldBag, draft => {
        for (const key of Object.keys(old)) if (!(key in fields)) delete draft[key]
        for (const [key, value] of Object.entries(fields)) {
          if (value !== (old as unknown as FieldBag)[key]) draft[key] = value
        }
      })
      if (forward.length) change.updates.push({ id: entity.id, forward, inverse })
    })
    previous.forEach((entity, index) => {
      if (!ids.has(entity.id)) change.removed.push({ before: previous[index + 1]?.id, entity })
    })
    const oldOrder = previous.filter(entity => ids.has(entity.id))
    const newOrder = current.filter(entity => byId.has(entity.id))
    if (oldOrder.some((entity, index) => newOrder[index].id !== entity.id)) {
      change.order = { forward: current.map(entity => entity.id), inverse: previous.map(entity => entity.id) }
    }
    if (change.added.length || change.removed.length || change.updates.length || change.order) batch.push(change)
  }
  return batch
}

export function applyCanvasDocumentPatches(live: CanvasProjection, batches: readonly CanvasPatchBatch[], direction: PatchDirection, refreshRecovery = false): CanvasProjection {
  const next: CanvasProjection = { nodes: live.nodes, edges: live.edges, groups: live.groups }
  // Work on one ID table per changed collection across the entire gesture.
  for (const domain of ['nodes', 'edges', 'groups'] as const) {
    const changes = batches.flatMap(batch => batch.filter(change => change.domain === domain))
    if (!changes.length) continue
    if (direction === 'inverse') changes.reverse()
    const entities = new Map<string, Entity>(live[domain].map(entity => [entity.id, entity]))
    // Map preserves append order. For interior insertions, keep adjacent IDs so a
    // batch of individually created/deleted siblings only materializes the graph once.
    const successor = new Map<string, string | undefined>()
    const predecessor = new Map<string, string | undefined>()
    let first: string | undefined
    let last: string | undefined
    function insertBefore(id: string, before?: string) {
      const after = before && entities.has(before) ? before : undefined
      const prev = after === undefined ? last : predecessor.get(after)
      if (prev === undefined) first = id
      else successor.set(prev, id)
      if (after === undefined) last = id
      else predecessor.set(after, id)
      successor.set(id, after)
      predecessor.set(id, prev)
    }
    function remove(id: string) {
      if (!entities.delete(id)) return
      const prev = predecessor.get(id)
      const after = successor.get(id)
      if (prev === undefined) first = after
      else successor.set(prev, after)
      if (after === undefined) last = prev
      else predecessor.set(after, prev)
      successor.delete(id)
      predecessor.delete(id)
    }
    const membership = changes.some(change => change.added.length || change.removed.length || change.order)
    if (membership) for (const id of entities.keys()) insertBefore(id)
    for (const change of changes) {
      const inserted = direction === 'forward' ? change.added : change.removed
      const removed = direction === 'forward' ? change.removed : change.added
      for (const recovery of removed) {
        const current = entities.get(recovery.entity.id)
        if (refreshRecovery && current && domain === 'nodes') recovery.entity = withLiveNodeFacts(recovery.entity, current)
        remove(recovery.entity.id)
      }
      for (const update of change.updates) {
        const current = entities.get(update.id)
        if (current) entities.set(update.id, applyPatches(current, update[direction]))
      }
      for (let i = inserted.length - 1; i >= 0; i--) {
        const { entity, before } = inserted[i]
        remove(entity.id)
        insertBefore(entity.id, before)
        entities.set(entity.id, entity)
      }
      if (change.order) {
        const order = new Set(change.order[direction])
        first = last = undefined
        for (const id of order) if (entities.has(id)) insertBefore(id)
        for (const id of entities.keys()) if (!order.has(id)) insertBefore(id)
      }
    }
    const items: Entity[] = []
    if (membership) for (let id = first; id !== undefined; id = successor.get(id)) items.push(entities.get(id)!)
    Object.assign(next, { [domain]: membership ? items : [...entities.values()] })

  }
  return next
}
