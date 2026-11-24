import React from 'react'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasState } from '../../generationCanvas/store/canvasStoreTypes'
import { getUndoJournalGeneration } from '../../generationCanvas/events/canvasPatchHistory'
import { withCanvasGestureContext } from '../../generationCanvas/events/canvasGestureContext'
import { renumberStoryboardShots, stableShotId } from '../../../../electron/shared/storyboard/storyboardSubjectIdentity'

type Shot = StoryboardPlan['shots'][number]
type Canvas = Pick<GenerationCanvasState, 'nodes' | 'edges' | 'groups' | 'captureHistory' | 'deleteNode' | 'restoreGraph' | 'moveNodeToGroup'>
export type StoryboardDeletion = {
  before: readonly Shot[]
  removed: ReadonlySet<Shot>
  canvas: Pick<Canvas, 'nodes' | 'edges' | 'groups'> | null
  generation: number
}
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
  return { plan: { ...plan, shots: renumberStoryboardShots(plan.shots.filter(shot => !removed.has(shot))) }, undo }
}

/** Match by the identity each row held before deletion, including legacy index-derived IDs. */
export function restoredStoryboardPlan(current: StoryboardPlan, undo: StoryboardDeletion): StoryboardPlan {
  const matches = new Map<Shot, Shot>()
  const used = new Set<Shot>()
  for (const before of undo.before) {
    const id = stableShotId(before)
    const candidates = current.shots.filter(shot => stableShotId(shot) === id)
    if (candidates.length > 1 || (candidates[0] && used.has(candidates[0]))) throw new Error('Storyboard row identity is ambiguous')
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
  return { ...current, shots: renumberStoryboardShots(shots) }
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

export function useStoryboardDeletionFocus(plan: StoryboardPlan | null) {
  const editorRef = React.useRef<HTMLElement>(null)
  const deletedFocusRef = React.useRef<Element | null>(null)
  const lastEditorFocusRef = React.useRef<Element | null>(null)
  React.useLayoutEffect(() => {
    const removedFocus = deletedFocusRef.current
    deletedFocusRef.current = null
    const active = document.activeElement
    // Original confirmation resolves before its exit animation removes the focused button.
    // Restore only that departing control or orphaned body focus, never a new live input.
    const closingConfirmation = removedFocus?.matches('[data-confirm-dialog-confirm="true"]')
    if (removedFocus && ((!removedFocus.isConnected && active === document.body)
      || (closingConfirmation && (active === removedFocus || active === document.body)))
      && editorRef.current?.offsetParent !== null) editorRef.current?.focus({ preventScroll: true })
  }, [plan])

  const onFocusCapture: React.FocusEventHandler<HTMLElement> = (event) => {
    if (event.target instanceof Element) lastEditorFocusRef.current = event.target
  }

  const captureDeletedFocus = (root: HTMLElement): void => {
    const focused = document.activeElement
    // 行菜单等走 portal 的浮层不在编辑器的 DOM 里，但焦点事件沿 React 树冒泡，
    // onFocusCapture 记下的就是它：它也算编辑器自己的焦点，删除后同样要把焦点还给编辑器。
    deletedFocusRef.current = focused && (root.contains(focused) || focused === lastEditorFocusRef.current
      || focused.matches('[data-confirm-dialog-confirm="true"]'))
      ? focused : focused === document.body ? lastEditorFocusRef.current : null
  }

  return { editorRef, lastEditorFocusRef, onFocusCapture, captureDeletedFocus }
}
