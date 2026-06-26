import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importLocalMediaFilesToGenerationCanvas } from './assetImportAdapter'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'

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
  beforeEach(() => {
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
  })

  it('does not persist a data URL before the local asset import finishes', async () => {
    let resolveUpload: ((asset: any) => void) | null = null
    const uploadFile = vi.fn(() => new Promise<any>((resolve) => {
      resolveUpload = resolve
    }))
    const promise = importLocalMediaFilesToGenerationCanvas([makeImageFile()], {
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

    resolveUpload?.({
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
    await importLocalMediaFilesToGenerationCanvas([makeVideoFile()], {
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
})
