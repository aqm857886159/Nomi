import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NomiEvent } from '../../events/types'
import { readModelSettingsAccount } from './vendorAccountBalance'
import { summarizeModelUsage } from './modelSettingsUsage'

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
