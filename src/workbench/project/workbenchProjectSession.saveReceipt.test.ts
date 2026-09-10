import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({ changed: null as null | (() => void), version: 0 }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => null }))
vi.mock('../../desktop/activeProject', () => ({ setDesktopActiveProjectId: vi.fn() }))
vi.mock('../generationCanvas/events/canvasEventEmitter', () => ({ emitCanvasGesture: vi.fn(), getCanvasEventLastSeq: () => 0, seedCanvasEventLastSeq: vi.fn() }))
vi.mock('../generationCanvas/agent/shotVerifyStore', () => ({ useShotVerifyStore: { getState: () => ({ activateProject: vi.fn() }) } }))
vi.mock('../workbenchStore', () => ({ useWorkbenchStore: { getState: () => ({}), subscribe: () => vi.fn() } }))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({ useGenerationCanvasStore: {
  getState: () => ({ readDocumentSnapshot: () => ({ nodes: [], edges: [], groups: [], version: deps.version }) }),
  subscribe: (_selector: unknown, callback: () => void) => { deps.changed = callback; return vi.fn() },
} }))
import { clearActiveWorkbenchProjectSaveTarget, persistActiveWorkbenchProjectNow, subscribeWorkbenchProjectPersistence, type WorkbenchProjectSaveFn } from './workbenchProjectSession'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
beforeEach(() => { vi.useFakeTimers(); deps.version = 0; vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('project persistence disposal', () => {
  it('coalesces a newer explicit save into the same queue before acknowledging it', async () => {
    const versions: number[] = [], finish: Array<() => void> = []
    const save = vi.fn((_id: string, payload: unknown) => {
      versions.push((payload as { generationCanvas: { version: number } }).generationCanvas.version)
      return new Promise<WorkbenchProjectRecordV1>(resolve => { finish.push(() => resolve({ id: 'p' } as WorkbenchProjectRecordV1)) })
    })
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'p', projectName: 'p', isHydrating: () => false, canPersist: () => true, saveProject: save, onSaved: vi.fn() })
    deps.version = 1; deps.changed?.(); await vi.advanceTimersByTimeAsync(700)
    deps.version = 2; deps.changed?.(); await vi.advanceTimersByTimeAsync(700)
    deps.version = 3; deps.changed?.()
    const explicit = persistActiveWorkbenchProjectNow()
    expect(versions).toEqual([1])
    finish[0](); await vi.advanceTimersByTimeAsync(0)
    expect(versions).toEqual([1, 3])
    finish[1](); await explicit
    await dispose()
    expect(versions.at(-1)).toBe(3)
  })

  it.each(['running', 'queued', 'debounced'] as const)('keeps the %s snapshot under its original project when hydration replaces the global store', async (phase) => {
    let active = true, hydrating = false
    const finish: Array<(record: WorkbenchProjectRecordV1) => void> = []
    const save = vi.fn<WorkbenchProjectSaveFn>(() => new Promise<WorkbenchProjectRecordV1>(resolve => { finish.push(resolve) }))
    const onSaved = vi.fn()
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'old', projectName: 'old', isHydrating: () => hydrating, canPersist: () => active, saveProject: save, onSaved })
    deps.version = 1; deps.changed?.()
    if (phase !== 'debounced') await vi.advanceTimersByTimeAsync(700)
    if (phase === 'queued') { deps.version = 2; deps.changed?.(); await vi.advanceTimersByTimeAsync(700) }
    hydrating = true; active = false; deps.version = 99; deps.changed?.()
    const disposed = dispose()
    if (finish[0]) finish[0]({ id: 'old' } as WorkbenchProjectRecordV1)
    await vi.advanceTimersByTimeAsync(0)
    if (finish[1]) finish[1]({ id: 'old' } as WorkbenchProjectRecordV1)
    await disposed
    const versions = save.mock.calls.map(call => (call[1] as unknown as { generationCanvas: { version: number } }).generationCanvas.version)
    expect(versions).not.toContain(99)
    expect(versions.at(-1)).toBe(phase === 'queued' ? 2 : 1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('returns the final save receipt and captures queued changes before runtime release', async () => {
    const finish: Array<(record: WorkbenchProjectRecordV1) => void> = []
    const save = vi.fn(() => new Promise<WorkbenchProjectRecordV1>(resolve => { finish.push(resolve) }))
    const onSaved = vi.fn()
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'p', projectName: 'p', isHydrating: () => false, canPersist: () => true, saveProject: save, onSaved })
    deps.version = 1; deps.changed?.(); await vi.advanceTimersByTimeAsync(700)
    deps.version = 2; deps.changed?.()
    const done = vi.fn()
    const disposed = dispose().then(done)
    expect(save).toHaveBeenCalledTimes(1)
    expect(done).not.toHaveBeenCalled()
    finish[0]({ id: 'p' } as WorkbenchProjectRecordV1)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual(['p', expect.objectContaining({ generationCanvas: expect.objectContaining({ version: 2 }) }), 'p'])
    finish[1]({ id: 'p' } as WorkbenchProjectRecordV1)
    await disposed
    expect(done).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenCalledOnce()
  })
  it('rejects an explicit exit when its final snapshot cannot be saved', async () => {
    const failure = new Error('save failed')
    const onSaveError = vi.fn()
    const save = vi.fn().mockRejectedValue(failure)
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'p', projectName: 'p', isHydrating: () => false, canPersist: () => true, saveProject: save, onSaved: vi.fn(), onSaveError })
    deps.changed?.()
    await expect(dispose()).rejects.toBe(failure)
    expect(onSaveError).toHaveBeenCalledWith(failure)
    save.mockResolvedValue({ id: 'p' })
    await persistActiveWorkbenchProjectNow()
  })
  it('makes close or reload wait for the library exit save receipt after disposal starts', async () => {
    let finish!: (record: WorkbenchProjectRecordV1) => void
    const save = vi.fn(() => new Promise<WorkbenchProjectRecordV1>(resolve => { finish = resolve }))
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'p', projectName: 'p', isHydrating: () => false, canPersist: () => true, saveProject: save, onSaved: vi.fn() })
    deps.version = 1; deps.changed?.()
    const leaving = dispose()
    const acknowledged = vi.fn()
    const closing = persistActiveWorkbenchProjectNow().then(acknowledged)
    await vi.advanceTimersByTimeAsync(0)
    expect(acknowledged).not.toHaveBeenCalled()
    finish({ id: 'p' } as WorkbenchProjectRecordV1)
    await Promise.all([leaving, closing])
    expect(acknowledged).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })
  it('propagates a failed library save to an overlapping close without publishing a late scope receipt', async () => {
    let reject!: (error: Error) => void
    let active = true
    const onSaved = vi.fn(), onSaveError = vi.fn()
    const failure = new Error('disk denied')
    const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no })).mockResolvedValueOnce({ id: 'old' })
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'old', projectName: 'old', isHydrating: () => false, canPersist: () => active, saveProject: save, onSaved, onSaveError })
    deps.changed?.()
    const leaving = dispose().catch(error => error)
    const closing = persistActiveWorkbenchProjectNow().catch(error => error)
    active = false
    reject(failure)
    expect(await leaving).toBe(failure)
    expect(await closing).toBe(failure)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onSaveError).toHaveBeenCalledWith(failure)
    await persistActiveWorkbenchProjectNow()
  })
  it('retains the write receipt when hydration clears the active target before old subscription disposal', async () => {
    let finish!: (record: WorkbenchProjectRecordV1) => void
    let active = true
    const save = vi.fn(() => new Promise<WorkbenchProjectRecordV1>(resolve => { finish = resolve }))
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: 'old', projectName: 'old', isHydrating: () => !active, canPersist: () => active, saveProject: save, onSaved: vi.fn() })
    deps.version = 1; deps.changed?.(); await vi.advanceTimersByTimeAsync(700)
    active = false; deps.version = 99; clearActiveWorkbenchProjectSaveTarget()
    const acknowledged = vi.fn()
    const closing = persistActiveWorkbenchProjectNow().then(acknowledged)
    await vi.advanceTimersByTimeAsync(0)
    expect(acknowledged).not.toHaveBeenCalled()
    finish({ id: 'old' } as WorkbenchProjectRecordV1)
    await closing; await dispose()
    expect(save).toHaveBeenCalledOnce()
  })
})
