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

  afterEach(() => {
    stop()
    vi.restoreAllMocks()
  })

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

  it('logs and drops an empty-project signal with identity diagnostics', () => {
    const error = vi.spyOn(rendererLog, 'logRendererError').mockImplementation(() => {})
    emitProductionCanvasSignal({ kind: 'detach', projectId: null, nodes: [makeNode('orphan')] })

    expect(error).toHaveBeenCalledWith('production-canvas-signal-project-unavailable', undefined, expect.objectContaining({ kind: 'detach', nodeIds: 'orphan', canvasDocumentProjectId: '' }))
    expect(signals).toEqual([])
  })

  it('rejects production nodes in a load without project identity', () => {
    const error = vi.spyOn(rendererLog, 'logRendererError').mockImplementation(() => {})
    useGenerationCanvasStore.setState({ projectId: null, nodes: [], edges: [], groups: [] })
    expect(() => useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('invalid-load')], edges: [], groups: [] })).toThrow('project identity')
    expect(() => useGenerationCanvasStore.getState().applyEventTail([{ type: 'canvas.node.added', payload: { node: makeNode('invalid-tail') } }])).toThrow('project identity')
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
    expect(error).toHaveBeenCalledWith('generation-canvas-project-identity-required', undefined, expect.objectContaining({ operation: 'load', nodeIds: 'invalid-load' }))
  })

  it('rejects production nodes in paste, restore, and external graph writes without identity', () => {
    const error = vi.spyOn(rendererLog, 'logRendererError').mockImplementation(() => {})
    const production = makeNode('invalid-write')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [production], edges: [], groups: [] }, 'project-a')
    useGenerationCanvasStore.getState().selectNode('invalid-write')
    useGenerationCanvasStore.getState().copySelectedNodes()
    useGenerationCanvasStore.setState({ projectId: null, nodes: [], edges: [], groups: [] })
    expect(useGenerationCanvasStore.getState().projectId).toBeNull()
    expect(() => useGenerationCanvasStore.getState().pasteNodes()).toThrow('project identity')
    expect(() => useGenerationCanvasStore.getState().restoreGraph([production], [])).toThrow('project identity')
    const base = useGenerationCanvasStore.getState().readDocumentSnapshot()
    expect(() => useGenerationCanvasStore.getState().applyExternalGraph({ base, next: { ...base, nodes: [production] } })).toThrow('project identity')
    expect(error).toHaveBeenCalledWith('generation-canvas-project-identity-required', undefined, expect.objectContaining({ operation: 'paste nodes' }))
  })
})
