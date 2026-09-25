import { beforeEach, describe, expect, it, vi } from 'vitest'

const hardenedFetch = vi.fn(async () => ({ bytes: Buffer.from('media'), contentType: 'video/mp4', status: 200, finalUrl: 'https://cdn.example/v.mp4', truncated: false }))
vi.mock('../hardenedFetch', () => ({ hardenedFetch }))

const { fetchProviderMedia, PROVIDER_MEDIA_FETCH_TIMEOUT_MS } = await import('./providerMediaFetch')
const MEDIA_BYTE_CAP = 200 * 1024 * 1024
const { createGenerationOutputMaterializer } = await import('../capabilityCore/generationOutputMaterializer')

// 供应商产物取回只有一条线路策略（2026-09-25）。付费卡那条路以前自己调 hardenedFetch、只给 maxBytes：
// 超时落回通用缺省 20 秒、也不走供应商自己的线路——同一段 15 秒成片，普通生成落得下来，付费卡那条路
// 每一轮都下载超时、每一轮重来，节点永远停在「生成中」。

describe('fetchProviderMedia is the one retrieval policy for provider outputs', () => {
  beforeEach(() => hardenedFetch.mockClear())

  it('视频级的超时与上限，默认只收媒体类型', async () => {
    await fetchProviderMedia('https://cdn.example/v.mp4')
    expect(hardenedFetch).toHaveBeenCalledWith('https://cdn.example/v.mp4', expect.objectContaining({
      timeoutMs: PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
      maxBytes: MEDIA_BYTE_CAP,
      allowContentTypes: ['image/', 'video/', 'audio/', 'application/octet-stream'],
    }))
    expect(PROVIDER_MEDIA_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('另存到磁盘不按类型拦（any）；本地可信服务按精确 origin 放行', async () => {
    await fetchProviderMedia('https://cdn.example/a.bin', { allowContentTypes: 'any', trustedPrivateOrigin: 'http://127.0.0.1:9' })
    const options = (hardenedFetch.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(options).not.toHaveProperty('allowContentTypes')
    expect(options.allowedPrivateOrigins).toEqual(['http://127.0.0.1:9'])
  })

  it('付费卡那条路（生成产物物化）走的就是这一条：同一组超时 / 上限 / 这家供应商自己的线路', async () => {
    const writeAsset = vi.fn(() => ({ id: 'asset-1', data: { relativePath: 'assets/generated/materialized/v.mp4' } }))
    const materializer = createGenerationOutputMaterializer({ writeAsset, resolveProviderNetwork: (providerId) => (providerId === 'apimart' ? { proxyUrl: 'http://127.0.0.1:7890' } : undefined) })
    await materializer.materialize({ projectId: 'p', providerTaskId: 't', providerId: 'apimart', output: { kind: 'video', url: 'https://cdn.example/v.mp4' } })
    const options = (hardenedFetch.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(options).toMatchObject({ timeoutMs: PROVIDER_MEDIA_FETCH_TIMEOUT_MS, maxBytes: MEDIA_BYTE_CAP, allowContentTypes: ['video/', 'application/octet-stream'] })
    expect(options.dispatcher).toBeDefined()
  })
})
