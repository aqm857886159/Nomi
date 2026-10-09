// 子窗口（素材盒浮层）没有自己的项目会话：它的项目权威只从父窗口已提交的项目面派生，
// 随父会话一起失效（含 A→B→A），父窗口没有打开项目时拒绝。真实 surface registry，不桩身份。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => mock.root, getAppPath: () => process.cwd(), getName: () => 'Nomi', on: vi.fn() },
  shell: { openExternal: vi.fn() },
}))
vi.mock('./assetEvents', () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }))

const roots: string[] = []
function temp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-window-project-'))
  roots.push(root)
  return root
}

type FakeWindow = { webContents: object; isDestroyed(): boolean; getParentWindow(): FakeWindow | null }
function fakeWindow(parent: FakeWindow | null = null): FakeWindow {
  return { webContents: {}, isDestroyed: () => false, getParentWindow: () => parent }
}

beforeEach(() => {
  vi.resetModules()
  mock.root = temp()
  vi.stubEnv("NOMI_SETTINGS_DIR", path.join(mock.root, 'settings'))
})
afterEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function mainWindowOnProjects() {
  const { createProject } = await import('../projects/repository')
  const { canvasReadSurfaceRuntime } = await import('../capabilityCore/canvasReadSurfaceRuntime')
  const capture = await import('./windowProjectCapture')
  const main = fakeWindow()
  const overlay = fakeWindow(main)
  const a = createProject({ rootPath: temp(), name: 'A', payload: {} })
  const b = createProject({ rootPath: temp(), name: 'B', payload: {} })
  const { registry, ownerAuthority } = canvasReadSurfaceRuntime
  const owner = ownerAuthority.capture({
    contents: main.webContents, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3, origin: 'file://', isLive: () => true,
  })
  const hydrate = async (projectId: string) => {
    const suspension = registry.suspend(owner, { surfaceInstanceId: 'canvas' })
    return registry.commitCanvasRead(owner, { projectId, suspension })
  }
  const byContents = new Map<object, FakeWindow>([[main.webContents, main], [overlay.webContents, overlay]])
  const fromWebContents = (sender: object) => (byContents.get(sender) ?? null) as never
  const child = () => capture.issueChildWindowProject(overlay.webContents as never, fromWebContents)
  return { capture, main, overlay, a, b, hydrate, child, fromWebContents }
}

it('refuses a child window whose parent has no committed project', async () => {
  const { child } = await mainWindowOnProjects()
  expect(child).toThrow(expect.objectContaining({ code: 'project_identity_unavailable' }))
})

it('a top-level window is not a child and keeps its own issuance rules', async () => {
  const { capture, main, fromWebContents } = await mainWindowOnProjects()
  expect(capture.issueChildWindowProject(main.webContents as never, fromWebContents)).toBeUndefined()
})

it('derives the parent project and is revoked with the parent session, A to B to A included', async () => {
  const { a, b, hydrate, child } = await mainWindowOnProjects()
  await hydrate(a.id)
  const issued = child()!
  expect(issued.binding.projectId).toBe(a.id)
  expect(() => issued.assertCurrent()).not.toThrow()
  await hydrate(b.id)
  expect(() => issued.assertCurrent()).toThrow(expect.objectContaining({ code: 'project_binding_stale' }))
  await hydrate(a.id)
  expect(() => issued.assertCurrent()).toThrow(expect.objectContaining({ code: 'project_binding_stale' }))
  expect(child()!.binding.projectId).toBe(a.id)
})

it('never credits another window with the committed project', async () => {
  const { capture, a, hydrate } = await mainWindowOnProjects()
  await hydrate(a.id)
  expect(capture.issueWindowProject(fakeWindow() as never)).toBeNull()
})
