import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingRetryImports, importLocalMediaFilesToGenerationCanvas, retryLocalAssetImport } from './assetImportAdapter'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import type { WorkbenchAssetDto } from '../../api/assetUploadApi'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../../electron/shared/surfacePortBinding'
import * as capacitySnapshot from '../../assets/storageCapacitySnapshot'
import { AssetImportError } from '../../../../electron/shared/contracts/assetImportResult'

function currentProject(): ProjectExecutionContext {
  return withProjectAction((context) => context, () => { throw new Error('no project open') })
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const asset = { id: 'asset-1', name: 'image', userId: 'local', createdAt: '', updatedAt: '', data: { url: 'nomi-local://asset/project-a/image.png' } }
const makeCoordinator = () => createProjectCanvasReadSurfaceCoordinator({
  createSurfaceInstanceId: () => 'window',
  getSurfaceBridge: () => ({
    suspend: async () => ({ suspension: {} }), release: async () => ({ released: true }),
    commitCanvasRead: async ({ projectId }: { projectId: string }) => ({ binding: { binding: {
      projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
    } } }),
  } as unknown as CanvasReadSurfaceBridge),
})
let coordinator: ReturnType<typeof makeCoordinator>
let unregister: () => void
async function switchProject(projectId: string) {
  const epoch = coordinator.beginHydration()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  await epoch.commitCanvasRead(projectId)
}
afterEach(() => { unregister?.(); clearPendingRetryImports(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function makeImageFile(name = 'image.png', size = 1024): File {
  return new File([new Uint8Array(size)], name, {
    type: 'image/png',
    lastModified: 1,
  })
}

function makeVideoFile(name = 'clip.mp4', size = 4096): File {
  return new File([new Uint8Array(size)], name, {
    type: 'video/mp4',
    lastModified: 1,
  })
}

describe('importLocalMediaFilesToGenerationCanvas', () => {
  beforeEach(async () => {
    coordinator = makeCoordinator(); unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
    await switchProject('project-a')
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
  })

  it.each(['capacity', 'dimensions'])('rejects a project switch during %s before creating or uploading a node', async (stage) => {
    const wait = deferred<null>()
    const dimension = vi.fn(async () => stage === 'dimensions' ? wait.promise : null)
    const capacity = vi.spyOn(capacitySnapshot, 'readStorageCapacitySnapshot').mockImplementation(async () => stage === 'capacity' ? wait.promise : null)
    const uploadFile = vi.fn(async () => asset)
    const pending = importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(), readImageDimensions: dimension, uploadFile,
    })
    await vi.waitFor(() => expect(stage === 'capacity' ? capacity : dimension).toHaveBeenCalled())
    await switchProject('project-b')
    wait.resolve(null); expect(await pending).toMatchObject({ cancelled: true, created: [], failedCount: 0 })
    expect(uploadFile).not.toHaveBeenCalled(); expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  })

  it.each(['upload', 'duration'])('permanently cancels %s completion across A → B → A', async (stage) => {
    const wait = deferred<null>()
    const uploadFile = vi.fn(async () => { if (stage === 'upload') await wait.promise; return asset })
    const duration = vi.fn(async () => { await wait.promise; return 3 })
    const recoverFile = vi.fn(async () => null)
    const pending = importLocalMediaFilesToGenerationCanvas([makeVideoFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, uploadFile, recoverFile, readVideoDuration: duration,
    })
    await vi.waitFor(() => expect(stage === 'upload' ? uploadFile : duration).toHaveBeenCalled())
    const oldNode = useGenerationCanvasStore.getState().nodes[0]
    await switchProject('project-b'); expect(useGenerationCanvasStore.getState().nodes).toEqual([])
    await switchProject('project-a')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [oldNode], edges: [], selectedNodeIds: [], groups: [] })
    wait.resolve(null); expect(await pending).toMatchObject({ cancelled: true, created: [], failedCount: 0 })
    expect(recoverFile).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes[0].result).toBeUndefined()
  })

  it('handles a pending preparation rejection after project cancellation without leaking a rejection', async () => {
    let rejectDimensions!: (error: Error) => void
    const dimensions = new Promise<null>((_, reject) => { rejectDimensions = reject })
    const pending = importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(),
      readImageDimensions: () => dimensions,
    })
    await switchProject('project-b')
    rejectDimensions(new Error('decoder cancelled'))
    await expect(pending).resolves.toMatchObject({ cancelled: true, created: [], failedCount: 0 })
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  })

  it('keeps failed retries attached to the original project lifetime', async () => {
    await importLocalMediaFilesToGenerationCanvas([makeVideoFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, uploadFile: async () => { throw new Error('disk failed') }, recoverFile: async () => null,
    })
    const oldNode = useGenerationCanvasStore.getState().nodes[0]
    await switchProject('project-b'); await switchProject('project-a')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [oldNode], edges: [], selectedNodeIds: [], groups: [] })
    await expect(retryLocalAssetImport(oldNode.id)).resolves.toBe(false)
    expect(useGenerationCanvasStore.getState().nodes[0]).toEqual(oldNode)
  })

  it.each(['capability_cancelled', 'project_binding_stale'] as const)('does not recover or use a data URL for main-process %s', async (code) => {
    const recoverFile = vi.fn(async () => null)
    const failure = new AssetImportError({ code, reason: 'import-failed' })
    await expect(importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(), readImageDimensions: async () => null,
      uploadFile: async () => { throw failure }, recoverFile,
    })).resolves.toMatchObject({ cancelled: true, created: [], failedCount: 0 })
    expect(recoverFile).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes[0].result).toBeUndefined()
  })

  it.each(['recovery', 'data-url'])('does not publish %s completion after project replacement', async (stage) => {
    const wait = deferred<null>()
    let finishDataUrl: (() => void) | undefined
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,eA=='
      onload?: () => void
      readAsDataURL() { finishDataUrl = () => this.onload?.() }
    })
    const recoverFile = vi.fn(async () => { if (stage === 'recovery') await wait.promise; return null })
    const pending = importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(), readImageDimensions: async () => null,
      uploadFile: async () => { throw new Error('disk failed') }, recoverFile,
    })
    await vi.waitFor(() => { if (stage === 'data-url') expect(finishDataUrl).toBeDefined(); else expect(recoverFile).toHaveBeenCalled() })
    await switchProject('project-b')
    wait.resolve(null); finishDataUrl?.()
    expect(await pending).toMatchObject({ cancelled: true, created: [], failedCount: 0 })
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  })

  it.each(['bytes', 'native'])('passes the original full binding through the actual %s importer', async (transport) => {
    const importFile = vi.fn(async (_request: unknown) => ({ ok: true, asset }))
    const importNativeFile = vi.fn(async (_file: File, _request: unknown) => transport === 'native' ? { ok: true, asset } : null)
    vi.stubGlobal('window', { nomiDesktop: { assets: { importFile, importNativeFile } } })
    await importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(), readImageDimensions: async () => null,
    })
    const request = transport === 'native' ? importNativeFile.mock.calls[0][1] : importFile.mock.calls[0][0]
    expect(request).toMatchObject({ projectId: 'project-a', projectBinding: {
      projectId: 'project-a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
    } })
    if (transport === 'native') expect(importFile).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe(asset.data.url)
  })

  it('拖入锚点按真实卡面尺寸换算：竖图的可见卡面中心压在松手点（负坐标同样成立）', async () => {
    const cursor = { x: -500, y: -300 }
    await importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: cursor,
      anchor: { xRatio: 0.5, yRatio: 0.5 },
      exactPosition: true,
      capacity: null,
      createObjectUrl: () => 'blob:portrait',
      revokeObjectUrl: vi.fn(),
      readImageDimensions: async () => ({ width: 1080, height: 1920 }),
      uploadFile: async () => ({ id: 'asset-p', name: 'p', userId: 'local', createdAt: '', updatedAt: '', data: { url: 'nomi-local://asset/project-1/p.png' } }),
      recoverFile: async () => null,
    })
    const node = useGenerationCanvasStore.getState().nodes[0]
    const width = node.size?.width ?? 0
    const height = Number(node.meta?.previewHeight)
    expect(height).toBeGreaterThan(width)
    expect(node.position.x + width / 2).toBeCloseTo(cursor.x, 0)
    expect(node.position.y + height / 2).toBeCloseTo(cursor.y, 0)
  })

  it('does not persist a data URL before the local asset import finishes', async () => {
    let resolveUpload: ((asset: WorkbenchAssetDto) => void) | null = null
    const uploadFile = vi.fn(() => new Promise<WorkbenchAssetDto>((resolve) => {
      resolveUpload = resolve
    }))
    const promise = importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 10, y: 20 },
      createObjectUrl: () => 'blob:preview',
      revokeObjectUrl: vi.fn(),
      readImageDimensions: async () => ({ width: 100, height: 100 }),
      uploadFile,
      recoverFile: async () => null,
    })

    await vi.waitFor(() => {
      expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
      expect(uploadFile).toHaveBeenCalledTimes(1)
    })

    const uploadingNode = useGenerationCanvasStore.getState().nodes[0]
    expect(uploadingNode.result?.url).toBeUndefined()
    expect(uploadingNode.history).toEqual([])
    expect(uploadingNode.meta?.uploadStatus).toBe('uploading')

    resolveUpload!({
      id: 'asset-1',
      name: 'image',
      userId: 'local',
      createdAt: '',
      updatedAt: '',
      data: { url: 'nomi-local://asset/project-1/image.png' },
    })
    await promise

    const uploadedNode = useGenerationCanvasStore.getState().nodes[0]
    expect(uploadedNode.result?.url).toBe('nomi-local://asset/project-1/image.png')
    expect(uploadedNode.result?.url?.startsWith('data:')).toBe(false)
  })

  it('imports a video file as a video asset node and records real duration', async () => {
    const uploadFile = vi.fn(async () => ({
      id: 'asset-v',
      name: 'clip',
      userId: 'local',
      createdAt: '',
      updatedAt: '',
      data: { url: 'nomi-local://asset/project-1/clip.mp4' },
    }))
    await importLocalMediaFilesToGenerationCanvas([makeVideoFile()], { projectContext: currentProject(),
      basePosition: { x: 10, y: 20 },
      createObjectUrl: () => 'blob:preview',
      revokeObjectUrl: vi.fn(),
      readImageDimensions: async () => null,
      readVideoDuration: async () => 12.5,
      uploadFile,
      recoverFile: async () => null,
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(node.result?.type).toBe('video')
    expect(node.result?.url).toBe('nomi-local://asset/project-1/clip.mp4')
    expect(node.meta?.videoDuration).toBe(12.5)
  })

  it('keeps a failed video import retryable instead of losing the source file', async () => {
    const uploadFile = vi.fn(async () => { throw new Error('copy failed') })
    const result = await importLocalMediaFilesToGenerationCanvas([makeVideoFile()], { projectContext: currentProject(),
      basePosition: { x: 10, y: 20 },
      uploadFile,
      recoverFile: async () => null,
      readVideoDuration: async () => null,
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.failedCount).toBe(1)
    expect(node.status).toBe('error')
    expect(node.error).toContain('重试导入')
    expect(node.meta?.retryableImport).toBe(true)
  })
})

// 2026-10-09 对抗评审 B1（复审）：导入结果要说清**每个节点**成没成——上传失败（节点留成 error）的不许被当成「导入好了」去接线。
describe('importLocalMediaFilesToGenerationCanvas · per-node success', () => {
  beforeEach(async () => {
    coordinator = makeCoordinator(); unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
    await switchProject('project-a')
    __resetGenerationCanvasHistoryForTests()
  })

  it('a failed upload stays an error card and is NOT in succeededNodeIds', async () => {
    const result = await importLocalMediaFilesToGenerationCanvas([makeVideoFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, uploadFile: async () => { throw new Error('disk failed') }, recoverFile: async () => null,
    })
    expect(result.created).toHaveLength(1)
    expect(result.failedCount).toBe(1)
    expect(result.succeededNodeIds).toEqual([])
    expect(useGenerationCanvasStore.getState().nodes[0].status).toBe('error')
  })

  it('a successful upload is reported as succeeded', async () => {
    const result = await importLocalMediaFilesToGenerationCanvas([makeImageFile()], { projectContext: currentProject(),
      basePosition: { x: 0, y: 0 }, capacity: null, createObjectUrl: () => 'blob:test', revokeObjectUrl: vi.fn(), readImageDimensions: async () => null,
      uploadFile: async () => asset, recoverFile: async () => null,
    })
    expect(result.succeededNodeIds).toEqual(result.created.map((item) => item.node.id))
    expect(result.failedCount).toBe(0)
  })
})
