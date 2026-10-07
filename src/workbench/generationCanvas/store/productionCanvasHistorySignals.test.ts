import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { subscribeProductionCanvasSignals, type ProductionCanvasSignal } from '../../production/productionCanvasSignals'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const makeNode = (id: string): GenerationCanvasNode => ({
  id,
  kind: 'image',
  title: id,
  position: { x: 40, y: 40 },
  prompt: `${id} prompt`,
  categoryId: 'shots',
  meta: { productionRunId: 'run-history' },
})

describe('production canvas history signals', () => {
  let signals: ProductionCanvasSignal[]
  let stop: () => void

  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    signals = []
    stop = subscribeProductionCanvasSignals((signal) => signals.push(signal))
  })

  afterEach(() => stop())

  it('does not infer detach when undoing creation of a production node', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('source')], edges: [], groups: [] })
    const copied = useGenerationCanvasStore.getState().duplicateNodeForRegeneration('source')
    expect(copied?.meta?.productionRunId).toBe('run-history')

    signals = []
    useGenerationCanvasStore.getState().undo()

    expect(signals).toEqual([])
  })

  it('inverts an explicit delete on undo and replays detach on redo', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('deleted')], edges: [], groups: [] })
    useGenerationCanvasStore.getState().deleteNode('deleted')
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])

    signals = []
    useGenerationCanvasStore.getState().undo()
    expect(signals.map((signal) => signal.kind)).toEqual(['reattach'])

    signals = []
    useGenerationCanvasStore.getState().redo()
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
  })

  it('records external graph deletion at the write and replays its inverse', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('external')], edges: [], groups: [] })
    const base = useGenerationCanvasStore.getState().readDocumentSnapshot()
    const next = { ...base, nodes: [] }
    useGenerationCanvasStore.getState().applyExternalGraph({ base, next })
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])

    signals = []
    useGenerationCanvasStore.getState().undo()
    expect(signals.map((signal) => signal.kind)).toEqual(['reattach'])

    signals = []
    useGenerationCanvasStore.getState().redo()
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
  })
})
