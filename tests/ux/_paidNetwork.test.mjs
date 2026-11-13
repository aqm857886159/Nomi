// 付费走查的出网名单与「被挡即失败」：不真起 App，把 openPaidWalk 的接线、名单计算、被挡即失败各自钉住。
import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { assertExactOrigin, blockedError, describeBlocked, hostedUploadRelayOrigin, guardLoadedError, paidWalkAllowlist, VENDOR_RESULT_DOMAINS } from './_paidNetwork.mjs'

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

describe('hosted upload relay origin must be exactly one exact origin', () => {
  it('accepts scheme + host + optional port', () => {
    expect(assertExactOrigin('https://relay.example.test')).toBe('https://relay.example.test')
    expect(assertExactOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
  })
  it.each([
    ['comma', 'https://a.example,*.evil.test'],
    ['percent-encoded comma', 'https://a.example%2C.evil.test'],
    ['wildcard', 'https://*.evil.test'],
    ['whitespace', 'https://a.example .evil.test'],
  ])('rejects %s before any spend', (_name, origin) => {
    expect(() => assertExactOrigin(origin)).toThrow('不是一个精确源')
  })
  it('the injection through NOMI_ASSET_RELAY_URL never reaches the allowlist', () => {
    for (const url of ['https://a.example,*.evil.test/v1', 'https://a.example%2C*.evil.test/v1']) {
      expect(() => hostedUploadRelayOrigin({ NOMI_ASSET_RELAY_URL: url })).toThrow()
    }
  })
})

describe('blocked-request report', () => {
  const allow = paidWalkAllowlist(catalog, ['apimart'])
  it('names host and layer, and tells the vendor-itself case from an outside host', () => {
    expect(describeBlocked({ host: 'api.apimart.ai', via: 'chromium' }, allow)).toContain('授权供应商的主机')
    expect(describeBlocked({ host: 'telemetry.invalid', via: 'product-guard' }, allow)).toMatch(/telemetry\.invalid.*产品自带测试网闸.*授权供应商之外/)
  })

  it('classifies a blocked wildcard subdomain (or a wrong port) as the vendor own host, via the shared matcher', () => {
    expect(describeBlocked({ host: 'img.getapib.org', via: 'socket', url: 'tcp://img.getapib.org:8443' }, allow)).toContain('授权供应商的主机')
    expect(describeBlocked({ host: 'getapib.org.evil.test', via: 'fetch' }, allow)).toContain('授权供应商之外')
  })

  it('demands guard-loaded with the key layers in the ledger (a ledger that cannot be written must not pass silently)', () => {
    expect(guardLoadedError([])).toBeInstanceOf(Error)
    expect(guardLoadedError([{ kind: 'guard-loaded', layers: ['fetch', 'http'] }]).message).toContain('chromium')
    expect(guardLoadedError([{ kind: 'guard-loaded', layers: ['fetch', 'http', 'https', 'socket', 'chromium'] }])).toBeNull()
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
    vi.doUnmock('./_launchApp.mjs')
  })

  async function open(extraDeps = {}) {
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
    vi.doMock('./_launchApp.mjs', () => ({ decideSyntheticCredentialStorage: () => false }))
    vi.doMock('./_realProfile.mjs', () => ({
      readRealCatalog: () => catalog, realNomiIsRunning: () => false, realNomiProfile: () => ({}), realProfileFingerprint: () => ({}),
      removeRealCredentials: () => true, seedRealModels: () => [{ vendorKey: 'apimart', modelKey: 'm', labelZh: 'm' }],
    }))
    const { openPaidWalk } = await import('./_paidRun.mjs')
    return { calls, paid: await openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'apimart', modelKey: 'm' }], { assertBuild: () => {}, ...extraDeps }) }
  }

  it('hands the guard its allowlist and a ledger path without the caller doing anything', async () => {
    const { calls, paid } = await open()
    const env = calls.options.env
    expect(env.NOMI_WALK_ALLOW_ORIGINS.split(',')).toEqual(expect.arrayContaining(['https://api.apimart.ai', '*.getapib.org']))
    expect(env.NOMI_WALK_NET_LOG).toBeTruthy()
    await paid.finish(undefined)
    expect(calls.finishedWith).toBeUndefined()
  })

  it('hostedUploads is off by default: the relay origin is not allowed and the allowlist is exactly the vendor list', async () => {
    const { calls } = await open()
    const allow = calls.options.env.NOMI_WALK_ALLOW_ORIGINS.split(',')
    expect(allow).toEqual(paidWalkAllowlist(catalog, ['apimart']))
    expect(allow.join()).not.toContain('workers.dev')
  })

  it('hostedUploads on: allows exactly one more origin, the relay the app is configured with (default, or NOMI_ASSET_RELAY_URL)', async () => {
    const { DEFAULT_NOMI_ASSET_RELAY_URL } = await import('../../electron/catalog/assetRelayRuntimeConfig.ts')
    const vendorOnly = paidWalkAllowlist(catalog, ['apimart'])
    const withDefault = await open({ hostedUploads: true, env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', NOMI_ASSET_RELAY_URL: '' } })
    expect(withDefault.calls.options.env.NOMI_WALK_ALLOW_ORIGINS.split(',')).toEqual([...vendorOnly, new URL(DEFAULT_NOMI_ASSET_RELAY_URL).origin])
    expect(withDefault.paid.walk.report.hostedUploadRelayAllowed).toBe(new URL(DEFAULT_NOMI_ASSET_RELAY_URL).origin)
  })

  it('vendorNetwork:false keeps the vendor origins out of the allowlist (probe mode: even a mistaken submit is blocked by the net guard)', async () => {
    const { calls } = await open({ hostedUploads: true, vendorNetwork: false, env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', NOMI_ASSET_RELAY_URL: 'https://relay.example.test/v1/assets' } })
    expect(calls.options.env.NOMI_WALK_ALLOW_ORIGINS.split(',')).toEqual(['https://relay.example.test'])
  })

  it('hostedUploads on with NOMI_ASSET_RELAY_URL set: the one extra origin is that custom relay', async () => {
    const vendorOnly = paidWalkAllowlist(catalog, ['apimart'])
    const custom = await open({ hostedUploads: true, env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', NOMI_ASSET_RELAY_URL: 'https://relay.example.test:8443/v1/assets' } })
    expect(custom.calls.options.env.NOMI_WALK_ALLOW_ORIGINS.split(',')).toEqual([...vendorOnly, 'https://relay.example.test:8443'])
  })

  it('fails right away when the ledger records a block: app stopped, report error names the host and layer', async () => {
    const { calls, paid } = await open()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fs.appendFileSync(calls.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'blocked', via: 'product-guard', host: 'img.unlisted.invalid', url: 'https://img.unlisted.invalid/a' })}\n`)
    await vi.waitFor(() => expect(calls.stopped).toBe(1), { timeout: 3000 })
    await paid.finish(new Error('Target closed'))
    expect(calls.finishedWith.message).toMatch(/img\.unlisted\.invalid.*产品自带测试网闸/s)
  })

  it('refuses to spend when the guard never wrote guard-loaded to the ledger', async () => {
    const { calls, paid } = await open()
    await expect(paid.lockToAuthorizedModels({})).rejects.toThrow('guard-loaded')
    fs.appendFileSync(calls.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] })}
`)
    await expect(paid.lockToAuthorizedModels({ evaluate: async () => [] })).rejects.not.toThrow('guard-loaded')
    await paid.finish(undefined)
  })

  it('still catches a block that lands after the last poll', async () => {
    const { calls, paid } = await open()
    fs.appendFileSync(calls.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'blocked', via: 'chromium', host: 'late.invalid' })}\n`)
    await paid.finish(undefined)
    expect(calls.finishedWith.message).toContain('late.invalid')
  })
})
