import { afterEach, describe, expect, it } from 'vitest'
import { replayCanvasEvents, type CanvasProjection } from './canvasEventReducer'
import { appendToUndoJournal, popRedo, popUndo, pushUndoSnapshot, seedUndoJournalBase } from './canvasUndoJournal'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from './canvasEventEmitter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const shot = (id: string, shotIndex?: number): GenerationCanvasNode => ({
  id, title: id, kind: 'video', categoryId: 'shots', position: { x: 0, y: 0 }, shotIndex,
})
const initial = (): CanvasProjection => ({ nodes: [shot('a', 1), shot('b', 2)], edges: [], groups: [] })
const snapshotEvent = (snapshot: CanvasProjection) => ({ type: 'canvas.snapshot.restored', payload: { snapshot } })
const legacySwap = [
  { type: 'canvas.node.updated', payload: { nodeId: 'b', patch: { shotIndex: 1 } } },
  { type: 'canvas.node.updated', payload: { nodeId: 'a', patch: { shotIndex: 2 } } },
]
const numbers = (projection: CanvasProjection) => projection.nodes.map(node => node.shotIndex)
afterEach(() => setCanvasEventSinkForTests(null))

describe('shot numbering across persisted event boundaries', () => {
  it('preserves a legacy batch exchange and agrees with current live writes and events', () => {
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot(initial())
    const captured: CanvasShadowEvent[] = []
    setCanvasEventSinkForTests(batch => captured.push(...batch))
    store.updateNodes(legacySwap.map(event => event.payload))
    const live = useGenerationCanvasStore.getState().readDocumentSnapshot()
    expect(numbers(live)).toEqual([2, 1])
    expect(replayCanvasEvents([snapshotEvent(initial()), ...captured]).nodes).toEqual(live.nodes)
    expect(replayCanvasEvents([snapshotEvent(initial()), ...legacySwap]).nodes).toEqual(live.nodes)
  })

  it('restores and repeats a legacy persisted tail without drifting identities', () => {
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot(initial())
    store.applyEventTail(legacySwap)
    expect(numbers(useGenerationCanvasStore.getState())).toEqual([2, 1])
    store.applyEventTail(legacySwap)
    expect(numbers(useGenerationCanvasStore.getState())).toEqual([2, 1])
  })

  it('replays legacy journal prefixes at undo and redo barriers', () => {
    seedUndoJournalBase(initial())
    pushUndoSnapshot()
    appendToUndoJournal(legacySwap)
    expect(numbers(popUndo()!.projection)).toEqual([1, 2])
    expect(numbers(popRedo()!.projection)).toEqual([2, 1])
    pushUndoSnapshot()
    appendToUndoJournal([{ type: 'canvas.node.prompt-changed', payload: { nodeId: 'a', prompt: 'later' } }])
    expect(numbers(popUndo()!.projection)).toEqual([2, 1])
  })

  it('waits until an old batch finishes before assigning missing numbers', () => {
    // Older node.added events can carry no number; a later node already owns 1.
    const events = [shot('missing'), shot('numbered', 1)].map(node => ({ type: 'canvas.node.added', payload: { node } }))
    expect(numbers(replayCanvasEvents(events))).toEqual([2, 1])
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({ nodes: [], edges: [], groups: [] })
    store.applyEventTail(events)
    expect(numbers(useGenerationCanvasStore.getState())).toEqual([2, 1])
  })

  it('repairs invalid final state consistently in full replay and journal restoration', () => {
    const snapshot = { ...initial(), nodes: [shot('a', 1), shot('b', 1)] }
    const events = [snapshotEvent(snapshot)]
    expect(numbers(replayCanvasEvents(events))).toEqual([1, 2])
    seedUndoJournalBase(initial())
    pushUndoSnapshot()
    appendToUndoJournal(events)
    popUndo()
    expect(numbers(popRedo()!.projection)).toEqual([1, 2])
  })
})
