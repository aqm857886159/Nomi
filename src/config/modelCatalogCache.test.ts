import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  listVendors: vi.fn(),
}))

vi.mock('../workbench/api/modelCatalogApi', () => ({
  getWorkbenchModelCatalogHealth: vi.fn(),
  listWorkbenchModelCatalogModels: mocks.listModels,
  listWorkbenchModelCatalogVendors: mocks.listVendors,
}))

import { keepRunnableVendorOptions, notifyModelOptionsRefresh, preloadModelOptions } from './modelCatalogCache'
import { derivePublishedExecution } from '../../electron/shared/modelPublication'

const row = (modelKey: string, publishedModes: string[] = ['text_to_image'], meta?: unknown) => ({
  modelKey,
  vendorKey: 'relay',
  labelZh: modelKey,
  kind: 'image' as const,
  enabled: true,
  published: publishedModes.length > 0,
  publishedModes,
  ...(meta ? { meta } : {}),
  createdAt: 't',
  updatedAt: 't',
})

describe('normal picker verified-only projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyModelOptionsRefresh()
    mocks.listVendors.mockResolvedValue([{ key: 'relay', name: 'Relay', enabled: true, authType: 'none' }])
  })

  it('hides staged rows while preserving legacy and active-revision models', async () => {
    mocks.listModels.mockResolvedValue([
      row('legacy'),
      row('staged', [], { adapter: { state: 'unverified', modes: [], updatedAt: 't' } }),
      row('failed-new', [], { adapter: { state: 'failed', modes: [], updatedAt: 't' } }),
      row('active-repair', ['text_to_image'], { adapter: { state: 'failed', activeRevision: 'revision-good', modes: [], updatedAt: 't' } }),
      {
        ...row('scripted-repair', ['text_to_image'], { adapter: { state: 'failed', modes: [], updatedAt: 't' } }),
      },
    ])

    const options = await preloadModelOptions('image')

    expect(options.map((option) => option.value)).toEqual(expect.arrayContaining(['legacy', 'active-repair', 'scripted-repair']))
    expect(options.map((option) => option.value)).not.toEqual(expect.arrayContaining(['staged', 'failed-new']))
    expect(options).toHaveLength(3)
  })

  it('filters partial publication by the picker task mode, including image and video cross-modes', async () => {
    mocks.listModels.mockImplementation(async ({ kind }: { kind: string }) => kind === 'image'
      ? [
          row('t2i-only', ['text_to_image']),
          row('edit-only', ['image_edit']),
        ]
      : [
          { ...row('t2v-only', ['text_to_video']), kind: 'video' },
          { ...row('i2v-only', ['image_to_video']), kind: 'video' },
        ])

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 't2i-only' }])
    await expect(preloadModelOptions('imageEdit')).resolves.toMatchObject([{ value: 'edit-only' }])
    await expect(preloadModelOptions('video', 'text_to_video')).resolves.toMatchObject([{ value: 't2v-only' }])
    await expect(preloadModelOptions('video', 'image_to_video')).resolves.toMatchObject([{ value: 'i2v-only' }])
  })

  it('keeps generic custom-call DTO publication from crossing image/edit or t2v/i2v picker modes', async () => {
    const dto = (kind: 'image' | 'video', modelKey: string) => {
      const source = { ...row(modelKey), kind, customCall: { script: "return 'asset'" } }
      const publication = derivePublishedExecution(source)
      const { customCall: _privateExecutionContract, ...publicFields } = source
      return { ...publicFields, ...publication }
    }
    mocks.listModels.mockImplementation(async ({ kind }: { kind: string }) => kind === 'image'
      ? [dto('image', 'generic-image')]
      : [dto('video', 'generic-video')])

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 'generic-image' }])
    notifyModelOptionsRefresh()
    await expect(preloadModelOptions('imageEdit')).resolves.toEqual([])
    notifyModelOptionsRefresh()
    await expect(preloadModelOptions('video', 'text_to_video')).resolves.toMatchObject([{ value: 'generic-video' }])
    notifyModelOptionsRefresh()
    await expect(preloadModelOptions('video', 'image_to_video')).resolves.toEqual([])
  })

  it('honors the shared current publication mask through the real DTO-to-picker projection', async () => {
    const source = {
      ...row('shared-image'),
      vendorKey: 'source',
      meta: { adapter: {
        state: 'verified',
        activeRevision: 'revision-old',
        publicationModes: ['image_edit'],
        modes: [
          { taskKind: 'text_to_image', state: 'verified' },
          { taskKind: 'image_edit', state: 'verified' },
        ],
      } },
    }
    const sourceDto = { ...source, ...derivePublishedExecution(source, {
      mappings: [
        { vendorKey: 'source', modelKey: 'shared-image', taskKind: 'text_to_image', enabled: true },
        { vendorKey: 'source', modelKey: 'shared-image', taskKind: 'image_edit', enabled: true },
      ],
    }) }
    mocks.listModels.mockResolvedValue([
      sourceDto,
      { ...row('shared-image', ['text_to_image']), vendorKey: 'survivor' },
    ])
    mocks.listVendors.mockResolvedValue([
      { key: 'source', name: 'Source', enabled: true, authType: 'none' },
      { key: 'survivor', name: 'Survivor', enabled: true, authType: 'none' },
    ])

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 'shared-image', vendor: 'survivor' }])
    notifyModelOptionsRefresh()
    await expect(preloadModelOptions('imageEdit')).resolves.toMatchObject([{ value: 'shared-image', vendor: 'source' }])
  })
})

// 2026-09-06 用户拍板：没接入的供应商，它的模型**不显示**（不是灰显沉底）。
// 闸只有这一道，开在 catalog 派生层——所以这里既测纯函数，也测它真的接在了取目录的链上。
describe('未接入的供应商在 catalog 那层就没了', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyModelOptionsRefresh()
  })

  it('keepRunnableVendorOptions 只放行接入了的家（大小写不敏感，vendor 缺失一律挡）', () => {
    const kept = keepRunnableVendorOptions(
      [
        { value: 'a', label: 'A', vendor: 'APIMart' },
        { value: 'b', label: 'B', vendor: 'runninghub' },
        { value: 'c', label: 'C' },
      ],
      new Set(['apimart']),
    )
    expect(kept.map((option) => option.value)).toEqual(['a'])
  })

  it('空集 = 一家都没接入，不是「随便放行」', () => {
    expect(keepRunnableVendorOptions([{ value: 'a', label: 'A', vendor: 'apimart' }], new Set())).toEqual([])
  })

  it('拔了 key 但 vendor 仍 enabled 的家，模型一行都不出现（选择器也拿不到）', async () => {
    mocks.listModels.mockResolvedValue([
      { ...row('with-key'), vendorKey: 'has-key' },
      { ...row('no-key'), vendorKey: 'lost-key' },
    ])
    mocks.listVendors.mockResolvedValue([
      { key: 'has-key', name: 'Has key', enabled: true, authType: 'bearer', hasApiKey: true },
      { key: 'lost-key', name: 'Lost key', enabled: true, authType: 'bearer', hasApiKey: false },
    ])

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 'with-key', vendor: 'has-key' }])
  })
})
