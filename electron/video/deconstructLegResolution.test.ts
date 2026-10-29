import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { derivePublishedExecution } from '../shared/modelPublication'

// 转写腿解析的回归与类测试。
//  · 2026-09-17：大脑是 Moonshot 时报「没有可用的转写模型」——转写腿只在文本大脑那一家里找。
//  · 2026-10-19：转写腿按 **kind** 找（findExecutableModelAnyVendor("audio")），而 audio 里有配音 / 音乐 / 转写；
//    目录序第一个能用的 audio 行是 Suno / TTS 时，转写请求就发给了它。渲染层的转写 chip 按**模式**列，
//    两边各一个答案。现在两边读同一份投影（listModelCatalogModels）、同一条判据（rowServesMode）。
const runTask = vi.hoisted(() => vi.fn())
vi.mock('./detectShotCuts', () => ({
  detectShotCuts: vi.fn(async () => ({
    cuts: [{ seconds: 3, score: 0.9 }],
    coverage: { capped: false, totalCuts: 1, keptCuts: 1, coveredSeconds: 3, durationSeconds: 6 },
  })),
}))
vi.mock('../runtime', () => ({ runTask }))
vi.mock('./extractAudioTrack', () => ({ extractAudioTrack: vi.fn(async () => ({ hasAudio: true, url: 'nomi-local://asset/p/a.m4a' })) }))
vi.mock('./extractVideoFrame', () => ({
  resolveVideoLocalPath: vi.fn(async () => ({ filePath: 'x.mp4', cleanup: () => undefined })),
  extractVideoFrameToAsset: vi.fn(async () => ({ url: 'nomi-local://asset/p/frame.png' })),
}))
vi.mock('../export/mediaProbe', () => ({ probeMediaMetadata: vi.fn(async () => ({ durationSeconds: 6, hasAudio: true })) }))

type Row = { vendorKey: string; modelKey: string; kind: string; enabled: boolean }
type MappingRow = { vendorKey: string; modelKey: string; taskKind: string; enabled: boolean; create?: Record<string, unknown> }

// 形状照真实目录（2026-10-19 用户机器）：同一家 APIMart 的「声音」既配音又转写；Suno 只出音乐；
// ElevenLabs Scribe 是转写但这家没配钥匙；本机转写走 localEngine。
const catalog: { vendors: Array<{ key: string; enabled: boolean; authType: string }>; models: Row[]; mappings: MappingRow[]; apiKeysByVendor: Record<string, unknown> } = {
  vendors: [
    { key: 'moonshot', enabled: true, authType: 'bearer' },
    { key: 'kie', enabled: true, authType: 'bearer' },
    { key: 'apimart', enabled: true, authType: 'bearer' },
    { key: 'elevenlabs', enabled: true, authType: 'x-api-key' },
    { key: 'local-speech', enabled: true, authType: 'none' },
  ],
  models: [
    { vendorKey: 'moonshot', modelKey: 'kimi-k2', kind: 'text', enabled: true },
    { vendorKey: 'kie', modelKey: 'suno-v5.5', kind: 'audio', enabled: true },
    { vendorKey: 'apimart', modelKey: 'nomi-audio', kind: 'audio', enabled: true },
    { vendorKey: 'elevenlabs', modelKey: 'scribe_v2', kind: 'audio', enabled: true },
    { vendorKey: 'local-speech', modelKey: 'whisper-cpp-local', kind: 'audio', enabled: true },
  ],
  mappings: [
    { vendorKey: 'kie', modelKey: 'suno-v5.5', taskKind: 'text_to_audio', enabled: true },
    { vendorKey: 'apimart', modelKey: 'nomi-audio', taskKind: 'text_to_audio', enabled: true },
    { vendorKey: 'apimart', modelKey: 'nomi-audio', taskKind: 'transcribe', enabled: true },
    { vendorKey: 'elevenlabs', modelKey: 'scribe_v2', taskKind: 'transcribe', enabled: true },
    { vendorKey: 'local-speech', modelKey: 'whisper-cpp-local', taskKind: 'transcribe', enabled: true, create: { localEngine: { kind: 'whisper-cpp', tierParam: 'local_tier' } } },
  ],
  apiKeysByVendor: { moonshot: { enabled: true }, kie: { enabled: true }, apimart: { enabled: true } },
}
const usable = (model: Row) => {
  const vendor = catalog.vendors.find((item) => item.key === model.vendorKey)
  if (!vendor?.enabled || !model.enabled) return { usable: false, reason: 'model_disabled' }
  return vendor.authType === 'none' || catalog.apiKeysByVendor[model.vendorKey] ? { usable: true } : { usable: false, reason: 'credential_missing' }
}
const projection = (params?: { kind?: string; enabled?: boolean }) => catalog.models
  .filter((model) => (!params?.kind || model.kind === params.kind) && (params?.enabled === undefined || model.enabled === params.enabled))
  .map((model) => ({ ...model, ...derivePublishedExecution(model, { mappings: catalog.mappings }), availability: usable(model) }))

vi.mock('../catalog/catalogStore', () => ({
  readCatalog: () => catalog,
  listModelCatalogModels: (params?: { kind?: string; enabled?: boolean }) => projection(params),
  normalizeProviderKind: (value: string) => value,
  mutateCatalog: vi.fn(),
}))
vi.mock('../catalog/secrets', () => ({
  decryptApiKeyRecord: (record: unknown) => (record ? 'k' : ''),
  decryptCustomConfigWithLegacy: () => ({}),
  apiKeyDecryptStatus: (record: unknown) => (record ? 'ok' : 'missing'),
}))
vi.mock('../catalog/catalogModelAvailability', () => ({
  catalogModelAvailability: (_state: unknown, model: Row) => usable(model),
  createCatalogAvailability: () => ({ of: (model: Row) => usable(model) }),
}))
const preference = { orderedVendorKeys: [] as string[] }
vi.mock('../settings/vendorPreferenceSettings', () => ({ readVendorPreferenceSettings: () => preference }))

describe('转写腿的模型解析（按模式，不按 kind）', () => {
  beforeEach(() => { vi.resetModules(); preference.orderedVendorKeys = [] })
  afterEach(() => { vi.restoreAllMocks() })

  it('报告的那一例：偏好把只出音乐的 Suno 排第一，自动也绝不拿它转写', async () => {
    preference.orderedVendorKeys = ['kie', 'apimart']
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    expect(resolveTranscribeLeg()).toEqual({ ok: true, vendorKey: 'apimart', modelKey: 'nomi-audio' })
  })

  it('类：任何供应商顺序下，自动挑出来的都在转写候选里，且候选里没有一行不发布 transcribe', async () => {
    const { modeCandidates } = await import('../catalog/executableModel')
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    const vendors = catalog.vendors.map((vendor) => vendor.key)
    for (const first of vendors) {
      preference.orderedVendorKeys = [first, ...vendors.filter((key) => key !== first)]
      const candidates = modeCandidates('transcribe', preference.orderedVendorKeys)
      expect(candidates.every((row) => row.publishedModes.includes('transcribe') && row.availability.usable)).toBe(true)
      const leg = resolveTranscribeLeg()
      expect(leg.ok && candidates.some((row) => row.vendorKey === leg.vendorKey && row.modelKey === leg.modelKey)).toBe(true)
    }
    // 没钥匙的 Scribe 不在候选里（chip 也不列它）；只出音乐的 Suno 也不在。
    const keys = modeCandidates('transcribe').map((row) => `${row.vendorKey}/${row.modelKey}`)
    expect(keys).toEqual(['apimart/nomi-audio', 'local-speech/whisper-cpp-local'])
  })

  it('不绑在文本大脑那一家上（2026-09-17 回归）', async () => {
    preference.orderedVendorKeys = ['moonshot']
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    expect(resolveTranscribeLeg()).toMatchObject({ ok: true, vendorKey: 'apimart' })
  })

  it('点名一个不是转写模型的 → requested-unavailable 带原因，不悄悄换别家', async () => {
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    const leg = resolveTranscribeLeg({ vendorKey: 'kie', modelKey: 'suno-v5.5' })
    expect(leg).toMatchObject({ ok: false, reason: 'requested-unavailable', requested: { vendorKey: 'kie', modelKey: 'suno-v5.5' } })
    expect(leg.ok ? '' : 'detail' in leg ? leg.detail : '').toMatch(/does not serve transcribe/)
  })

  it('点名没配钥匙的 Scribe → requested-unavailable，原因是钥匙（不是「这台机器没有转写模型」）', async () => {
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    const leg = resolveTranscribeLeg({ vendorKey: 'elevenlabs', modelKey: 'scribe_v2' })
    expect(leg).toMatchObject({ ok: false, reason: 'requested-unavailable' })
    expect(leg.ok ? '' : 'detail' in leg ? leg.detail : '').toMatch(/API key missing: elevenlabs/)
  })

  it('「改用云端重试」排除本机引擎：只剩本机转写时返回 none，而不是又落回本地', async () => {
    preference.orderedVendorKeys = ['local-speech']
    const { resolveTranscribeLeg } = await import('./deconstructVideo')
    expect(resolveTranscribeLeg()).toMatchObject({ ok: true, vendorKey: 'local-speech' })
    expect(resolveTranscribeLeg('cloud')).toEqual({ ok: true, vendorKey: 'apimart', modelKey: 'nomi-audio' })
    const apimart = catalog.apiKeysByVendor.apimart
    delete catalog.apiKeysByVendor.apimart
    try {
      expect(resolveTranscribeLeg('cloud')).toEqual({ ok: false, reason: 'none' })
    } finally {
      catalog.apiKeysByVendor.apimart = apimart
    }
  })

  it('一个能转写的都没有 → none（不抛一句和大脑有关的话）', async () => {
    const saved = catalog.mappings
    catalog.mappings = saved.filter((mapping) => mapping.taskKind !== 'transcribe')
    try {
      const { resolveTranscribeLeg } = await import('./deconstructVideo')
      expect(resolveTranscribeLeg()).toEqual({ ok: false, reason: 'none' })
    } finally {
      catalog.mappings = saved
    }
  })
})

// 验收线 C1（2026-10-19）：点名的转写模型跑不了时，转写腿原来被静默丢掉——画面照拆、照花读图的钱，对白一列空。
// 读图腿同样情形是整次拒绝。两条腿现在同一条规矩：点名不可用 → 零报价、零付费调用、DeconstructError 带原因；
// 自动挑不到（none）→ 画面照拆，对白顶上一行说清。走编排本体 deconstructVideo，不只测解析函数。
describe('转写腿点名不可用：与读图腿同一条规矩（编排本体）', () => {
  beforeEach(() => {
    vi.resetModules()
    preference.orderedVendorKeys = []
    runTask.mockReset()
    runTask.mockImplementation(async ({ request }: { request: { kind: string } }) => (request.kind === 'transcribe'
      ? { raw: { text: '你好。', segments: [{ start: 0, end: 1, text: '你好。' }] } }
      : { raw: { choices: [{ message: { content: '{"shotSize":"特写","visual":"一只狗"}' } }] } }))
  })

  async function run(transcribe?: unknown) {
    const { deconstructVideo } = await import('./deconstructVideo')
    type Plan = import('./deconstructVideo').DeconstructSpendPlan
    const authorizeSpend = vi.fn(async (_plan: Plan) => 'grant-1' as string | null)
    const result = await deconstructVideo(
      { videoUrl: 'nomi-local://asset/p/v.mp4', projectId: 'p', framesPerShot: 1, vision: { vendorKey: 'moonshot', modelKey: 'kimi-k2' }, ...(transcribe ? { transcribe } : {}) } as never,
      { authorizeSpend, signal: new AbortController().signal },
    ).catch((error: unknown) => error as Error)
    return { result, authorizeSpend }
  }

  it.each([
    ['不是转写模型（只出音乐）', { vendorKey: 'kie', modelKey: 'suno-v5.5' }, /does not serve transcribe/],
    ['没配钥匙的 Scribe', { vendorKey: 'elevenlabs', modelKey: 'scribe_v2' }, /API key missing: elevenlabs/],
    ['目录里不存在', { vendorKey: 'apimart', modelKey: 'no-such-stt' }, /no-such-stt/],
  ])('%s → 整次拒绝：零报价、零付费调用、原因带模型名', async (_label, transcribe, detail) => {
    const { result, authorizeSpend } = await run(transcribe)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).name).toBe('DeconstructError')
    expect((result as Error).message).toContain((transcribe as { modelKey: string }).modelKey)
    expect((result as Error).message).toMatch(detail)
    expect(authorizeSpend).not.toHaveBeenCalled()
    expect(runTask).not.toHaveBeenCalled()
  })

  it('点名可用 → 报价卡与真实转写调用都是它', async () => {
    const { result, authorizeSpend } = await run({ vendorKey: 'local-speech', modelKey: 'whisper-cpp-local' })
    expect(authorizeSpend.mock.calls[0]?.[0].transcribe).toEqual({ vendorKey: 'local-speech', modelKey: 'whisper-cpp-local' })
    const transcribeCalls = runTask.mock.calls.filter(([call]) => call.request.kind === 'transcribe')
    expect(transcribeCalls.map(([call]) => [call.vendor, call.request.extras.modelKey])).toEqual([['local-speech', 'whisper-cpp-local']])
    expect((result as { shots: Array<{ dialogue: string }> }).shots[0].dialogue).toBe('你好。')
  })

  it('自动挑不到（none）→ 画面照拆、不报转写那一行，顶上一行说「没有可用的转写模型」', async () => {
    const saved = catalog.mappings
    catalog.mappings = saved.filter((mapping) => mapping.taskKind !== 'transcribe')
    try {
      const { result, authorizeSpend } = await run()
      expect(authorizeSpend.mock.calls[0]?.[0].transcribe).toBeNull()
      expect(runTask.mock.calls.every(([call]) => call.request.kind !== 'transcribe')).toBe(true)
      expect((result as { failureReason?: string }).failureReason).toMatch(/转写模型|transcription model/)
    } finally {
      catalog.mappings = saved
    }
  })
})

// 2026-09-17：转写语言写死 "zh"，英文用户的视频被按中文转写。改成随界面语言派生。
describe('转写语言随输入派生', () => {
  beforeEach(() => { vi.resetModules() })

  it('en 界面发 en，zh 界面发 zh —— 源码里不许再有写死的 language', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(new URL('./deconstructVideo.ts', import.meta.url), 'utf8')
    // 先剥注释：这条断言要盯的是**代码**，注释里引用旧写法（讲清为什么改）是正当的。
    const code = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/language:\s*['"]zh['"]/)
    expect(source).toContain('transcribeLanguage()')
    // 报价与调用看的是同一个值：spend plan 的那一行也带上它。
    expect(source).toContain('parameters: { language: transcribeLanguage() }')
  })
})
