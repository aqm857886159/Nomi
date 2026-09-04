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

vi.mock('../../desktop/activeProject', () => ({ getDesktopActiveProjectId: () => 'project-1' }))
vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ workspace: { deleteFiles: mocks.deleteFiles } }),
}))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => ({ nodes: mocks.nodes, updateNode: mocks.updateNode }),
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

function projectAsset(resultId: string, relativePath = 'assets/generated/a.png'): AssetRef {
  return {
    id: `node-1:${resultId}`,
    kind: 'image',
    name: '结果',
    renderUrl: `nomi-local://asset/project-1/${relativePath}`,
    ownerNodeId: 'node-1',
    ownerResultId: resultId,
    source: 'project',
    origin: { source: 'project', projectId: 'project-1', relativePath },
  }
}

describe('deleteAssetResult durability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const a = image('a', 'nomi-local://asset/project-1/assets/generated/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/generated/b.png')
    mocks.nodes = [node(a, [a, b])]
    mocks.updateNode.mockImplementation((_nodeId: string, patch: Partial<GenerationCanvasNode>) => {
      mocks.nodes = mocks.nodes.map((candidate) => candidate.id === 'node-1' ? { ...candidate, ...patch } : candidate)
    })
    mocks.persistNow.mockResolvedValue({ id: 'project-1' })
    mocks.deleteFiles.mockResolvedValue({ deletedCount: 1, failedCount: 0 })
  })

  it('persists the current manifest before deleting the physical file', async () => {
    await deleteAssetResult(projectAsset('a'), 'project-1')

    expect(mocks.updateNode).toHaveBeenCalledOnce()
    expect(mocks.persistNow).toHaveBeenCalledOnce()
    expect(mocks.deleteFiles).toHaveBeenCalledOnce()
    expect(mocks.persistNow.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteFiles.mock.invocationCallOrder[0])
  })

  it('does not delete the file when immediate persistence fails', async () => {
    mocks.persistNow.mockRejectedValueOnce(new Error('disk full'))

    await expect(deleteAssetResult(projectAsset('a'), 'project-1')).rejects.toThrow('disk full')
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(mocks.nodes[0].result?.id).toBe('a')
    expect(mocks.nodes[0].history?.map((result) => result.id)).toEqual(['a', 'b'])
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

    await deleteAssetResult(projectAsset('a'), 'project-1')

    expect(mocks.persistNow).toHaveBeenCalledOnce()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
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

    const deleteA = deleteAssetResult(projectAsset('a'), 'another-project')
    const deleteB = deleteAssetResult(projectAsset('b', 'assets/generated/b.png'), 'another-project')
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
  })
})
