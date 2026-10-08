import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routeProductionCanvasSignal, subscribeProductionCanvasSignals, type ProductionCanvasSignal } from '../../production/productionCanvasSignals'
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
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('source')], edges: [], groups: [] }, 'project-a')
    const copied = useGenerationCanvasStore.getState().duplicateNodeForRegeneration('source')
    expect(copied?.meta?.productionRunId).toBe('run-history')

    signals = []
    useGenerationCanvasStore.getState().undo()

    expect(signals).toEqual([])
  })

  it('inverts an explicit delete on undo and replays detach on redo', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('deleted')], edges: [], groups: [] }, 'project-a')
    useGenerationCanvasStore.getState().deleteNode('deleted')
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
    expect(signals[0]?.projectId).toBe('project-a')

    signals = []
    useGenerationCanvasStore.getState().undo()
    expect(signals.map((signal) => signal.kind)).toEqual(['reattach'])
    expect(signals[0]?.projectId).toBe('project-a')

    signals = []
    useGenerationCanvasStore.getState().redo()
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
    expect(signals[0]?.projectId).toBe('project-a')
  })

  it('records external graph deletion at the write and replays its inverse', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('external')], edges: [], groups: [] }, 'project-a')
    const base = useGenerationCanvasStore.getState().readDocumentSnapshot()
    const next = { ...base, nodes: [] }
    useGenerationCanvasStore.getState().applyExternalGraph({ base, next })
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
    expect(signals[0]?.projectId).toBe('project-a')

    signals = []
    useGenerationCanvasStore.getState().undo()
    expect(signals.map((signal) => signal.kind)).toEqual(['reattach'])

    signals = []
    useGenerationCanvasStore.getState().redo()
    expect(signals.map((signal) => signal.kind)).toEqual(['detach'])
  })

  it('keeps a delete signal owned by A when the canvas switches to B', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('a-node')], edges: [], groups: [] }, 'project-a')
    useGenerationCanvasStore.getState().deleteNode('a-node')
    const signalFromA = signals[0]

    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('b-node')], edges: [], groups: [] }, 'project-b')

    expect(signalFromA).toMatchObject({ kind: 'detach', projectId: 'project-a' })
    const accepted: ProductionCanvasSignal[] = []
    const mismatches: Array<{ signalProjectId: string; hostProjectId: string }> = []
    routeProductionCanvasSignal(signalFromA!, 'project-b', (signal) => accepted.push(signal), (signal, hostProjectId) => {
      mismatches.push({ signalProjectId: signal.projectId, hostProjectId })
    })
    expect(accepted).toEqual([])
    expect(mismatches).toEqual([{ signalProjectId: 'project-a', hostProjectId: 'project-b' }])
  })

  it('drops A undo and redo replays while B is the active host', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('a-node')], edges: [], groups: [] }, 'project-a')
    useGenerationCanvasStore.getState().deleteNode('a-node')
    useGenerationCanvasStore.setState({ projectId: 'project-b' })

    signals = []
    useGenerationCanvasStore.getState().undo()
    const undoSignal = signals[0]
    signals = []
    useGenerationCanvasStore.getState().redo()
    const redoSignal = signals[0]

    const accepted: ProductionCanvasSignal[] = []
    const mismatches: string[] = []
    for (const signal of [undoSignal, redoSignal]) {
      routeProductionCanvasSignal(signal!, 'project-b', (matched) => accepted.push(matched), (foreign) => mismatches.push(foreign.projectId))
    }
    expect(accepted).toEqual([])
    expect(mismatches).toEqual(['project-a', 'project-a'])
  })
})
