import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  workbenchListener: null as (() => void) | null,
  generationListener: null as (() => void) | null,
  saves: [] as unknown[],
  revision: 0,
  workbenchState: {
    workbenchDocuments: [], activeDocumentId: null, timeline: null, categories: [],
    storyboardPlans: {}, storyboardDesignsByDocumentId: {}, persistRevision: 0,
  },
  generationState: {
    readDocumentSnapshot: vi.fn(() => ({ nodes: [], edges: [], groups: [] })), persistRevision: 0,
  },
}))

vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => deps.generationState,
    subscribe: (_selector: unknown, listener: () => void) => { deps.generationListener = listener; return vi.fn() },
  },
}))
vi.mock('../workbenchStore', () => ({
  useWorkbenchStore: {
    getState: () => deps.workbenchState,
    subscribe: (_selector: unknown, listener: () => void) => { deps.workbenchListener = listener; return vi.fn() },
  },
}))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => null }))
vi.mock('../../desktop/activeProject', () => ({ setDesktopActiveProjectId: vi.fn() }))
vi.mock('../generationCanvas/events/canvasEventEmitter', () => ({
  emitCanvasGesture: vi.fn(), getCanvasEventLastSeq: vi.fn(() => 0), seedCanvasEventLastSeq: vi.fn(),
}))
vi.mock('../generationCanvas/agent/shotVerifyStore', () => ({ useShotVerifyStore: { getState: () => ({ activateProject: vi.fn() }) } }))

import {
  readCurrentWorkbenchProjectPayload,
  persistActiveWorkbenchProjectNow,
  subscribeWorkbenchProjectPersistence,
  waitForActiveWorkbenchProjectSaveTarget,
  clearActiveWorkbenchProjectSaveTarget,
} from './workbenchProjectSession'

describe('canonical persistence barrier suppresses stale debounce writes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    deps.workbenchListener = null
    deps.generationListener = null
    deps.saves.length = 0
    deps.revision = 0
    Object.assign(globalThis, { window: { addEventListener: vi.fn(), removeEventListener: vi.fn() } })
  })

  afterEach(() => vi.useRealTimers())

  it('cancels the queued save for the same mutation before an immediate canonical save', async () => {
    const saveProject = vi.fn(async (_projectId: string, _payload: unknown, _name: string) => {
      const record = { id: 'project-a', version: 1, revision: ++deps.revision }
      deps.saves.push(record)
      return record as never
    })
    const dispose = subscribeWorkbenchProjectPersistence({
      projectId: 'project-a', projectName: 'Project A', isHydrating: () => false, canPersist: () => true,
      saveProject, onSaved: vi.fn(),
    })
    deps.workbenchListener?.()

    const saved = await persistActiveWorkbenchProjectNow()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(saved).toMatchObject({ id: 'project-a', revision: 1 })
    expect(saveProject).toHaveBeenCalledOnce()
    expect(deps.saves).toEqual([{ id: 'project-a', version: 1, revision: 1 }])
    dispose()
  })

  it('signals canonical callers when React installs the active persistence owner', async () => {
    const pending = waitForActiveWorkbenchProjectSaveTarget('project-a')
    let ownerReady = false
    const dispose = subscribeWorkbenchProjectPersistence({
      projectId: 'project-a', projectName: 'Project A', isHydrating: () => false,
      canPersist: () => { ownerReady = true; return ownerReady },
      saveProject: vi.fn(async () => ({ id: 'project-a', version: 1, revision: 1 }) as never), onSaved: vi.fn(),
    })
    await expect(pending).resolves.toBe(true)
    dispose()
  })

  it('fails closed after a bounded owner wait when hydration never installs a save target', async () => {
    const pending = waitForActiveWorkbenchProjectSaveTarget('project-a')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toBe(false)
  })

  it('cancels an owner wait when the active project is cut over', async () => {
    const pending = waitForActiveWorkbenchProjectSaveTarget('project-a')
    clearActiveWorkbenchProjectSaveTarget()
    await expect(pending).resolves.toBe(false)
  })
})

describe('storyboard persistence compatibility projection', () => {
  it('derives deprecated single-plan fields from the active document map', () => {
    const plan = { title: 'F镜头', anchors: [], shots: [] }
    deps.workbenchState.activeDocumentId = 'doc-a'
    deps.workbenchState.storyboardPlans = {
      'doc-a': { plan, committed: false },
      'doc-b': { plan: { ...plan, title: '另一个方案' }, committed: true },
    }

    const payload = readCurrentWorkbenchProjectPayload()

    expect(payload.storyboardPlans?.['doc-a']?.plan).toEqual(plan)
    expect(payload.storyboardPlan).toEqual(plan)
    expect(payload.storyboardPlanCommitted).toBe(false)
  })
})
