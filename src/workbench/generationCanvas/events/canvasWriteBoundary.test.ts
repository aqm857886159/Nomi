import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getHistoryFlags, pushUndoSnapshot } from './canvasUndoJournal'
import { withCanvasGestureContext } from './canvasGestureContext'
import { interruptPendingCanvasWrite, ownPendingCanvasWrite } from './canvasWriteBoundary'

function synchronousRelease(value: ReturnType<typeof ownPendingCanvasWrite>): () => void {
  if (typeof value !== 'function') throw new Error('Expected an uncontended canvas write claim')
  return value
}

beforeEach(() => {
  interruptPendingCanvasWrite()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ id: 'n', kind: 'image', title: 'N', prompt: 'original', position: { x: 0, y: 0 } }], edges: [], groups: [] })
})
afterEach(() => interruptPendingCanvasWrite())

describe('document write handoff', () => {
  it('settles before a new action reads its source node, not merely before its final set', () => {
    const cancel = vi.fn(() => withCanvasGestureContext({
      source: 'agent', txnId: 'old-cleanup', proposalId: 'old', allowDuringCleanup: true,
    }, () => useGenerationCanvasStore.getState().updateNodePrompt('n', 'settled')))
    ownPendingCanvasWrite('old', cancel)
    const duplicate = useGenerationCanvasStore.getState().duplicateNodeForRegeneration('n')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(duplicate?.prompt).toBe('settled')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
  })

  it('selection, viewport, chat and reads preserve a pending document transaction', () => {
    const cancel = vi.fn()
    const release = synchronousRelease(ownPendingCanvasWrite('old', cancel))
    const state = useGenerationCanvasStore.getState()
    state.selectNode('n')
    state.clearSelection()
    state.setCanvasTransform(2, { x: 5, y: 8 })
    state.setCanvasZoom(1)
    state.setNodeStatus('n', 'running')
    state.setNodeProgress('n', undefined)
    state.dismissNodeError('n')
    state.readDocumentSnapshot()
    state.readSnapshot()
    expect(cancel).not.toHaveBeenCalled()
    release()
  })

  it('own synchronous edits do not preempt themselves; release is identity-safe', () => {
    const old = vi.fn()
    const releaseOld = synchronousRelease(ownPendingCanvasWrite('old', old))
    withCanvasGestureContext({ source: 'agent', txnId: 't', proposalId: 'old', suppressUndoBarriers: true }, () => {
      useGenerationCanvasStore.getState().updateNodePrompt('n', 'owned')
    })
    expect(old).not.toHaveBeenCalled()
    const next = vi.fn()
    ownPendingCanvasWrite('next', next)
    expect(old).toHaveBeenCalledTimes(1)
    releaseOld()
    useGenerationCanvasStore.getState().updateNodePrompt('n', 'manual')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('a direct journal barrier also settles the prior transaction before opening the new Undo point', () => {
    const cancel = vi.fn(() => expect(getHistoryFlags().canUndo).toBe(false))
    ownPendingCanvasWrite('old', cancel)
    pushUndoSnapshot()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getHistoryFlags().canUndo).toBe(true)
  })

  it('completed background result attachment still works after pending editing is cancelled', () => {
    const cancel = vi.fn()
    ownPendingCanvasWrite('old', cancel)
    useGenerationCanvasStore.getState().addNodeResult('n', { id: 'r', type: 'image', url: 'nomi-local://fixture/image.jpg', createdAt: 1 })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(useGenerationCanvasStore.getState().nodes[0].result?.id).toBe('r')
  })

  it('treats collapsing a group as a document write', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ id: 'n', kind: 'image', title: 'N', prompt: 'original', position: { x: 0, y: 0 }, groupId: 'g' }],
      edges: [],
      groups: [{ id: 'g', name: 'Group', categoryId: 'shots', nodeIds: ['n'], collapsed: false, createdAt: 1, updatedAt: 1 }],
    })
    const cancel = vi.fn()
    ownPendingCanvasWrite('old', cancel)

    useGenerationCanvasStore.getState().setGroupCollapsed('g', true)

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(useGenerationCanvasStore.getState().groups[0]?.collapsed).toBe(true)
  })
})
