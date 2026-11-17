import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'

const mocks = vi.hoisted(() => ({
  nodes: [] as GenerationCanvasNode[],
  updateNode: vi.fn(),
  persistNow: vi.fn(),
  deleteFiles: vi.fn(),
  readLocalProjectAsync: vi.fn(),
  saveLocalProject: vi.fn(),
}))

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ workspace: { deleteFiles: mocks.deleteFiles } }),
}))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    // 已加载的是 project-1 的画布（存活判定只认此刻载入的那个项目，读不到就保留文件）。
    getState: () => ({
      nodes: mocks.nodes, updateNode: mocks.updateNode, isReady: true, projectId: 'project-1',
      readDocumentSnapshot: () => ({ nodes: mocks.nodes, edges: [], groups: [] }),
    }),
  },
}))
vi.mock('../project/workbenchProjectSession', () => ({
  persistActiveWorkbenchProjectNow: mocks.persistNow,
}))
vi.mock('../library/localProjectStore', () => ({
  readLocalProjectAsync: mocks.readLocalProjectAsync,
  saveLocalProject: mocks.saveLocalProject,
}))

import { deleteAssetResult } from './deleteAssetResult'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { __resetCanvasUndoJournalForTests, getHistoryFlags } from '../generationCanvas/events/canvasUndoJournal'
import { __resetPendingAssetDeletionsForTests, listPersistedAssetDeletions, releaseLoadedProjectAssetDeletions } from './pendingAssetDeletions'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from '../timeline/timelineMath'

/** 发起删除时签发的已加载项目（测试替身）。 */
function loaded(projectId: string): ProjectExecutionContext {
  return { binding: { projectId, immutableProjectUuid: `uuid-${projectId}`, projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
}

function image(id: string, url: string): GenerationNodeResult {
  return { id, type: 'image', url, createdAt: 1 }
}

function node(result: GenerationNodeResult, history: GenerationNodeResult[]): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: '结果',
    position: { x: 0, y: 0 },
    status: 'success',
    result,
    history,
  }
}

/** 删一版：画布上的一张结果（版本卡片、项目素材里画布那一格都由 canvasNodeToAssetRefs 造成这个样子）。 */
function resultAsset(resultId: string, relativePath = 'assets/generated/a.png', nodeId = 'node-1'): AssetRef {
  return {
    id: `${nodeId}:${resultId}`,
    kind: 'image',
    name: '结果',
    renderUrl: `nomi-local://asset/project-1/${relativePath}`,
    ownerResultId: resultId,
    source: 'canvas',
    origin: { source: 'canvas', nodeId, resultId },
  }
}

/** 删一份落盘文件：项目素材 / 全部素材里的文件格子（workspaceNodeToAssetRef / assetRefFromDesktopAsset 的样子）。 */
function fileAsset(relativePath = 'assets/generated/a.png'): AssetRef {
  return {
    id: relativePath,
    kind: 'image',
    name: relativePath.split('/').pop() ?? relativePath,
    renderUrl: `nomi-local://asset/project-1/${relativePath}`,
    source: 'project',
    origin: { source: 'project', projectId: 'project-1', relativePath },
  }
}

/** 删除排队期间项目已经换掉：此刻它是关闭的项目。 */
function stale(projectId: string): ProjectExecutionContext {
  return { ...loaded(projectId), assertCurrent: () => { throw new Error('project switched') } }
}

describe('deleteAssetResult durability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCanvasUndoJournalForTests()
    __resetPendingAssetDeletionsForTests()
    useWorkbenchStore.getState().setTimeline(createDefaultTimeline())
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    mocks.nodes = [node(a, [a, b])]
    mocks.updateNode.mockImplementation((_nodeId: string, patch: Partial<GenerationCanvasNode>) => {
      mocks.nodes = mocks.nodes.map((candidate) => candidate.id === 'node-1' ? { ...candidate, ...patch } : candidate)
    })
    mocks.persistNow.mockResolvedValue({ id: 'project-1' })
    mocks.deleteFiles.mockResolvedValue({ deletedCount: 1, failedCount: 0 })
  })

  it('defers the physical file and saves the pending entry in the same write as the version removal', async () => {
    let pendingAtSave: unknown
    mocks.persistNow.mockImplementation(async () => {
      pendingAtSave = listPersistedAssetDeletions()
      return { id: 'project-1' }
    })
    const outcome = await deleteAssetResult(resultAsset('a'), loaded('project-1'))

    expect(mocks.updateNode).toHaveBeenCalledOnce()
    expect(mocks.persistNow).toHaveBeenCalledOnce()
    // App 在这之后直接退出：项目文件里已经记着这一笔，下次打开清扫。
    expect(pendingAtSave).toEqual([{ relativePath: 'assets/generated/a.png', source: 'asset-library' }])
    expect(outcome).toMatchObject({ removedResultCount: 1, deletedFileCount: 0, deferredFileCount: 1 })
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledOnce()
    expect(mocks.persistNow.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteFiles.mock.invocationCallOrder[0])
  })

  it('does not delete the file, keep a pending entry, or leave an empty undo step when persistence fails', async () => {
    mocks.persistNow.mockRejectedValueOnce(new Error('disk full'))

    await expect(deleteAssetResult(resultAsset('a'), loaded('project-1'))).rejects.toThrow('disk full')
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(mocks.nodes[0].result?.id).toBe('a')
    expect(mocks.nodes[0].history?.map((result) => result.id)).toEqual(['a', 'b'])
    expect(listPersistedAssetDeletions()).toBeUndefined()
    expect(getHistoryFlags().canUndo).toBe(false)
  })

  it('keeps the file when the timeline still plays it, even though no node references it any more', async () => {
    const url = 'nomi-local://asset/project-1/assets/generated/a.png'
    useWorkbenchStore.getState().setTimeline({
      version: 1, fps: 30, scale: 1, playheadFrame: 0, textClips: [],
      tracks: [{ id: 'imageTrack', type: 'image', label: '图片轨', clips: [{
        id: 'clip-1', type: 'image', sourceNodeId: 'node-1', label: 'a', startFrame: 0, endFrame: 30, frameCount: 30,
        offsetStartFrame: 0, offsetEndFrame: 0, url,
      }] }],
    })

    const outcome = await deleteAssetResult(resultAsset('a'), loaded('project-1'))
    expect(outcome.removedResultCount).toBe(1)
    expect(outcome.deferredFileCount).toBe(0)
    expect(outcome.keptInUseCount).toBe(1)
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('keeps a shared physical file while another result still references it', async () => {
    const shared = image('shared', 'nomi-local://asset/project-1/assets/generated/a.png')
    mocks.nodes = [
      node(image('a', 'nomi-local://asset/project-1/assets/generated/a.png'), [image('a', 'nomi-local://asset/project-1/assets/generated/a.png')]),
      {
        ...node(shared, []),
        id: 'node-2',
        result: { id: 'video', type: 'video', url: 'nomi-local://asset/project-1/assets/generated/video.mp4', thumbnailUrl: shared.url, createdAt: 1 },
      },
    ]

    const outcome = await deleteAssetResult(resultAsset('a'), loaded('project-1'))

    expect(mocks.persistNow).toHaveBeenCalledOnce()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ removedResultCount: 1, keptInUseCount: 1 })
  })

  it('serializes closed-project deletions so concurrent buttons cannot restore stale references', async () => {
    const latch = { resolve: null as ((value: unknown) => void) | null }
    const firstRead = new Promise((resolve) => { latch.resolve = resolve })
    let storedProject = {
      id: 'project-1',
      name: '测试项目',
      payload: { generationCanvas: { nodes: mocks.nodes, edges: [], groups: [] } },
    }
    mocks.readLocalProjectAsync
      .mockImplementationOnce(() => firstRead)
      .mockImplementation(() => Promise.resolve(storedProject))
    mocks.saveLocalProject.mockImplementation((_id: string, payload: typeof storedProject.payload) => {
      storedProject = { ...storedProject, payload }
      return storedProject
    })

    const deleteA = deleteAssetResult(fileAsset('assets/generated/a.png'), loaded('another-project'))
    const deleteB = deleteAssetResult(fileAsset('assets/generated/b.png'), loaded('another-project'))
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.readLocalProjectAsync).toHaveBeenCalledTimes(1)

    latch.resolve?.(storedProject)
    await Promise.all([deleteA, deleteB])

    expect(mocks.readLocalProjectAsync).toHaveBeenCalledTimes(2)
    expect(mocks.saveLocalProject).toHaveBeenCalledTimes(2)
    expect(storedProject.payload.generationCanvas.nodes[0]).toMatchObject({
      result: undefined,
      history: [],
      status: 'idle',
    })
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(2)
  })

  it('does not directly delete a closed-project file while another node still references it', async () => {
    const sharedUrl = 'nomi-local://asset/project-1/assets/generated/shared.png'
    const first = image('a', sharedUrl)
    const second = image('b', sharedUrl)
    let storedProject = {
      id: 'project-1',
      name: 'shared',
      payload: { generationCanvas: { nodes: [node(first, [first]), { ...node(second, [second]), id: 'node-2' }], edges: [], groups: [] } },
    }
    mocks.readLocalProjectAsync.mockImplementation(() => Promise.resolve(storedProject))
    mocks.saveLocalProject.mockImplementation((_id: string, payload: typeof storedProject.payload) => {
      storedProject = { ...storedProject, payload }
      return storedProject
    })

    await deleteAssetResult(resultAsset('a', 'assets/generated/shared.png'), stale('project-1'))
    expect(mocks.deleteFiles).not.toHaveBeenCalled()

    await deleteAssetResult(resultAsset('b', 'assets/generated/shared.png', 'node-2'), stale('project-1'))
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: 'project-1', relativePaths: ['assets/generated/shared.png'] })
  })

})
