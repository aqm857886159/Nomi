import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 1×1 PNG：真实存储会校验生成素材字节，不能拿随手字符串冒充截图。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const mock = vi.hoisted(() => ({
  root: '',
  getSources: vi.fn(),
  send: vi.fn(),
  win: null as unknown,
}))
vi.mock('electron', () => ({
  app: { getPath: () => mock.root, getAppPath: () => process.cwd(), getName: () => 'Nomi', on: vi.fn() },
  desktopCapturer: { getSources: mock.getSources },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn(), isRegistered: vi.fn() },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, size: { width: 1, height: 1 } }),
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
}))
vi.mock('../appWindowRegistry', () => ({ getMainWindow: () => mock.win }))
vi.mock('../assets/assetEvents', () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }))

const roots: string[] = []
function temp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-screenshot-context-'))
  roots.push(root)
  return root
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const thumbnail = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => PNG }

beforeEach(() => {
  vi.resetModules()
  mock.root = temp()
  vi.stubEnv("NOMI_SETTINGS_DIR", path.join(mock.root, 'settings'))
  const webContents = { send: mock.send }
  mock.win = { isDestroyed: () => false, show: vi.fn(), focus: vi.fn(), webContents }
})
afterEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function openWindowOnProject() {
  const { createProject, projectDirById } = await import('../projects/repository')
  const { listProjectAssets } = await import('../assets/projectAssetStore')
  const { canvasReadSurfaceRuntime } = await import('../capabilityCore/canvasReadSurfaceRuntime')
  const screenshot = await import('./screenshotHotkey')
  const a = createProject({ rootPath: temp(), name: 'A', payload: {} })
  const b = createProject({ rootPath: temp(), name: 'B', payload: {} })
  expect(projectDirById(a.id)).toBeTruthy()
  const { registry, ownerAuthority } = canvasReadSurfaceRuntime
  const owner = ownerAuthority.capture({
    contents: (mock.win as { webContents: object }).webContents, frame: {}, webContentsId: 1, processId: 2,
    frameRoutingId: 3, origin: 'file://', isLive: () => true,
  })
  const hydrate = async (projectId: string) => {
    const suspension = registry.suspend(owner, { surfaceInstanceId: 'canvas' })
    return registry.commitCanvasRead(owner, { projectId, suspension })
  }
  const bindingA = await hydrate(a.id)
  const assets = (projectId: string) => listProjectAssets({ projectId }).items
  return { screenshot, a, b, bindingA, hydrate, assets }
}

it('cancels a hotkey capture when the project is replaced while the screen capture is pending', async () => {
  const { screenshot, a, b, hydrate, assets } = await openWindowOnProject()
  const pending = deferred<unknown[]>()
  mock.getSources.mockReturnValue(pending.promise)

  const capture = screenshot.captureScreenToCanvas()
  await vi.waitFor(() => expect(mock.getSources).toHaveBeenCalledOnce())
  await hydrate(b.id)
  pending.resolve([{ display_id: '1', thumbnail }])
  await capture

  expect(assets(b.id)).toEqual([])
  expect(assets(a.id)).toEqual([])
  expect(mock.send).not.toHaveBeenCalledWith('nomi:screenshot:captured', expect.anything())
})

it('does not revive a capture after switching away and back to the original project', async () => {
  const { screenshot, a, b, hydrate, assets } = await openWindowOnProject()
  const pending = deferred<unknown[]>()
  mock.getSources.mockReturnValue(pending.promise)

  const capture = screenshot.captureScreenToCanvas()
  await vi.waitFor(() => expect(mock.getSources).toHaveBeenCalledOnce())
  await hydrate(b.id)
  await hydrate(a.id)
  pending.resolve([{ display_id: '1', thumbnail }])
  await capture

  expect(assets(a.id)).toEqual([])
  expect(mock.send).not.toHaveBeenCalledWith('nomi:screenshot:captured', expect.anything())
})

it('publishes into the original project and hands the exact surface binding to the renderer', async () => {
  const { screenshot, a, b, bindingA, assets } = await openWindowOnProject()
  const pending = deferred<unknown[]>()
  mock.getSources.mockReturnValue(pending.promise)

  const capture = screenshot.captureScreenToCanvas()
  await vi.waitFor(() => expect(mock.getSources).toHaveBeenCalledOnce())
  pending.resolve([{ display_id: '1', thumbnail }])
  await capture

  expect(assets(a.id)).toHaveLength(1)
  expect(assets(b.id)).toEqual([])
  expect(mock.send).toHaveBeenCalledWith('nomi:screenshot:captured', expect.objectContaining({
    url: expect.stringContaining(a.id), width: 1, height: 1, surfaceBinding: bindingA,
  }))
})

it('reports no project without capturing the screen when no project surface is committed', async () => {
  const { canvasReadSurfaceRuntime } = await import('../capabilityCore/canvasReadSurfaceRuntime')
  const screenshot = await import('./screenshotHotkey')
  expect(canvasReadSurfaceRuntime.getCommittedProjectSelection()).toBeNull()

  await screenshot.captureScreenToCanvas()

  expect(mock.getSources).not.toHaveBeenCalled()
  expect(mock.send).toHaveBeenCalledWith('nomi:screenshot:failed', { reason: 'no-project' })
})
