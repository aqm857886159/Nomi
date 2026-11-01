import { expect, it, vi } from 'vitest'
import { runStoryboardAction } from './storyboardActionGuard'
const fixture = vi.hoisted(() => ({ plan: { title: 'fixture', anchors: [], shots: [] }, project: { binding: { projectId: 'p' }, signal: { aborted: false }, assertCurrent: vi.fn() } }))
vi.mock('../../../project/projectCanvasReadSurface', () => ({ withProjectAction: (action: (project: unknown) => unknown) => action(fixture.project) }))
vi.mock('../../../generationCanvas/runner/runProjectDelivery', () => ({ isRunTargetLoaded: () => true, readRunProjectRecord: vi.fn() }))
vi.mock('../../../workbenchStore', () => ({ useWorkbenchStore: { getState: () => ({ storyboardDesignsByDocumentId: { doc: [{ id: 'design', plan: fixture.plan }] } }) } }))
it('D2: table and row actions are independent, each key admits once and rejected work releases its key', async () => {
  const activeKeys = new Set<string>(), pending: Set<string>[] = [], failures = vi.fn()
  let finish!: () => void
  const tableAction = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const input = { projectId: 'p', documentId: 'doc', designId: 'design', plan: fixture.plan, shotIds: [], activeKeys,
    onPendingChange: (keys: ReadonlySet<string>) => pending.push(new Set(keys)), onStart: vi.fn(), onFailure: failures, unavailable: (): never => { throw Error('unavailable') } }
  const first = runStoryboardAction({ ...input, actionKey: 'table', action: tableAction })
  await vi.waitFor(() => expect(tableAction).toHaveBeenCalledOnce())
  const duplicate = vi.fn()
  await runStoryboardAction({ ...input, actionKey: 'table', action: duplicate })
  expect(duplicate).not.toHaveBeenCalled()
  const row = vi.fn(async () => { throw Error('row rejected') })
  await runStoryboardAction({ ...input, actionKey: 'shot:1', action: row })
  expect(row).toHaveBeenCalledOnce()
  expect(activeKeys).toEqual(new Set(['table']))
  expect(failures).toHaveBeenCalledOnce()
  expect(pending.some(keys => keys.has('table') && keys.has('shot:1'))).toBe(true)
  finish(); await first
  expect(activeKeys.size).toBe(0)
  await runStoryboardAction({ ...input, actionKey: 'shot:1', action: async () => undefined })
  expect(activeKeys.size).toBe(0)
})
