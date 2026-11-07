import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { CanvasReadSurfaceIpcCapture } from '../capabilityCore/canvasReadSurfaceIpc'
import { SurfacePortWireError } from '../shared/surfacePortBinding'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>(),
  importFile: vi.fn(), importRemote: vi.fn(), trusted: vi.fn() }))
vi.mock('electron', () => ({ clipboard: {}, dialog: {}, ipcMain: {
  handle: (name: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) => mocks.handlers.set(name, handler),
} }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: mocks.trusted, assertTrustedUiSender: mocks.trusted }))
vi.mock('./projectAssetStore', () => ({ copyProjectAsset: vi.fn(), importRemoteAsset: mocks.importRemote }))
vi.mock('./downloadPrefs', () => ({ getAutoSavePrefs: vi.fn(), setAutoSavePrefs: vi.fn() }))
vi.mock('./localFileImport', async importOriginal => ({
  ...await importOriginal<typeof import('./localFileImport')>(),
  importLocalFile: mocks.importFile,
}))
import { createProjectInteractionCapture } from './projectInteractionCapture'
import { registerAssetsIpc } from './assetsIpc'
import { MediaImportRejectedError } from './localFileImport'

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear() })

describe('interactive asset IPC publication authority', () => {
  const binding = { projectId: 'a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
  // 导入经中立的在途请求登记：sender 要有窗口的样子（生产里 event.sender 永远是 WebContents）。
  const sender = { id: 1, isDestroyed: () => false, once: () => undefined, removeListener: () => undefined }
  const event = { sender, senderFrame: {} } as unknown as IpcMainInvokeEvent

  it.each(['nomi:assets:import-file', 'nomi:assets:import-native-file'])('preserves real admission reasons in the wire reply: %s', async channel => {
    registerAssetsIpc(createProjectInteractionCapture({} as CanvasReadSurfaceIpcCapture, () => undefined))
    mocks.importFile.mockRejectedValue(new MediaImportRejectedError({
      reason: 'no-disk-space', fileBytes: 16, freeBytes: 0, neededBytes: 16,
    }, 'note.txt'))
    await expect(mocks.handlers.get(channel)!(event, { projectId: 'a' })).resolves.toEqual({
      ok: false, failure: { code: 'capability_execution_failed', reason: 'no-disk-space' },
    })
  })

  it.each(['nomi:assets:import-file', 'nomi:assets:import-native-file'])('captures the trusted session before any await and rejects revoked publication: %s', async channel => {
    const session = Object.freeze({})
    let current = true
    const capture = { openProjectSession: vi.fn(() => { if (!current) throw new Error('too late'); return session }),
      assertProjectSession: vi.fn((sender, supplied) => {
        expect(sender).toBe(event); expect(supplied).toBe(session)
        if (!current) throw new SurfacePortWireError('project_binding_stale')
      }),
    }
    registerAssetsIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
    mocks.importFile.mockImplementation(async (_payload, options) => { options.assertCurrent(); return { id: 'must-not-publish' } })
    const pending = mocks.handlers.get(channel)!(event, { projectId: 'a', projectBinding: binding, bytes: new Uint8Array([1]), sourcePath: '/native' })
    expect(capture.openProjectSession).toHaveBeenCalledWith(event, binding)
    current = false
    await expect(pending).resolves.toMatchObject({ ok: false, failure: { code: 'project_binding_stale' } })
  })

  it('does not turn explicit project file IO into a current-window-only operation', async () => {
    const capture = { openProjectSession: vi.fn(), assertProjectSession: vi.fn() }
    registerAssetsIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
    mocks.importFile.mockResolvedValue({ id: 'explicit-project-file' })
    await expect(mocks.handlers.get('nomi:assets:import-file')!(event, { projectId: 'a' }))
      .resolves.toEqual({ ok: true, asset: { id: 'explicit-project-file' } })
    expect(capture.openProjectSession).not.toHaveBeenCalled()
  })

  it('binds remote downloads to the trusted session before downloading', async () => {
    const session = Object.freeze({})
    let current = true
    const capture = { openProjectSession: vi.fn(() => session), assertProjectSession: vi.fn(() => {
      if (!current) throw new SurfacePortWireError('project_binding_stale')
    }) }
    registerAssetsIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
    mocks.importRemote.mockImplementation(async (_payload, options) => {
      await Promise.resolve()
      options.assertCurrent()
      return { id: 'must-not-publish' }
    })
    const pending = mocks.handlers.get('nomi:assets:import-remote-url')!(event, { projectId: 'a', projectBinding: binding })
    expect(capture.openProjectSession).toHaveBeenCalledWith(event, binding)
    current = false
    await expect(pending).resolves.toMatchObject({ ok: false, failure: { code: 'project_binding_stale' } })
  })

  it('a child window imports only into its parent window\'s project and loses that authority with the parent session', async () => {
    let parentCurrent = true
    const parent = { binding, surfaceBinding: {} as never, assertCurrent: vi.fn(() => {
      if (!parentCurrent) throw new SurfacePortWireError('project_binding_stale')
    }) }
    const capture = { openProjectSession: vi.fn(), assertProjectSession: vi.fn() }
    registerAssetsIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => parent))
    mocks.importFile.mockImplementation(async (_payload, options) => { options.assertCurrent(); return { id: 'into-parent-project' } })
    const importFile = mocks.handlers.get('nomi:assets:import-file')!

    await expect(importFile(event, { projectId: 'b', bytes: new Uint8Array([1]) }))
      .resolves.toMatchObject({ ok: false, failure: { code: 'project_binding_stale' } })
    expect(mocks.importFile).not.toHaveBeenCalled()

    await expect(importFile(event, { projectId: 'a', bytes: new Uint8Array([1]) }))
      .resolves.toEqual({ ok: true, asset: { id: 'into-parent-project' } })
    expect(capture.openProjectSession).not.toHaveBeenCalled()

    parentCurrent = false
    await expect(importFile(event, { projectId: 'a', bytes: new Uint8Array([1]) }))
      .resolves.toMatchObject({ ok: false, failure: { code: 'project_binding_stale' } })
  })

  it('refuses a child window import when the parent window has no project session', async () => {
    const refuse = () => { throw Object.assign(new Error('project_identity_unavailable'), { code: 'project_identity_unavailable' }) }
    registerAssetsIpc(createProjectInteractionCapture({} as CanvasReadSurfaceIpcCapture, refuse))
    await expect(mocks.handlers.get('nomi:assets:import-file')!(event, { projectId: 'a', bytes: new Uint8Array([1]) }))
      .resolves.toMatchObject({ ok: false })
    expect(mocks.importFile).not.toHaveBeenCalled()
  })
})
