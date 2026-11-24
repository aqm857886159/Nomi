import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasState } from '../../generationCanvas/store/canvasStoreTypes'
import { getUndoJournalGeneration } from '../../generationCanvas/events/canvasPatchHistory'
import { withCanvasGestureContext } from '../../generationCanvas/events/canvasGestureContext'

type Shot = StoryboardPlan['shots'][number]
type Canvas = Pick<GenerationCanvasState, 'nodes' | 'edges' | 'groups' | 'captureHistory' | 'deleteNode' | 'restoreGraph' | 'moveNodeToGroup'>
export type StoryboardDeletion = {
  before: readonly Shot[]
  removed: ReadonlySet<Shot>
  canvas: Pick<Canvas, 'nodes' | 'edges' | 'groups'> | null
  generation: number
}
const renumber = (shots: Shot[]): Shot[] => shots.map((shot, index) => ({ ...shot, index: index + 1 }))
const legacyContent = ({ index: _index, ...shot }: Shot): string => JSON.stringify(shot)

/** One original canvas history boundary for the whole explicit row deletion. */
function canvasTransaction(canvas: Canvas, action: () => void): void {
  canvas.captureHistory()
  withCanvasGestureContext({ source: 'user', txnId: crypto.randomUUID(), suppressUndoBarriers: true }, action)
}

export function deleteStoryboardRows(plan: StoryboardPlan, rows: readonly Shot[], nodeIds: readonly string[], canvas: Canvas | null): { plan: StoryboardPlan; undo: StoryboardDeletion } {
  const removed = new Set(rows)
  if (!removed.size || rows.some(row => !plan.shots.includes(row))) throw new Error('Storyboard deletion target changed')
  const ids = new Set(nodeIds)
  const deletedNodes = canvas?.nodes.filter(node => ids.has(node.id)) ?? []
  const undo: StoryboardDeletion = {
    before: plan.shots, removed, generation: getUndoJournalGeneration(),
    canvas: canvas ? { nodes: deletedNodes, edges: canvas.edges.filter(edge => ids.has(edge.source) || ids.has(edge.target)), groups: canvas.groups.filter(group => group.nodeIds.some(id => ids.has(id))) } : null,
  }
  if (canvas && deletedNodes.length) canvasTransaction(canvas, () => { for (const node of deletedNodes) canvas.deleteNode(node.id) })
  return { plan: { ...plan, shots: renumber(plan.shots.filter(shot => !removed.has(shot))) }, undo }
}

/** Resolve old legacy survivors without assigning persisted IDs or guessing from renumbered indexes. */
export function restoredStoryboardPlan(current: StoryboardPlan, undo: StoryboardDeletion): StoryboardPlan {
  const matches = new Map<Shot, Shot>()
  const used = new Set<Shot>()
  for (const before of undo.before) {
    const candidates = current.shots.filter(shot => before.shotId ? shot.shotId === before.shotId : !shot.shotId && legacyContent(shot) === legacyContent(before))
    if (candidates.length > 1 || (candidates[0] && used.has(candidates[0]))) throw new Error('Storyboard row identity is ambiguous')
    if (!before.shotId && undo.removed.has(before) && candidates.length) throw new Error('Legacy deleted row identity is ambiguous')
    if (!before.shotId && !undo.removed.has(before) && candidates.length !== 1) throw new Error('Legacy storyboard row changed')
    if (candidates[0]) { matches.set(before, candidates[0]); used.add(candidates[0]) }
  }
  const shots = [...current.shots]
  for (const [index, shot] of undo.before.entries()) {
    if (!undo.removed.has(shot) || matches.has(shot)) continue
    const successor = undo.before.slice(index + 1).map(row => matches.get(row)).find(row => row && shots.includes(row))
    const predecessor = undo.before.slice(0, index).reverse().map(row => matches.get(row)).find(row => row && shots.includes(row))
    shots.splice(successor ? shots.indexOf(successor) : predecessor ? shots.indexOf(predecessor) + 1 : shots.length, 0, shot)
    matches.set(shot, shot)
  }
  return { ...current, shots: renumber(shots) }
}

/** Compensate only missing deleted identities. Never rewind the global journal or replace a surviving result. */
export function restoreStoryboardDeletion(current: StoryboardPlan, undo: StoryboardDeletion, canvas: Canvas): StoryboardPlan {
  if (undo.generation !== getUndoJournalGeneration()) throw new Error('Storyboard canvas target changed')
  const plan = restoredStoryboardPlan(current, undo)
  if (!undo.canvas) return plan
  const existing = new Set(canvas.nodes.map(node => node.id))
  const incoming = undo.canvas.nodes.filter(node => !existing.has(node.id)).map(node => {
    const { groupId: _groupId, ...ungrouped } = node
    return ungrouped
  })
  if (!incoming.length) return plan
  const incomingIds = new Set(incoming.map(node => node.id))
  const available = new Set([...existing, ...incomingIds])
  const deletedIds = new Set(undo.canvas.nodes.map(node => node.id))
  const unchangedGroups = new Set(undo.canvas.groups.filter(before => {
    const latest = canvas.groups.find(group => group.id === before.id)
    if (!latest) return false
    // The group may have been edited or recreated while its deleted member was absent.
    // Preserve that later grouping decision; only an unchanged remainder accepts compensation.
    const remainder = ({ nodeIds, updatedAt: _updatedAt, frameBounds: _bounds, ...group }: Canvas['groups'][number]) =>
      JSON.stringify({ ...group, nodeIds: nodeIds.filter(id => !deletedIds.has(id)) })
    return remainder(before) === remainder(latest)
  }).map(group => group.id))
  const edges = undo.canvas.edges.filter(edge => (incomingIds.has(edge.source) || incomingIds.has(edge.target))
    && available.has(edge.source) && available.has(edge.target) && (!edge.viaGroupId || unchangedGroups.has(edge.viaGroupId)))
  canvasTransaction(canvas, () => {
    canvas.restoreGraph(incoming, edges)
    for (const node of incoming) {
      const originalGroup = undo.canvas!.groups.find(group => group.nodeIds.includes(node.id))
      if (originalGroup && unchangedGroups.has(originalGroup.id)) canvas.moveNodeToGroup(node.id, originalGroup.id)
    }
  })
  return plan
}
