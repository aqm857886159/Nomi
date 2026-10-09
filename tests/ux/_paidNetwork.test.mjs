// 付费走查的出网名单与「被挡即失败」：不真起 App，把 openPaidWalk 的接线、名单计算、被挡即失败各自钉住。
import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { blockedError, describeBlocked, paidWalkAllowlist, VENDOR_RESULT_DOMAINS } from './_paidNetwork.mjs'

const catalog = {
  vendors: [
    { key: 'apimart', baseUrlHint: 'https://api.apimart.ai' },
    { key: 'kie', baseUrlHint: 'https://api.kie.ai/v1' },
  ],
  mappings: [{ vendorKey: 'apimart', modelKey: 'm', submit: { url: 'https://upload.apimart.ai/x' } }],
}

describe('paidWalkAllowlist', () => {
  it('derives API origins from the catalog (never a hand-copied second list) plus the vendor result domains', () => {
    expect(paidWalkAllowlist(catalog, ['apimart'])).toEqual(['https://api.apimart.ai', 'https://upload.apimart.ai', ...VENDOR_RESULT_DOMAINS.apimart])
    expect(VENDOR_RESULT_DOMAINS.apimart).toContain('*.getapib.org')
    expect(paidWalkAllowlist(catalog, ['kie'])).toEqual(['https://api.kie.ai', 'https://tempfile.aiquickdraw.com'])
  })

  it('only opens the authorised vendors', () => {
    expect(paidWalkAllowlist(catalog, ['apimart']).join()).not.toContain('kie')
  })

  it('throws instead of silently under-configuring', () => {
    expect(() => paidWalkAllowlist(catalog, ['missing'])).toThrow('missing')
    expect(() => paidWalkAllowlist({ vendors: [{ key: 'x' }] }, ['x'])).toThrow('没有 API 地址')
  })
})

describe('blocked-request report', () => {
  const allow = paidWalkAllowlist(catalog, ['apimart'])
  it('names host and layer, and tells the vendor-itself case from an outside host', () => {
    expect(describeBlocked({ host: 'api.apimart.ai', via: 'chromium' }, allow)).toContain('授权供应商自己')
    expect(describeBlocked({ host: 'telemetry.invalid', via: 'product-guard' }, allow)).toMatch(/telemetry\.invalid.*产品自带测试网闸.*授权供应商之外/)
  })

  it('is null without a blocked line and an error with one', () => {
    expect(blockedError([{ kind: 'guard-loaded' }, { kind: 'redirected' }], allow)).toBeNull()
    expect(blockedError([{ kind: 'blocked', via: 'fetch', host: 'x.invalid' }], allow).message).toContain('x.invalid')
  })
})

describe('openPaidWalk wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.doUnmock('./agent-runtime-walk-support.mjs')
    vi.doUnmock('./_realProfile.mjs')
  })

  async function open() {
    const calls = { options: null, stopped: 0, finishedWith: undefined }
    vi.stubEnv('CI', '')
    vi.stubEnv('NOMI_SPEND_OK', '1')
    vi.doMock('./agent-runtime-walk-support.mjs', () => ({
      createRuntimeWalk: async (_name, options) => {
        calls.options = options
        return {
          report: {}, settingsDir: 's', userDataDir: 'u', fixture: { close: async () => {} },
          stopApp: async () => { calls.stopped += 1 },
          finish: async (error) => { calls.finishedWith = error },
        }
      },
    }))
    vi.doMock('./_realProfile.mjs', () => ({
      readRealCatalog: () => catalog, realNomiIsRunning: () => false, realProfileFingerprint: () => ({}),
      removeRealCredentials: () => true, seedRealModels: () => [{ vendorKey: 'apimart', modelKey: 'm', labelZh: 'm' }],
    }))
    const { openPaidWalk } = await import('./_paidRun.mjs')
    return { calls, paid: await openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'apimart', modelKey: 'm' }]) }
  }

  it('hands the guard its allowlist and a ledger path without the caller doing anything', async () => {
    const { calls, paid } = await open()
    const env = calls.options.env
    expect(env.NOMI_WALK_ALLOW_ORIGINS.split(',')).toEqual(expect.arrayContaining(['https://api.apimart.ai', '*.getapib.org']))
    expect(env.NOMI_WALK_NET_LOG).toBeTruthy()
    await paid.finish(undefined)
    expect(calls.finishedWith).toBeUndefined()
  })

  it('fails right away when the ledger records a block: app stopped, report error names the host and layer', async () => {
    const { calls, paid } = await open()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fs.appendFileSync(calls.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'blocked', via: 'product-guard', host: 'img.unlisted.invalid', url: 'https://img.unlisted.invalid/a' })}\n`)
    await vi.waitFor(() => expect(calls.stopped).toBe(1), { timeout: 3000 })
    await paid.finish(new Error('Target closed'))
    expect(calls.finishedWith.message).toMatch(/img\.unlisted\.invalid.*产品自带测试网闸/s)
  })

  it('still catches a block that lands after the last poll', async () => {
    const { calls, paid } = await open()
    fs.appendFileSync(calls.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'blocked', via: 'chromium', host: 'late.invalid' })}\n`)
    await paid.finish(undefined)
    expect(calls.finishedWith.message).toContain('late.invalid')
  })
})
