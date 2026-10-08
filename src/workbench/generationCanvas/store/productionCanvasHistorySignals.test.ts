import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitProductionCanvasSignal, routeProductionCanvasSignal, subscribeProductionCanvasSignals, type ProductionCanvasSignal } from '../../production/productionCanvasSignals'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import * as rendererLog from '../../../desktop/rendererLog'

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
      if (!signal.projectId) throw new Error('test signal must carry project identity')
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
      routeProductionCanvasSignal(signal!, 'project-b', (matched) => accepted.push(matched), (foreign) => {
        if (!foreign.projectId) throw new Error('test signal must carry project identity')
        mismatches.push(foreign.projectId)
      })
    }
    expect(accepted).toEqual([])
    expect(mismatches).toEqual(['project-a', 'project-a'])
  })

  it('logs and queues an empty-project signal until the atomic project load binds identity', () => {
    const error = vi.spyOn(rendererLog, 'logRendererError').mockImplementation(() => {})
    emitProductionCanvasSignal({ kind: 'detach', projectId: null, nodes: [makeNode('queued')] })

    expect(error).toHaveBeenCalledWith('production-canvas-signal-project-unavailable', undefined, expect.objectContaining({ kind: 'detach' }))
    expect(signals).toEqual([])

    let observedStore: { projectId: string | null; nodeIds: string[] } | undefined
    const observe = subscribeProductionCanvasSignals(() => {
      const state = useGenerationCanvasStore.getState()
      observedStore = { projectId: state.projectId, nodeIds: state.nodes.map((node) => node.id) }
    })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('loaded')], edges: [], groups: [] }, 'project-a')
    observe()

    expect(useGenerationCanvasStore.getState().projectId).toBe('project-a')
    expect(signals).toEqual([expect.objectContaining({ kind: 'detach', projectId: 'project-a' })])
    expect(observedStore).toEqual({ projectId: 'project-a', nodeIds: ['loaded'] })
    error.mockRestore()
  })
})
