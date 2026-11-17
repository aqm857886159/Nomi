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

import { keepUsableModelRows, notifyModelOptionsRefresh, optionsAfterReadFailure, peekCatalogModelOptions, peekLastGoodModelOptions, preloadModelOptions } from './modelCatalogCache'
import { deriveModelCatalogStatus } from './modelCatalogStatus'
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

  it('storyboard queries retain reference-only models without admitting unavailable or unpublished rows', async () => {
    mocks.listModels.mockImplementation(async ({ kind }: { kind: string }) => kind === 'video'
      ? [
          { ...row('i2v-only', ['image_to_video'], { archetypeId: 'minimax-h3-apimart' }), kind: 'video' },
          { ...row('blocked', ['image_to_video']), kind: 'video', availability: { usable: false, reason: 'credential_missing' } },
          { ...row('unpublished', []), kind: 'video' },
        ]
      : [row('edit-only', ['image_edit'], { archetypeId: 'gpt-image-2' })])
    await expect(preloadModelOptions('video', 'any-published')).resolves.toMatchObject([{ value: 'i2v-only' }])
    await expect(preloadModelOptions('image', 'any-published')).resolves.toMatchObject([{ value: 'edit-only' }])
    await expect(preloadModelOptions('video')).resolves.toEqual([])
    await expect(preloadModelOptions('image')).resolves.toEqual([])
  })

  it('uses executable formats independently of verification masks through the real DTO-to-picker projection', async () => {
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

    await expect(preloadModelOptions('image')).resolves.toMatchObject([{ value: 'shared-image', vendor: 'source' }, { value: 'shared-image', vendor: 'survivor' }])
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
  expect(entries.map((entry) => entry.modelId).sort()).toEqual(['edit-only', 'reference-video'])
})

describe('a failed catalog read never throws away the last good list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyModelOptionsRefresh()
    mocks.listVendors.mockResolvedValue([{ key: 'relay', name: 'Relay', enabled: true, authType: 'none' }])
  })

  it('after a refresh and a failing models:list the live cache is empty but the last good list is still offered', async () => {
    mocks.listModels.mockResolvedValue([row('keeper')])
    const first = await preloadModelOptions('image')
    expect(first.map((option) => option.value)).toEqual(['keeper'])

    notifyModelOptionsRefresh()
    mocks.listModels.mockRejectedValue(new Error('models:list exploded'))
    await expect(preloadModelOptions('image')).rejects.toThrow('models:list exploded')

    expect(peekCatalogModelOptions('image')).toBeNull()
    expect(peekLastGoodModelOptions('image')?.map((option) => option.value)).toEqual(['keeper'])
    expect(optionsAfterReadFailure([], 'image').map((option) => option.value)).toEqual(['keeper'])
  })

  it('a failing vendors:list also leaves the last good list in place', async () => {
    mocks.listModels.mockResolvedValue([row('keeper-2')])
    await preloadModelOptions('image')
    notifyModelOptionsRefresh()
    mocks.listVendors.mockRejectedValue(new Error('vendors:list exploded'))
    await expect(preloadModelOptions('image')).rejects.toThrow('vendors:list exploded')
    expect(optionsAfterReadFailure([], 'image').map((option) => option.value)).toEqual(['keeper-2'])
  })

  it('a later good read replaces the kept list (the kept list is never newer than the last success)', async () => {
    mocks.listModels.mockResolvedValue([row('old')])
    await preloadModelOptions('image')
    notifyModelOptionsRefresh()
    mocks.listModels.mockResolvedValue([row('new')])
    await preloadModelOptions('image')
    expect(peekLastGoodModelOptions('image')?.map((option) => option.value)).toEqual(['new'])
  })

  it('a mode first served by the synchronous in-memory peek (no IPC) is also remembered: later read failure keeps it and says stale_kept', async () => {
    // 桶里的行 + 供应商名是读成功得来的；另一个模式第一次被同步 peek 在内存里筛出来，没走 getCatalogModelOptions。
    mocks.listModels.mockResolvedValue([row('both', ['text_to_image', 'image_edit'])])
    await preloadModelOptions('image') // 只问 text_to_image：把 image 桶的行和供应商名读进内存
    const editQueriesBefore = mocks.listModels.mock.calls.length
    const peeked = peekCatalogModelOptions('image', 'image_edit')
    expect(peeked?.map((option) => option.value)).toEqual(['both'])
    expect(mocks.listModels.mock.calls.length).toBe(editQueriesBefore) // 同步取，零 IO

    notifyModelOptionsRefresh()
    mocks.listModels.mockRejectedValue(new Error('models:list exploded'))
    const failure = await preloadModelOptions('image', 'image_edit').catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)

    expect(peekCatalogModelOptions('image', 'image_edit')).toBeNull()
    const kept = optionsAfterReadFailure([], 'image', 'image_edit')
    expect(kept.map((option) => option.value)).toEqual(['both'])
    const derived = deriveModelCatalogStatus({ kind: 'image', options: kept, health: null, error: failure as Error, loading: false })
    expect(derived.status).toBe('stale_kept')
    expect(derived.message).toContain('models:list exploded')
  })

  it('never read successfully + failing: nothing is invented, the empty state stays empty (the error carries the reason)', async () => {
    mocks.listModels.mockRejectedValue(new Error('models:list exploded'))
    await expect(preloadModelOptions('audio')).rejects.toThrow('models:list exploded')
    expect(peekLastGoodModelOptions('audio')).toBeNull()
    expect(optionsAfterReadFailure([], 'audio')).toEqual([])
  })
})

// 2026-10-19 拆解转写腿根因：「哪些模型能跑某个模式」原来有两个答案——这里（chip 的选项）按模式问，
// 主进程的转写腿按 kind 问（于是 Suno / TTS 也被拿去转写）。现在两边过同一条 `rowServesMode`；
// 这条钉住：同一份投影进来，下拉列出的就是主进程会挑的那一组，一行不多一行不少。
describe('模式级候选：下拉与主进程同一条判据', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyModelOptionsRefresh()
    mocks.listVendors.mockResolvedValue([{ key: 'relay', name: 'Relay', enabled: true, authType: 'none' }])
  })

  it('audio 桶里只有发布了 transcribe 且可用的行进转写下拉', async () => {
    const { rowServesMode } = await import('../../electron/shared/modelPublication')
    const audio = (modelKey: string, publishedModes: string[], usable = true) => ({
      ...row(modelKey, publishedModes), kind: 'audio' as const,
      availability: usable ? { usable: true as const } : { usable: false as const, reason: 'credential_missing' as const },
    })
    const rows = [
      audio('tts-and-stt', ['text_to_audio', 'transcribe']),
      audio('music-only', ['text_to_audio']),
      audio('stt-no-key', ['transcribe'], false),
      audio('stt-local', ['transcribe']),
    ]
    mocks.listModels.mockResolvedValue(rows)
    const listed = (await preloadModelOptions('audio', 'transcribe')).map((option) => option.value)
    expect(listed).toEqual(['tts-and-stt', 'stt-local'])
    expect(listed).toEqual(rows.filter((item) => rowServesMode(item, 'transcribe')).map((item) => item.modelKey))
  })
})


describe('old adapter diagnostics never hide a usable row', () => {
 it('uses the real canvas projection: a row whose last format run is unverified or failed stays selectable when availability says usable', async () => {
  notifyModelOptionsRefresh();
  mocks.listVendors.mockResolvedValue([{key: 'relay', name: 'Relay', enabled: true}]);
  mocks.listModels.mockResolvedValue([
   row('pending', ['text_to_image'], {adapter: {state: 'unverified'}}),
   row('failed', ['text_to_image'], {adapter: {state: 'failed'}})
  ]);
  expect((await preloadModelOptions('image', 'text_to_image')).map(item => item.value)).toEqual(['pending', 'failed']);
 });
});
