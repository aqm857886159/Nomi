import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { clearHistory, getOldestReachableUndoPosition, pushUndoSnapshot } from '../generationCanvas/events/canvasPatchHistory'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'

const mocks = vi.hoisted(() => ({
  deleteFiles: vi.fn(),
  persistNow: vi.fn(),
}))

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ workspace: { deleteFiles: mocks.deleteFiles } }),
}))
vi.mock('../project/workbenchProjectSession', () => ({
  persistActiveWorkbenchProjectNow: mocks.persistNow,
}))

import { deleteAssetResult } from './deleteAssetResult'
import { removeAssetVersion } from './removeAssetVersion'
import { __resetPendingAssetDeletionsForTests, listPersistedAssetDeletions, MAX_DELETE_ATTEMPTS, isAssetFileAwaitingTrash, releaseLoadedProjectAssetDeletions, sweepPersistedAssetDeletions } from './pendingAssetDeletions'

const realFetch = globalThis.fetch
beforeAll(async () => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return Promise.reject(new Error('non-loopback fetch blocked'))
    return realFetch(input, init)
  })
  await expect(fetch('https://asset-undo-canary.invalid/')).rejects.toThrow('non-loopback fetch blocked')
})
afterAll(() => vi.unstubAllGlobals())

function loaded(projectId: string): ProjectExecutionContext {
  return { binding: { projectId, immutableProjectUuid: `uuid-${projectId}`, projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
}

function image(id: string, url: string): GenerationNodeResult {
  return { id, type: 'image', url, createdAt: Number(id === 'a' ? 1 : 2) }
}

function node(result: GenerationNodeResult, history: GenerationNodeResult[]): GenerationCanvasNode {
  return { id: 'node-1', kind: 'image', title: 'result', position: { x: 0, y: 0 }, result, history, status: 'success' }
}

function projectAsset(resultId: string): AssetRef {
  return {
    id: `node-1:${resultId}`, kind: 'image', name: 'result',
    renderUrl: `nomi-local://asset/project-1/assets/generated/${resultId}.png`,
    source: 'project',
    origin: { source: 'project', projectId: 'project-1', relativePath: `assets/generated/${resultId}.png` },
  }
}

function setCanvas(result: GenerationNodeResult, history: GenerationNodeResult[]): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node(result, history)], edges: [], groups: [], selectedNodeIds: [] }, 'project-1')
}

function toggleGesture(): void {
  const store = useGenerationCanvasStore.getState()
  store.setNodeResultStackOpen('node-1', !store.nodes[0]?.resultStackOpen)
}

async function waitForEvictionWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('deleteAssetResult with the real canvas store', () => {
  beforeEach(async () => {
    setCanvas(image('a', 'nomi-local://asset/project-1/assets/generated/a.png'), [])
    __resetPendingAssetDeletionsForTests()
    clearHistory()
    mocks.deleteFiles.mockReset()
    mocks.persistNow.mockReset()
    mocks.persistNow.mockResolvedValue({ id: 'project-1' })
    mocks.deleteFiles.mockResolvedValue({ deletedCount: 1, failedCount: 0 })
  })

  it('keeps B through an older-step eviction and restores it through the real undo path', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    for (let index = 0; index < 80; index += 1) toggleGesture()

    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    const oldestBeforeGesture = getOldestReachableUndoPosition()
    // An undo-creating gesture: it evicts an older step (not B's) from the full history.
    toggleGesture()
    await waitForEvictionWork()
    expect(getOldestReachableUndoPosition()).toBeGreaterThan(oldestBeforeGesture)
    expect(mocks.deleteFiles).not.toHaveBeenCalled()

    useGenerationCanvasStore.getState().undo()
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].history?.map((entry) => entry.id)).toContain('a')
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('keeps B until its own step is evicted when the step before it changed the canvas', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    for (let index = 0; index < 80; index += 1) toggleGesture()

    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    // 79 more steps evict every step before B's; B's own step is now the oldest reachable one.
    for (let index = 0; index < 79; index += 1) toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()

    toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/a.png'] })
  })

  it('keeps B while an empty barrier shares its position, then deletes after B is evicted', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    for (let index = 0; index < 80; index += 1) toggleGesture()
    pushUndoSnapshot()

    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    for (let index = 0; index < 79; index += 1) toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()

    toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/a.png'] })
  })

  it('flushes a loaded project pending deletion when the project closes', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    setCanvas(a, [a])
    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    expect(mocks.deleteFiles).not.toHaveBeenCalled()

    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/a.png'] })
  })

  it('a deletion that was undone is only written off on release: the file stays', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].history?.map((entry) => entry.id)).toContain('a')

    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('one deletion is exactly one undo step', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    toggleGesture()
    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    useGenerationCanvasStore.getState().undo()
    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(node.history?.map((entry) => entry.id)).toEqual(['a', 'b'])
    // 前一步（铺开）还在：撤销只退了删除这一步。
    expect(node.resultStackOpen).toBe(true)
  })

  it('opening the project sweeps files left behind by an abrupt exit, but never one the canvas still shows', async () => {
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(b, [b])
    await sweepPersistedAssetDeletions('project-1', [
      { source: 'asset-library', relativePath: 'assets/generated/a.png' },
      { source: 'asset-library', relativePath: 'assets/generated/b.png' },
      { relativePath: '' },
      'junk',
    ])
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/a.png'] })
  })

  it('a failed real delete stays on the list with its failure count, is retried, and is given up after the cap', async () => {
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(b, [b])
    mocks.deleteFiles.mockResolvedValue({ deletedCount: 0, failedCount: 1 })
    const saved = vi.fn()

    await sweepPersistedAssetDeletions('project-1', [{ source: 'asset-library', relativePath: 'assets/generated/a.png' }], saved)
    // 删失败：路径不从清单里消失，记一次失败，并请项目存盘（失败次数要落到项目文件里）。
    expect(listPersistedAssetDeletions()).toEqual([{ source: 'asset-library', relativePath: 'assets/generated/a.png', failedAttempts: 1 }])
    expect(saved).toHaveBeenCalledOnce()

    // 下次打开：拿着项目文件里那份（带失败次数）再试。
    let persisted = listPersistedAssetDeletions()
    __resetPendingAssetDeletionsForTests()
    await sweepPersistedAssetDeletions('project-1', persisted, saved)
    expect(listPersistedAssetDeletions()).toEqual([{ source: 'asset-library', relativePath: 'assets/generated/a.png', failedAttempts: 2 }])

    persisted = listPersistedAssetDeletions()
    __resetPendingAssetDeletionsForTests()
    await sweepPersistedAssetDeletions('project-1', persisted, saved)
    // 第 MAX_DELETE_ATTEMPTS 次还失败：放弃（文件只占空间），不再无限重试。
    expect(MAX_DELETE_ATTEMPTS).toBe(3)
    expect(listPersistedAssetDeletions()).toBeUndefined()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(3)

    // 一次成功就销账。
    mocks.deleteFiles.mockResolvedValue({ deletedCount: 1, failedCount: 0 })
    await sweepPersistedAssetDeletions('project-1', [{ source: 'asset-library', relativePath: 'assets/generated/c.png', failedAttempts: 2 }], saved)
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(4)
    expect(mocks.deleteFiles).toHaveBeenLastCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/c.png'] })
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('an undo-window deletion whose real delete throws is kept for the next release instead of being lost', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    for (let index = 0; index < 80; index += 1) toggleGesture()
    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    mocks.deleteFiles.mockRejectedValueOnce(new Error('EBUSY'))
    for (let index = 0; index < 80; index += 1) toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    expect(listPersistedAssetDeletions()).toEqual([{ source: 'asset-library', relativePath: 'assets/generated/a.png', failedAttempts: 1 }])

    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(2)
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('does not retry a failed library deletion on every later undo eviction', async () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    setCanvas(a, [a])
    for (let index = 0; index < 80; index += 1) toggleGesture()
    await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    mocks.deleteFiles.mockRejectedValueOnce(new Error('EBUSY'))
    for (let index = 0; index < 80; index += 1) toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    expect(listPersistedAssetDeletions()).toEqual([{ source: 'asset-library', relativePath: 'assets/generated/a.png', failedAttempts: 1 }])
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(2)
  })

})


describe('version removal keeps the original file independently of references', () => {
  beforeEach(() => {
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    __resetPendingAssetDeletionsForTests()
    clearHistory()
    setCanvas(a, [a, b])
    mocks.deleteFiles.mockReset()
    mocks.persistNow.mockReset().mockResolvedValue({ id: 'project-1' })
  })

  const removeVersion = () => removeAssetVersion('node-1', 'a', loaded('project-1'))

  it('removes only the version, supports real undo, and never authorizes file recycling', async () => {
    await removeVersion()
    expect(useGenerationCanvasStore.getState().nodes[0].history?.map(result => result.id)).not.toContain('a')
    expect(listPersistedAssetDeletions()).toBeUndefined()
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe('nomi-local://asset/project-1/assets/generated/a.png')
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('keeps an unreferenced original after its undo step is evicted and the project closes', async () => {
    await removeVersion()
    for (let index = 0; index < 90; index += 1) toggleGesture()
    await waitForEvictionWork()
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('restores the version when saving fails', async () => {
    mocks.persistNow.mockRejectedValueOnce(new Error('disk full'))
    await expect(removeVersion()).rejects.toThrow('disk full')
    expect(useGenerationCanvasStore.getState().nodes[0].result?.id).toBe('a')
    expect(listPersistedAssetDeletions()).toBeUndefined()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })
})


describe('library deletion preserves a version while undo can restore it', () => {
  beforeEach(() => {
    __resetPendingAssetDeletionsForTests()
    clearHistory()
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    setCanvas(a, [a, b])
    mocks.deleteFiles.mockReset().mockResolvedValue({ deletedCount: 1, failedCount: 0 })
    mocks.persistNow.mockReset().mockResolvedValue({ id: 'project-1' })
  })
  const target = { projectId: 'project-1', relativePath: 'assets/generated/a.png' }
  const removeThenDelete = async () => {
    await removeAssetVersion('node-1', 'a', loaded('project-1'))
    return deleteAssetResult(projectAsset('a'), loaded('project-1'))
  }

  it('hides and persists the library request, then undo restores a readable listed original', async () => {
    const outcome = await removeThenDelete()
    expect(outcome).toMatchObject({ deferredFileCount: 1, keptInUseCount: 0, removedResultCount: 0, deletedFileCount: 0 })
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(listPersistedAssetDeletions()).toEqual([{ source: 'asset-library', relativePath: target.relativePath }])
    expect(isAssetFileAwaitingTrash(target)).toBe(true)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe(projectAsset('a').renderUrl)
    expect(isAssetFileAwaitingTrash(target)).toBe(false)
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it.each([false, true])('rechecks surviving undo references when discarding redo (older reference %s)', async older => {
    const a = image('a', projectAsset('a').renderUrl!)
    const b = image('b', projectAsset('b').renderUrl!)
    setCanvas(older ? a : b, older ? [a, b] : [b])
    if (older) await removeAssetVersion('node-1', 'a', loaded('project-1'))
    const store = useGenerationCanvasStore.getState()
    store.updateNodes([{ nodeId: 'node-1', patch: { result: a, history: [a, b] } }])
    store.undo()
    const deletion = await deleteAssetResult(projectAsset('a'), loaded('project-1'))
    expect(deletion.deferredFileCount).toBe(1)
    toggleGesture()
    await waitForEvictionWork()
    if (older) {
      expect(mocks.deleteFiles).not.toHaveBeenCalled()
      store.undo()
      store.undo()
      expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe(a.url)
    } else {
      expect(mocks.deleteFiles).toHaveBeenCalledExactlyOnceWith({ projectId: target.projectId, relativePaths: [target.relativePath] })
      expect(listPersistedAssetDeletions()).toBeUndefined()
    }
  })

  it('still immediately recycles a spare file absent from all reachable history', async () => {
    await removeAssetVersion('node-1', 'a', loaded('project-1'))
    const outcome = await deleteAssetResult(projectAsset('spare'), loaded('project-1'))
    expect(outcome).toMatchObject({ deletedFileCount: 1, deferredFileCount: 0 })
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('publishes the pending file at the durable revision for deletion from the asset library', async () => {
    let captured: ReturnType<typeof listPersistedAssetDeletions>
    const unsubscribe = useGenerationCanvasStore.subscribe(state => state.persistRevision, () => {
      captured = listPersistedAssetDeletions()
    })
    try {
      await removeThenDelete()
      expect(captured).toEqual([{ source: 'asset-library', relativePath: target.relativePath }])
    } finally { unsubscribe() }
  })

  it('recycles once at close when the creator does not undo', async () => {
    await removeThenDelete()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledExactlyOnceWith({ projectId: target.projectId, relativePaths: [target.relativePath] })
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('recycles once when the retaining step is evicted', async () => {
    await removeThenDelete()
    for (let index = 0; index < 90; index += 1) toggleGesture()
    await waitForEvictionWork()
    expect(mocks.deleteFiles).toHaveBeenCalledExactlyOnceWith({ projectId: target.projectId, relativePaths: [target.relativePath] })
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
  })

  it('rolls back a library-only pending request if saving fails, preserving version undo', async () => {
    await removeAssetVersion('node-1', 'a', loaded('project-1'))
    mocks.persistNow.mockRejectedValueOnce(new Error('disk full'))
    await expect(deleteAssetResult(projectAsset('a'), loaded('project-1'))).rejects.toThrow('disk full')
    expect(listPersistedAssetDeletions()).toBeUndefined()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe(projectAsset('a').renderUrl)
  })
})
