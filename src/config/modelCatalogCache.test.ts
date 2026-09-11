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

import { keepUsableModelRows, notifyModelOptionsRefresh, preloadModelOptions } from './modelCatalogCache'
import { derivePublishedExecution } from '../../electron/shared/modelPublication'
import type { ModelAvailability } from '../../electron/shared/modelAvailability'

const row = (modelKey: string, publishedModes: string[] = ['text_to_image'], meta?: unknown) => ({
  modelKey,
  vendorKey: 'relay',
  labelZh: modelKey,
  kind: 'image' as const,
  enabled: true,
  published: publishedModes.length > 0,
  publishedModes,
  // 主进程算好的那一个答案随行下发（`electron/shared/modelAvailability.ts`）。
  // 这些夹具模拟的是「已接入、钥匙在」的家，所以可用性跟着发布资格走。
  availability: publishedModes.length > 0
    ? { usable: true as const }
    : { usable: false as const, reason: 'model_unpublished' as const },
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

  it('keepUsableModelRows 只放行主进程判为可用的行（不可用的一律挡）', () => {
    const rows: Array<{ modelKey: string; availability: ModelAvailability }> = [
      { modelKey: 'a', availability: { usable: true } },
      { modelKey: 'b', availability: { usable: false, reason: 'credential_missing' } },
    ]
    const kept = keepUsableModelRows(rows)
    expect(kept.map((option) => option.modelKey)).toEqual(['a'])
  })

  it('没有 availability 的行 fail-closed（夹具/旧缓存没过主进程投影，不当作可用）', () => {
    const stale: Array<{ modelKey: string; availability?: { usable: boolean } }> = [{ modelKey: 'a' }]
    expect(keepUsableModelRows(stale)).toEqual([])
  })

  it('拔了 key 但 vendor 仍 enabled 的家，模型一行都不出现（选择器也拿不到）', async () => {
    // 主进程的可用性判据已经把它判成 credential_missing —— 渲染层不再自己看 hasApiKey，
    // 那正是 2026-09-12 P0-10 里三份判据之一（见 modelAvailabilityAgreement.test.ts）。
    mocks.listModels.mockResolvedValue([
      { ...row('with-key'), vendorKey: 'has-key' },
      { ...row('no-key'), vendorKey: 'lost-key', availability: { usable: false, reason: 'credential_missing' } },
    ])
    mocks.listVendors.mockResolvedValue([
      { key: 'has-key', name: 'Has key', enabled: true, authType: 'bearer', hasApiKey: true },
      { key: 'lost-key', name: 'Lost key', enabled: true, authType: 'bearer', hasApiKey: false },
    ])

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 'with-key', vendor: 'has-key' }])
  })
})

it('agent catalog capture includes reference-only models through the real publication and archetype projection', async () => {
  vi.clearAllMocks()
  notifyModelOptionsRefresh()
  mocks.listVendors.mockResolvedValue([{ key: 'relay', name: 'Relay', enabled: true, authType: 'none' }])
  mocks.listModels.mockImplementation(async ({ kind }: { kind: string }) => kind === 'video'
    ? [{ ...row('reference-video', ['image_to_video'], { archetypeId: 'vidu-q3' }), kind: 'video' }]
    : kind === 'image'
      ? [row('edit-only', ['image_edit'], { archetypeId: 'gpt-image-2' }), row('unpublished', [], { archetypeId: 'gpt-image-2' })]
      : [])
  const { listAvailableModelsForAgent } = await import('../workbench/generationCanvas/agent/availableModels')
  const entries = await listAvailableModelsForAgent()
  expect(entries.map((entry) => entry.modelKey).sort()).toEqual(['edit-only', 'reference-video'])
})
