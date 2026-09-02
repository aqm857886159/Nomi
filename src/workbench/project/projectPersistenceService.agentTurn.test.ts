import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

const deps = vi.hoisted(() => ({ read: vi.fn(), restore: vi.fn(), replay: vi.fn(), upgrade: vi.fn() }))
vi.mock('../library/localProjectStore', () => ({ readLocalProjectAsync: deps.read, saveLocalProject: vi.fn() }))
vi.mock('./projectMediaMigration', () => ({ upgradeWorkbenchProjectMediaUrls: deps.upgrade, normalizeLegacyImageAssetKinds: (value: unknown) => value }))
vi.mock('./projectCategoryMigration', () => ({ migrateProjectRecord: (record: unknown) => ({ record, diagnostic: { alreadyMigrated: true } }) }))
vi.mock('./projectV51ToV60Migration', () => ({ migrateProjectV51ToV60: (record: unknown) => ({ record }) }))
vi.mock('./workbenchProjectSession', () => ({
  clearActiveWorkbenchProjectSaveTarget: vi.fn(), restoreWorkbenchProjectPayload: deps.restore,
  replayCanvasEventTailAndSealGenesis: deps.replay, subscribeWorkbenchProjectPersistence: vi.fn(),
}))
vi.mock('../generationCanvas/runner/projectAssetHealthCheck', () => ({ runProjectAssetHealthCheck: vi.fn().mockResolvedValue(undefined) }))
import { createWorkbenchProjectPersistenceService } from './projectPersistenceService'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'

beforeEach(() => {
  vi.clearAllMocks()
  deps.replay.mockResolvedValue(undefined)
  deps.upgrade.mockImplementation(async (value: unknown) => value)
})
afterEach(() => {
  useShotVerifyStore.getState().clear()
})

describe('project hydration invalidates Agent ownership before asynchronous work', () => {
  it('clears review ownership before reading, and any review begun during hydration before projecting', async () => {
    useShotVerifyStore.getState().activateProject('A')
    const oldVerify = useShotVerifyStore.getState().beginVerify('A')
    let release!: (value: WorkbenchProjectRecordV1) => void
    let releaseReplay!: () => void
    deps.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    deps.replay.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseReplay = resolve }))
    const setActiveProject = vi.fn()
    const service = createWorkbenchProjectPersistenceService({ setActiveProject })
    const guard = { signal: new AbortController().signal, assertCurrent: vi.fn() }
    const loading = service.hydrateProject('B', guard)
    expect(useShotVerifyStore.getState().isVerifyCurrent(oldVerify, 'A')).toBe(false)
    const duringVerify = useShotVerifyStore.getState().beginVerify('A')
    deps.restore.mockImplementationOnce(() => {
      expect(useShotVerifyStore.getState().isVerifyCurrent(duringVerify, 'A')).toBe(false)
    })
    release({ id: 'B', name: 'B', version: 1, createdAt: 1, updatedAt: 1, revision: 1, savedAt: 1, payload: createDefaultWorkbenchProjectPayload() })
    await vi.waitFor(() => expect(deps.replay).toHaveBeenCalledOnce())
    const tailVerify = useShotVerifyStore.getState().beginVerify('A')
    releaseReplay()
    await loading
    expect(deps.restore).toHaveBeenCalledOnce()
    expect(useShotVerifyStore.getState().isVerifyCurrent(tailVerify, 'A')).toBe(false)
    expect(deps.replay).toHaveBeenCalledWith('B', expect.anything(), guard)
    // The outer Surface coordinator owns the one active publish immediately
    // before commit; persistence restore must not publish a second time.
    expect(setActiveProject).not.toHaveBeenCalled()
  })

  it('checks the hydration epoch after the async read and before restoring any global project state', async () => {
    const project = {
      id: 'B', name: 'B', version: 1, createdAt: 1, updatedAt: 1, revision: 1, savedAt: 1,
      payload: createDefaultWorkbenchProjectPayload(),
    }
    let current = true
    deps.read.mockImplementationOnce(async () => {
      current = false
      return project
    })
    const guard = {
      signal: new AbortController().signal,
      assertCurrent: vi.fn(() => {
        if (!current) throw new Error('project_hydration_superseded')
      }),
    }
    const setActiveProject = vi.fn()
    const service = createWorkbenchProjectPersistenceService({ setActiveProject })

    await expect(service.hydrateProject('B', guard)).rejects.toThrow('project_hydration_superseded')
    expect(deps.restore).not.toHaveBeenCalled()
    expect(deps.replay).not.toHaveBeenCalled()
    expect(setActiveProject).not.toHaveBeenCalled()
  })
})
