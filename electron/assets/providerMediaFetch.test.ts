import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_MEDIA_BASE_TIMEOUT_MS,
  PROVIDER_MEDIA_BYTE_CAP,
  PROVIDER_MEDIA_IDLE_TIMEOUT_MS,
  PROVIDER_MEDIA_RETRIEVAL_MAX_MS,
  providerMediaRetrievalTotalMs,
} from '../shared/assets/providerMediaRetrievalBudget'

const hardenedFetch = vi.fn(async () => ({ bytes: Buffer.from('media'), contentType: 'video/mp4', status: 200, finalUrl: 'https://cdn.example/v.mp4', truncated: false }))
vi.mock('../hardenedFetch', () => ({ hardenedFetch }))

const { fetchProviderMedia } = await import('./providerMediaFetch')
const { createGenerationOutputMaterializer } = await import('../capabilityCore/generationOutputMaterializer')

// 供应商产物取回只有一条线路策略（2026-09-25）。付费卡那条路以前自己调 hardenedFetch、只给 maxBytes：
// 超时落回通用缺省 20 秒、也不走供应商自己的线路——同一段 15 秒成片，普通生成落得下来，付费卡那条路
// 每一轮都下载超时、每一轮重来，节点永远停在「生成中」。

/** 这一条策略的全部时间与大小参数——三条路（普通生成 / 另存 / 付费卡）都必须拿到同一组。 */
const RETRIEVAL_BUDGET = {
  timeoutMs: PROVIDER_MEDIA_RETRIEVAL_MAX_MS,
  idleTimeoutMs: PROVIDER_MEDIA_IDLE_TIMEOUT_MS,
  timeoutForDeclaredSize: providerMediaRetrievalTotalMs,
  maxBytes: PROVIDER_MEDIA_BYTE_CAP,
}

describe('fetchProviderMedia is the one retrieval policy for provider outputs', () => {
  beforeEach(() => hardenedFetch.mockClear())

  it('空闲时限 + 随大小放宽的总上限 + 字节上限，默认只收媒体类型', async () => {
    await fetchProviderMedia('https://cdn.example/v.mp4')
    expect(hardenedFetch).toHaveBeenCalledWith('https://cdn.example/v.mp4', expect.objectContaining({
      ...RETRIEVAL_BUDGET,
      allowContentTypes: ['image/', 'video/', 'audio/', 'application/octet-stream'],
    }))
  })

  it('另存到磁盘不按类型拦（any）；本地可信服务按精确 origin 放行', async () => {
    await fetchProviderMedia('https://cdn.example/a.bin', { allowContentTypes: 'any', trustedPrivateOrigin: 'http://127.0.0.1:9' })
    const options = (hardenedFetch.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(options).not.toHaveProperty('allowContentTypes')
    expect(options.allowedPrivateOrigins).toEqual(['http://127.0.0.1:9'])
    expect(options).toMatchObject(RETRIEVAL_BUDGET)
  })

  it('付费卡那条路（生成产物物化）走的就是这一条：同一组时限 / 上限 / 这家供应商自己的线路', async () => {
    const writeAsset = vi.fn(() => ({ id: 'asset-1', data: { relativePath: 'assets/generated/materialized/v.mp4' } }))
    const materializer = createGenerationOutputMaterializer({ writeAsset, resolveVendor: (providerId) => (providerId === 'apimart' ? { baseUrlHint: 'https://api.apimart.ai', network: { proxyUrl: 'http://127.0.0.1:7890' } } : undefined) })
    await materializer.materialize({ projectId: 'p', providerTaskId: 't', providerId: 'apimart', output: { kind: 'video', url: 'https://cdn.example/v.mp4' } })
    const options = (hardenedFetch.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(options).toMatchObject({ ...RETRIEVAL_BUDGET, allowContentTypes: ['video/', 'application/octet-stream'] })
    expect(options.dispatcher).toBeDefined()
    // #975 A：内置公网家不拿私网例外（拿了反而会关掉跟随跳转）。
    expect(options).not.toHaveProperty('allowedPrivateOrigins')
  })
})

// 2026-09-28：60 秒墙钟对所有文件一视同仁，慢线路上的大视频注定超时（「生成超时（可找回）」，重新拉取也一样）。
describe('取回预算：小文件照旧，大文件按最慢可接受的速度放宽，不知道多大按字节上限那一档', () => {
  it('小文件（图片、短视频）仍是原来的 60 秒量级——这次改动不改变它们的行为', () => {
    expect(providerMediaRetrievalTotalMs(2 * 1024 * 1024)).toBeLessThanOrEqual(PROVIDER_MEDIA_BASE_TIMEOUT_MS + 10_000)
    expect(providerMediaRetrievalTotalMs(0)).toBe(PROVIDER_MEDIA_BASE_TIMEOUT_MS)
  })

  it('总上限随声明大小单调放宽，最大就是字节上限那一档', () => {
    const sizes = [1, 10, 50, 150, 200].map((megabytes) => megabytes * 1024 * 1024)
    const budgets = sizes.map(providerMediaRetrievalTotalMs)
    expect([...budgets].sort((a, b) => a - b)).toEqual(budgets)
    expect(new Set(budgets).size).toBe(budgets.length)
    expect(budgets.at(-1)).toBe(PROVIDER_MEDIA_RETRIEVAL_MAX_MS)
    // 声明超过字节上限的会在读 body 之前被拒，这里不给比上限更长的时间。
    expect(providerMediaRetrievalTotalMs(PROVIDER_MEDIA_BYTE_CAP * 3)).toBe(PROVIDER_MEDIA_RETRIEVAL_MAX_MS)
  })

  it('没声明大小（分块传输）按字节上限那一档给，不在不知道多大时掐断一次合法的大文件', () => {
    expect(providerMediaRetrievalTotalMs(null)).toBe(PROVIDER_MEDIA_RETRIEVAL_MAX_MS)
    expect(PROVIDER_MEDIA_RETRIEVAL_MAX_MS).toBeGreaterThan(PROVIDER_MEDIA_BASE_TIMEOUT_MS)
  })

  it('空闲时限比总上限的底短：线路断了先由它拦住，而不是陪到总上限', () => {
    expect(PROVIDER_MEDIA_IDLE_TIMEOUT_MS).toBeLessThan(PROVIDER_MEDIA_BASE_TIMEOUT_MS)
  })
})
