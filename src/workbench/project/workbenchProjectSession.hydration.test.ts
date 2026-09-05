import { describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  readEvents: vi.fn(),
  applyEventTail: vi.fn(),
  emitCanvasGesture: vi.fn(),
  seedCanvasEventLastSeq: vi.fn(),
}))

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ events: { read: deps.readEvents } }),
}))
vi.mock('../generationCanvas/events/canvasEventEmitter', () => ({
  emitCanvasGesture: deps.emitCanvasGesture,
  getCanvasEventLastSeq: vi.fn(() => 0),
  seedCanvasEventLastSeq: deps.seedCanvasEventLastSeq,
}))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => ({
      nodes: [],
      edges: [],
      groups: [],
      applyEventTail: deps.applyEventTail,
      restoreSnapshot: vi.fn(),
      readDocumentSnapshot: vi.fn(() => ({ nodes: [], edges: [], groups: [] })),
    }),
    subscribe: vi.fn(() => vi.fn()),
  },
}))
vi.mock('../generationCanvas/agent/shotVerifyStore', () => ({
  useShotVerifyStore: { getState: () => ({ activateProject: vi.fn() }) },
}))
vi.mock('../workbenchStore', () => ({
  useWorkbenchStore: {
    getState: () => ({
      workbenchDocument: {}, timeline: {}, categories: [],
      setWorkbenchDocument: vi.fn(), setTimeline: vi.fn(),
      setCategories: vi.fn(), hydrateStoryboardPlan: vi.fn(),
    }),
    subscribe: vi.fn(() => vi.fn()),
  },
}))

import { replayCanvasEventTailAndSealGenesis } from './workbenchProjectSession'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

describe('canvas event-tail hydration epoch', () => {
  it('checks the epoch after IPC read and before applying a late tail or sealing genesis', async () => {
    const reply = deferred<{ events: Array<{ type: string; payload: Record<string, unknown>; seq: number }> }>()
    deps.readEvents.mockReturnValueOnce(reply.promise)
    let current = true
    const guard = {
      signal: new AbortController().signal,
      assertCurrent: vi.fn(() => {
        if (!current) throw new Error('project_hydration_superseded')
      }),
    }
    const payload = { ...createDefaultWorkbenchProjectPayload(), generationCanvasLastSeq: 1 }
    const replaying = replayCanvasEventTailAndSealGenesis('project-a', payload, guard)
    current = false
    reply.resolve({ events: [{ type: 'canvas.node.updated', payload: { id: 'late' }, seq: 2 }] })

    await expect(replaying).rejects.toThrow('project_hydration_superseded')
    expect(deps.applyEventTail).not.toHaveBeenCalled()
    expect(deps.emitCanvasGesture).not.toHaveBeenCalled()
  })
})
