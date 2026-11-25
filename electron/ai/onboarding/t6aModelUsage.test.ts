import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NomiEvent } from '../../events/types'
import { readModelSettingsAccount } from './vendorAccountBalance'
import { readModelUnitPrices, summarizeModelUsage, UNIT_PRICE_MODEL_KEYS } from './modelSettingsUsage'
import { publicPriceFor, publicPriceGap } from './vendorPricePreview'
import recorded from '../../../tests/fixtures/apimart/media-pricing-api.json'

import { buildWorld } from '../../../tests/world'
import * as secrets from '../../catalog/secrets'
import * as transport from '../../vendor/vendorBaseFallback'

vi.mock('../../catalog/secrets', async original => ({ ...await original<typeof secrets>(), decryptApiKeyRecord: vi.fn() }))
vi.mock('../../vendor/vendorBaseFallback', async original => ({ ...await original<typeof transport>(), fetchVendorWithBaseFallback: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

const now = Date.UTC(2026, 10, 24)
function run(id: string, age: number, cost: number | null, vendor = 'apimart', status = 'succeeded'): NomiEvent[] {
  const base = { v: 1 as const, id, ts: new Date(now - age * 86400000).toISOString(), source: 'runtime' as const, projectId: 'test' }
  return [{ ...base, seq: 1, type: 'vendor.call.requested', payload: { runId: id, recipe: { vendorKey: vendor, modelKey: 'image' } } },
    { ...base, seq: 2, type: 'vendor.call.completed', payload: { runId: id, status, cost: cost === null ? null : { amount: cost, unit: 'credits' } } }]
}
describe('local generation receipts', () => {
  it('separates account, time window and project identity, counts successful runs once, and preserves unknown credits', async () => {
    const first = run('same', 1, 3)
    const result = await summarizeModelUsage('apimart', [
      [...first, first[1], ...run('failed', 1, 10, 'apimart', 'failed'), ...run('outside', 31, 100), ...run('other', 1, 3, 'kie')],
      [...run('same', 7, 0), ...run('old', 30, null)],
    ], now)
    expect(result[7]).toEqual([{ modelKey: 'image', runs: 2, credits: 3 }])
    expect(result[30]).toEqual([{ modelKey: 'image', runs: 3, credits: null }])
  })
  it('starts today at local midnight, inside the rolling windows', async () => {
    const noon = new Date(2026, 10, 24, 12).getTime()
    const at = (id: string, hours: number) => run(id, hours / 24, 1).map(e => ({ ...e, ts: new Date(noon - hours * 3600000).toISOString() }))
    const result = await summarizeModelUsage('apimart', [[...at('morning', 2), ...at('last-night', 13), ...at('days-ago', 72)]], noon)
    expect(result.today).toEqual([{ modelKey: 'image', runs: 1, credits: 1 }])
    expect(result[7]).toEqual([{ modelKey: 'image', runs: 3, credits: 3 }])
  })
  it('quotes every reference row from the built-in catalog with its own recorded rate or the reason it has none', async () => {
    const world = buildWorld({ projects: [] })
    const restore = world.activate()
    try {
      const rows = await readModelUnitPrices('apimart', async query => {
        const detail = recorded.models[query.modelId as keyof typeof recorded.models]
        const quote = publicPriceFor(query, detail, query.kind === 'image' ? recorded.list : null, 'recorded')
        return { quote, gap: quote ? null : publicPriceGap(detail) }
      })
      // A key the catalog does not carry silently drops its row; every reference key must resolve.
      expect(rows.map(r => r.modelKey)).toEqual([...UNIT_PRICE_MODEL_KEYS])
      expect(rows.map(({ modelKey, credits, basis, gap }) => ({ modelKey, credits, basis, gap }))).toEqual([
        { modelKey: 'gpt-image-2.6-flare', credits: expect.closeTo(0.34776, 9), basis: 'output-estimate', gap: null },
        { modelKey: 'gpt-image-2', credits: expect.closeTo(0.085, 9), basis: null, gap: null },
        { modelKey: 'gemini-nano-banana-2.1', credits: null, basis: null, gap: 'token' },
        { modelKey: 'doubao-seedance-2.5', credits: null, basis: null, gap: 'tiered' },
      ])
    } finally { restore(); world.cleanup() }
  })
  it('makes no network request for other vendors', async () => {
    const request = vi.mocked(transport.fetchVendorWithBaseFallback).mockClear()
    expect(await readModelSettingsAccount('kie', true)).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})

describe('APIMart account snapshot', () => {
  it('shares reads, distinguishes zero and unlimited, and keeps stale credits only within one credential revision', async () => {
    const vendor = { key: 'apimart', name: 'APIMart', baseUrlHint: 'https://api.apimart.ai', enabled: true, authType: 'bearer' as const }
    const key = { vendorKey: vendor.key, apiKey: 'fixture-one', enc: 'safeStorage', enabled: true }
    const world = buildWorld({ encryptedApiKeys: { apimart: key }, projects: [] })
    const restore = world.activate()
    try {
      vi.mocked(secrets.decryptApiKeyRecord).mockReturnValue('sample-key-1234')
      let online = true
      const reads = vi.mocked(transport.fetchVendorWithBaseFallback).mockImplementation(async (url, init) => {
        expect(init?.method).toBe('GET')
        expect(init?.redirect).toBe('error')
        if (String(url).endsWith('/user/balance')) return online ? Response.json({ data: { remain_credits: 0 } }) : new Response(null, { status: 503 })
        return Response.json({ unlimited_quota: true })
      })
      const [first, same] = await Promise.all([readModelSettingsAccount('apimart', true), readModelSettingsAccount('apimart')])
      expect(reads).toHaveBeenCalledTimes(2)
      expect(first).toMatchObject({ accountCredits: 0, keySuffix: '1234', unlimited: true, accountStaleSince: null })
      expect(same).toEqual(first)
      online = false
      expect(await readModelSettingsAccount('apimart', true)).toMatchObject({ accountCredits: 0, accountStaleSince: first?.observedAt, unlimited: true })
      buildWorld({ rootDir: world.rootDir, projects: [], encryptedApiKeys: { apimart: { ...key, apiKey: 'fixture-two' } } })
      expect(await readModelSettingsAccount('apimart')).toMatchObject({ accountCredits: null, accountStaleSince: null })
      buildWorld({ rootDir: world.rootDir, projects: [], catalog: { vendors: [{ ...vendor, baseUrlHint: 'https://relay.invalid' }] } })
      expect(await readModelSettingsAccount('apimart', true)).toBeNull()
      expect(reads).toHaveBeenCalledTimes(6)
    } finally { restore(); world.cleanup() }
  })
})
