import { afterEach, describe, expect, it, vi } from 'vitest'
import { importWorkbenchLocalAssetFile } from './assetUploadApi'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('local asset upload transport', () => {
  it('uses the Electron native-file bridge before reading bytes into renderer memory', async () => {
    const imported = {
      id: 'asset-1', name: 'large-video.mp4', data: { url: 'nomi-local://asset/p/large-video.mp4' },
      createdAt: '', updatedAt: '', userId: 'local', projectId: 'project-1',
    }
    const importNativeFile = vi.fn(async () => imported)
    const importFile = vi.fn(async () => imported)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { nomiDesktop: { assets: { importNativeFile, importFile } } },
    })
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4))
    const file = { name: 'large-video.mp4', type: 'video/mp4', arrayBuffer } as unknown as File

    const result = await importWorkbenchLocalAssetFile(file, file.name, { projectId: 'project-1' })

    expect(result).toEqual(imported)
    expect(importNativeFile).toHaveBeenCalledWith(file, {
      projectId: 'project-1',
      fileName: 'large-video.mp4',
      contentType: 'video/mp4',
      kind: 'upload',
      ownerNodeId: null,
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(importFile).not.toHaveBeenCalled()
  })
})
