import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProject, readLocalProject } from './projectRepository'
import { getDesktopBridge } from '../../desktop/bridge'

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: vi.fn(),
}))

const mockedGetDesktopBridge = vi.mocked(getDesktopBridge)

describe('projectRepository workspace project creation', () => {
  beforeEach(() => {
    mockedGetDesktopBridge.mockReset()
  })

  it('desktop createLocalProject does not pass arbitrary rootPath through projects.create', () => {
    const create = vi.fn((record: unknown) => ({ ...(record as object), id: 'desktop-id' }))
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { create } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    createLocalProject('Desktop Project', undefined, { rootPath: '/Users/me/Work/Nomi Project' })

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ rootPath: expect.any(String) }))
  })

  it('browser fallback still creates local project without rootPath', () => {
    mockedGetDesktopBridge.mockReturnValue(null)

    const record = createLocalProject('Browser Project')

    expect(record).toMatchObject({ name: 'Browser Project', version: 1 })
    expect('rootPath' in record).toBe(false)
  })

  it('stamps seedKey onto programmatically seeded projects (idempotent example seeding, audit A8)', () => {
    // seedKey 是播种身份：tryExample 以它判断「这个示例已播过」。名字不是身份——
    // 此前以 projectName 重复 createLocalProject 堆出几十个重名示例项目。
    const create = vi.fn((record: unknown) => record)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { create } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    createLocalProject('示例：30 秒产品介绍', undefined, { seedKey: 'example:product-demo' })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ seedKey: 'example:product-demo' }))

    mockedGetDesktopBridge.mockReturnValue(null)
    const record = createLocalProject('手动项目')
    expect('seedKey' in record).toBe(false)
  })

  it('reads a workspace manifest record (version 2, nested payload) without throwing', () => {
    // Regression: the workspace folder migration writes version:2 manifests
    // (.nomi/project.json) with a nested payload + lastKnownRootPath. The
    // renderer previously only accepted version:1 and mis-routed v2 records
    // through the legacy normalizer, throwing "payload 缺少必要字段".
    const v2Record = {
      id: 'ws-1',
      name: 'Workspace Project',
      version: 2,
      createdAt: 1,
      updatedAt: 2,
      savedAt: 2,
      revision: 9,
      lastKnownRootPath: '/Users/me/Work/Nomi Project',
      payload: {
        workbenchDocument: {
          version: 1,
          title: '',
          contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
          updatedAt: 1,
        },
        timeline: {
          version: 1,
          fps: 30,
          scale: 1,
          playheadFrame: 0,
          tracks: [
            { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
            { id: 'videoTrack', type: 'video', label: '媒体轨', clips: [] },
          ],
        },
        generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
        categories: [],
      },
    }
    const read = vi.fn(() => v2Record)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { read } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const record = readLocalProject('ws-1')

    expect(record).toMatchObject({ id: 'ws-1', name: 'Workspace Project', version: 1 })
    expect(record?.payload.workbenchDocument.version).toBe(1)
    expect(record?.payload.timeline.tracks).toHaveLength(2)
  })

  it('opens a freshly-initialized workspace (minimal payload) as an empty default project', () => {
    // Regression: "打开文件夹" on an existing folder writes a minimal manifest
    // payload (just { rootPath }) with no workbenchDocument/timeline/canvas.
    // The renderer used to throw "本地项目记录损坏" → hydrate rejected silently
    // → the project card "打不开". It must now open as an empty project.
    const emptyManifest = {
      id: 'ws-music',
      name: 'Music',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      savedAt: 1,
      revision: 0,
      lastKnownRootPath: '/Users/me/Music',
      payload: { rootPath: '/Users/me/Music' },
    }
    const read = vi.fn(() => emptyManifest)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { read } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const record = readLocalProject('ws-music')

    expect(record).toMatchObject({ id: 'ws-music', name: 'Music', version: 1 })
    expect(record?.payload.workbenchDocument.version).toBe(1)
    expect(record?.payload.timeline.tracks.length).toBeGreaterThan(0)
    expect(Array.isArray(record?.payload.generationCanvas.nodes)).toBe(true)
  })
})
