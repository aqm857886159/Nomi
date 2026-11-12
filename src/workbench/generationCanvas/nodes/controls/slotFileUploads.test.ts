import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import { createSlotFileUploads } from './slotFileUploads'
import * as assetApi from '../../../api/assetUploadApi'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from '../../../project/projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../../../electron/shared/surfacePortBinding'

describe('slot file import project lifetime', () => {
  let coordinator: ReturnType<typeof createProjectCanvasReadSurfaceCoordinator>
  let unregister: () => void
  async function switchProject(projectId: string) { await coordinator.beginHydration().commitCanvasRead(projectId) }
  beforeEach(async () => {
    coordinator = createProjectCanvasReadSurfaceCoordinator({
      createSurfaceInstanceId: () => 'slot-window',
      getSurfaceBridge: () => ({ suspend: async () => ({ suspension: {} }), release: async () => ({ released: true }),
        commitCanvasRead: async ({ projectId }: { projectId: string }) => ({ binding: { binding: {
          projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
        } } }),
      } as unknown as CanvasReadSurfaceBridge),
    })
    unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
    await switchProject('project-a')
  })
  afterEach(() => { unregister(); vi.restoreAllMocks() })

  it.each(['array', 'source', 'slot'] as const)('cancels %s upload permanently across A → B → A, including local state callbacks', async (kind) => {
    let finish!: () => void
    const wait = new Promise<void>(resolve => { finish = resolve })
    const uploaded = { id: 'asset', userId: 'local', name: 'image.png', createdAt: '', updatedAt: '', data: { url: 'nomi-local://asset/project-a/image.png' } }
    const importFile = vi.spyOn(assetApi, 'importWorkbenchLocalAssetFile').mockImplementation(async () => { await wait; return uploaded })
    const onReferenceAdd = vi.fn(), onSourceVideoUrl = vi.fn(), onSingleFrameUrl = vi.fn()
    const setUploadingArrayKey = vi.fn(), setUploadingSlotKey = vi.fn(), setUploadError = vi.fn()
    const handlers = createSlotFileUploads({ nodeId: 'node-1', t: ((key: string) => key) as unknown as TFunction,
      onReferenceAdd, onSourceVideoUrl, onSingleFrameUrl, setUploadingArrayKey, setUploadingSlotKey, setUploadError })
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const pending = kind === 'array' ? handlers.handleReferenceUpload(file, 'images')
      : kind === 'source' ? handlers.handleSourceVideoUpload('sourceVideo', file)
        : handlers.handleSlotUpload({ key: 'image', label: 'image', mediaKind: 'image' } as Parameters<typeof handlers.handleSlotUpload>[0], file)
    const callbacks = [onReferenceAdd, onSourceVideoUrl, onSingleFrameUrl, setUploadingArrayKey, setUploadingSlotKey, setUploadError]
    callbacks.forEach(callback => callback.mockClear())
    await switchProject('project-b'); await switchProject('project-a'); finish()
    await expect(pending).resolves.toBeUndefined()
    for (const callback of callbacks) expect(callback).not.toHaveBeenCalled()
    expect(importFile).toHaveBeenCalledWith(file, expect.any(String), expect.objectContaining({
      projectBinding: { projectId: 'project-a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 },
      assertCurrent: expect.any(Function),
    }))
  })
})
