import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { __resetCanvasUndoJournalForTests, getOldestReachableUndoPosition, pushUndoSnapshot } from '../generationCanvas/events/canvasUndoJournal'
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
import { __resetPendingAssetDeletionsForTests, releaseLoadedProjectAssetDeletions, sweepPersistedAssetDeletions } from './pendingAssetDeletions'

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
    ownerNodeId: 'node-1', ownerResultId: resultId, source: 'project',
    origin: { source: 'project', projectId: 'project-1', relativePath: `assets/generated/${resultId}.png` },
  }
}

function setCanvas(result: GenerationNodeResult, history: GenerationNodeResult[]): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node(result, history)], edges: [], groups: [], selectedNodeIds: [] })
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
    __resetCanvasUndoJournalForTests()
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
      { relativePath: 'assets/generated/a.png' },
      { relativePath: 'assets/generated/b.png' },
      { relativePath: '' },
      'junk',
    ])
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/a.png'] })
  })
})
