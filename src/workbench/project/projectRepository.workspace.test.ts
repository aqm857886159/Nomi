import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProject, readLocalProject } from './projectRepository'
import { migrateProjectRecord } from './projectCategoryMigration'
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
    // seedKey 是播种身份：程序化播种用它判断「这个示例已播过」。名字不是身份——
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

  it('stamps draft:true on a freshly created blank project (no seedKey, no rootPath)', () => {
    // 草稿态：新建空白零编辑会被启动 GC 回收。example（有 seedKey）/打开文件夹（有 rootPath）不打标记。
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

    createLocalProject('新建空白')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ draft: true }))

    create.mockClear()
    createLocalProject('示例', undefined, { seedKey: 'example:product-demo' })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ draft: true }))

    create.mockClear()
    createLocalProject('外部', undefined, { rootPath: '/Users/me/Work/Folder' })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ draft: true }))
  })

  describe('creation invariants (single ProjectCreationSpec construction point)', () => {
    // 防整类创建 bug（审计 A4/A11）：无论哪个入口拼装的创建规格，落地记录都必须满足
    // 同一组不变量——分类齐备、默认节点出生即带 categoryId、身份字段（seedKey/draft）
    // 互斥正确、且过分类迁移必须 no-op（alreadyMigrated）。否则「新建空白被当 legacy
    // 迁移删默认节点」会从任意入口复发。
    beforeEach(() => {
      // 浏览器降级：createLocalProject 直接返回记录（不经 IPC），可对记录断言。
      mockedGetDesktopBridge.mockReturnValue(null)
    })

    it('blank project: draft + no seedKey + builtin categories + 空画布默认 + migration no-op', () => {
      const record = createLocalProject()

      expect(record.draft).toBe(true)
      expect('seedKey' in record).toBe(false)
      expect(record.payload.categories.length).toBeGreaterThan(0)
      // 新建空白项目默认空画布（用户拍板 2026-06-15：删了「剧本片段 + 关键画面」预设两卡）。
      // 进画布即空 → CanvasEmptyState 引导；主链路靠创作区拆镜头灌节点。
      expect(record.payload.generationCanvas.nodes).toHaveLength(0)

      // 空画布天然是「已迁移形态」（无节点可迁移）→ 分类迁移仍 no-op，不弹「已升级」toast。
      const { diagnostic } = migrateProjectRecord(record)
      expect(diagnostic.alreadyMigrated).toBe(true)
      expect(diagnostic.removedNodes).toBe(0)
      expect(diagnostic.migratedNodes).toBe(0)
    })

    it('example project: seedKey + not draft + 空画布默认 + migration still no-op', () => {
      const record = createLocalProject('示例：30 秒产品介绍', undefined, {
        seedKey: 'example:product-demo',
      })

      expect(record.seedKey).toBe('example:product-demo')
      expect('draft' in record).toBe(false)
      // 示例项目内容 = 创作区故事稿（buildStoryDocument），不预建画布节点 → 画布同样默认空。
      expect(record.payload.generationCanvas.nodes).toHaveLength(0)

      const { diagnostic } = migrateProjectRecord(record)
      expect(diagnostic.alreadyMigrated).toBe(true)
      expect(diagnostic.removedNodes).toBe(0)
    })
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
    // 三轨：旧 2 轨工程加载时 normalizeTimeline 自动补音频轨（migration，幂等）。
    expect(record?.payload.timeline.tracks).toHaveLength(3)
    expect(record?.payload.timeline.tracks.map((t) => t.type)).toEqual(['image', 'video', 'audio'])
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
