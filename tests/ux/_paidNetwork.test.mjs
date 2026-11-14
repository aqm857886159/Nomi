// 付费走查的出网名单与「被挡即失败」：不真起 App，把 openPaidWalk 的接线、名单计算、被挡即失败各自钉住。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'

import { assertExactOrigin, blockedError, blockedRequestOf, describeBlocked, hostedUploadRelayOrigin, guardLoadedError, paidWalkAllowlist, rehearsalLedgerRequests, rehearsalShouldStop, rehearsalStation, rehearsalVerdict, standInLaunchEnv, startRehearsalStandIn, stationReaches, VENDOR_RESULT_DOMAINS } from './_paidNetwork.mjs'

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
    return { calls, paid: await openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'apimart', modelKey: 'm' }], { assertBuild: () => {}, assertRehearsed: () => {}, ...extraDeps }) }
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

// 演练判据（2026-11-15）：放行名单是空的，判的是「挡下的第一条是不是授权供应商、在不在收窄花钱面之后」。宁可错判不过。
describe('rehearsalVerdict', () => {
  const judgedAllow = ['https://api.apimart.ai', '*.getapib.org']
  const loaded = { kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] }
  const vendorPost = { kind: 'blocked', via: 'chromium', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations?sig=[REDACTED]' }
  const elsewhere = { kind: 'blocked', via: 'fetch', host: 'telemetry.example.test', url: 'https://telemetry.example.test/e' }

  it('passes when the first blocked request is the authorized vendor after the spend lock, and records method + path without the query', () => {
    const verdict = rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow })
    expect(verdict.passed).toBe(true)
    expect(verdict.request).toEqual({ via: 'chromium', method: 'POST', host: 'api.apimart.ai', path: '/v1/videos/generations' })
    expect(JSON.stringify(verdict)).not.toContain('sig=')
  })
  it('a script error after the guard stopped the app is the expected consequence, still a pass', () => {
    expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('Target closed'), stoppedByGuard: true }).passed).toBe(true)
  })
  it('R5 · a blocked request to some other origin is not a pass, even when a vendor request follows', () => {
    const verdict = rehearsalVerdict({ entries: [loaded, elsewhere, vendorPost], lockedAtEntry: 1, judgedAllow })
    expect(verdict.passed).toBe(false)
    expect(verdict.reason).toContain('授权供应商之外的源 telemetry.example.test')
  })
  it('R6 · a vendor request blocked before the spend lock (balance / verification after saving the key) is never the pass by itself', () => {
    expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: null, judgedAllow }).reason).toContain('没走到收窄花钱面')
    expect(rehearsalVerdict({ entries: [loaded, vendorPost, loaded], lockedAtEntry: 3, judgedAllow }).passed).toBe(false)
  })
  it('vendor blocks before the lock are recorded, and the first vendor block after the lock is the pass', () => {
    const balance = { kind: 'blocked', via: 'product-guard', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/balance' }
    const verdict = rehearsalVerdict({ entries: [loaded, balance, loaded, vendorPost], lockedAtEntry: 3, judgedAllow })
    expect(verdict).toMatchObject({ passed: true, request: { path: '/v1/videos/generations' }, preLock: [{ path: '/v1/balance' }] })
  })
  it('rehearsalShouldStop: keeps the app running through vendor blocks before the lock; stops at the first block after it, or at any other origin', () => {
    const balance = { kind: 'blocked', via: 'product-guard', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/balance' }
    expect(rehearsalShouldStop([loaded, balance], { lockedAtEntry: null, judgedAllow })).toBe(false)
    expect(rehearsalShouldStop([loaded, balance], { lockedAtEntry: 2, judgedAllow })).toBe(false)
    expect(rehearsalShouldStop([loaded, balance, vendorPost], { lockedAtEntry: 2, judgedAllow })).toBe(true)
    expect(rehearsalShouldStop([loaded, elsewhere], { lockedAtEntry: null, judgedAllow })).toBe(true)
  })
  it('stand-in vendor (no-key tier): answers only the declared free probe and upload, records every other request with method + path + scrubbed body, never logs headers', async () => {
    const dir = makeTempDir('nomi-stand-in-')
    const netLog = path.join(dir, 'net.jsonl')
    fs.writeFileSync(netLog, `${JSON.stringify(loaded)}\n`)
    const keyShaped = ['sk', 'abcdefghijklmnopqrstuvwxyz0123'].join('-') // 拼出来的假串：只为验它被打码
    const standIn = await startRehearsalStandIn({ origin: 'https://api.apimart.ai', netLog, freeAnswers: { 'GET /v1/balance': { remain_balance: 0 } }, uploadAnswers: { 'POST /v1/uploads/images': 'url' } })
    try {
      expect(standInLaunchEnv([standIn])).toEqual({ NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: standIn.origin }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: standIn.origin })
      const balance = await fetch(`${standIn.origin}/v1/balance?x=1`, { headers: { authorization: 'Bearer secret-header-value' } })
      expect(balance.status).toBe(200)
      expect(await balance.json()).toEqual({ remain_balance: 0 })
      const lockedAtEntry = fs.readFileSync(netLog, 'utf8').trim().split('\n').length
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(5)]), 'ref.png')
      const upload = await fetch(`${standIn.origin}/v1/uploads/images`, { method: 'POST', body: form })
      expect((await upload.json()).url).toMatch(new RegExp(`^${standIn.origin}/rehearsal-asset/1$`))
      const post = await fetch(`${standIn.origin}/v1/videos/generations?sig=abc`, { method: 'POST', headers: { authorization: 'Bearer secret-header-value', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'kling', aspect_ratio: '16:9', token: keyShaped }) })
      expect(post.status).toBe(400)
      const entries = fs.readFileSync(netLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      expect(entries.map((entry) => entry.kind)).toEqual(['guard-loaded', 'rehearsal-answered', 'rehearsal-answered', 'blocked'])
      expect(fs.readFileSync(netLog, 'utf8')).not.toMatch(/secret-header-value|sig=abc/)
      expect(fs.readFileSync(netLog, 'utf8')).not.toContain(keyShaped)
      const [request] = rehearsalLedgerRequests(entries)
      expect(request).toMatchObject({ kind: 'allowed-request', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' })
      expect(Object.keys(JSON.parse(request.body.text)).sort()).toEqual(['aspect_ratio', 'model', 'token'])
      const verdict = rehearsalVerdict({ entries, lockedAtEntry, judgedAllow, stoppedByGuard: true })
      expect(verdict).toMatchObject({ passed: true, station: 'vendor-create', request: { via: 'rehearsal-vendor', method: 'POST', host: 'api.apimart.ai', path: '/v1/videos/generations' }, preLock: [] })
    } finally {
      await standIn.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('R9 · the relay stand-in answers the upload itself and never forwards: the real origin it stands in for gets zero requests', async () => {
    const dir = makeTempDir('nomi-stand-in-relay-')
    const netLog = path.join(dir, 'net.jsonl')
    fs.writeFileSync(netLog, `${JSON.stringify(loaded)}\n`)
    const { default: http } = await import('node:http')
    let realHits = 0
    const real = http.createServer((req, res) => { realHits += 1; res.end('{}') })
    await new Promise((resolve) => real.listen(0, '127.0.0.1', resolve))
    const realOrigin = `http://127.0.0.1:${real.address().port}`
    const relay = await startRehearsalStandIn({ origin: realOrigin, netLog, role: 'relay', uploadAnswers: { 'POST /v1/assets': 'url' } })
    try {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(3)]), 'source.mp4')
      expect((await (await fetch(`${relay.origin}/v1/assets`, { method: 'POST', body: form })).json()).url).toContain(`${relay.origin}/rehearsal-asset/`)
      expect((await fetch(`${relay.origin}/v1/other`, { method: 'POST', body: 'x' })).status).toBe(400)
      expect(realHits).toBe(0)
      const entries = fs.readFileSync(netLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      expect(entries.slice(1).map((entry) => [entry.kind, entry.role, entry.via])).toEqual([['rehearsal-answered', 'relay', 'rehearsal-relay'], ['blocked', 'relay', 'rehearsal-relay']])
      expect(rehearsalLedgerRequests(entries)).toEqual([]) // 中转那条不是供应商请求：脚本的请求体判据读不到它
    } finally {
      await relay.close()
      await new Promise((resolve) => real.close(resolve))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('stations: before-click < upload-relay < vendor-read < vendor-create; only reaching upload is not a pass for a script whose end is the create request', () => {
    const relayAllow = ['https://nomi-asset-relay.example.workers.dev']
    const uploaded = { kind: 'rehearsal-answered', answer: 'upload', via: 'rehearsal-relay', role: 'relay', host: 'nomi-asset-relay.example.workers.dev' }
    const create = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }
    const list = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'GET', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/models' }
    expect(rehearsalStation([loaded], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('before-click')
    expect(rehearsalStation([loaded, uploaded], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('upload-relay')
    expect(rehearsalStation([loaded, uploaded, list], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('vendor-read')
    expect(rehearsalStation([loaded, uploaded, list, create], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('vendor-create')
    const onlyUpload = rehearsalVerdict({ entries: [loaded, uploaded], lockedAtEntry: 1, judgedAllow, relayAllow, stoppedByGuard: true })
    expect(onlyUpload).toMatchObject({ passed: false, station: 'upload-relay' })
    expect(onlyUpload.reason).toContain('只走到了「upload-relay」')
    expect(rehearsalVerdict({ entries: [loaded, list], lockedAtEntry: 1, judgedAllow, stoppedByGuard: true }).passed).toBe(false)
    expect(rehearsalVerdict({ entries: [loaded, list], lockedAtEntry: 1, judgedAllow, stoppedByGuard: true, endsAt: 'vendor-read' }).passed).toBe(true)
    expect(stationReaches('vendor-create', 'vendor-read')).toBe(true)
    expect(stationReaches(undefined, 'vendor-create')).toBe(false)
  })
  it('a body check the script runs after the stand-in recorded the create request fails the rehearsal and names the key', () => {
    const create = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }
    const verdict = rehearsalVerdict({ entries: [loaded, create], lockedAtEntry: 1, judgedAllow, scriptError: new Error('请求体判据没过：aspect_ratio 是 "1:1"，这一发要 16:9') })
    expect(verdict).toMatchObject({ passed: false, station: 'vendor-create' })
    expect(verdict.reason).toContain('aspect_ratio')
  })
  it('rehearsalShouldStop: scripts that judge the body keep the app until they finish (bounded by the grace period); other scripts stop at the create request', () => {
    const at = '2026-11-15T00:00:00.000Z'
    const create = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations', at }
    const list = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'GET', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/models', at }
    const now = Date.parse(at) + 1000
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, now })).toBe(true)
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, holdForScript: true, now })).toBe(false)
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, holdForScript: true, now: now + 30_000 })).toBe(true)
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, now })).toBe(false)
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, now: now + 30_000 })).toBe(true)
    // 只读脚本声明了终点 vendor-read：第一条读请求就是终点，立刻停（不等兜底、不让脚本拿着 503 自己报错）
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, endsAt: 'vendor-read', now })).toBe(true)
  })
  it('the script failing before any vendor request is not a pass, and says where it failed', () => {
    const verdict = rehearsalVerdict({ entries: [loaded], lockedAtEntry: 1, judgedAllow, scriptError: new Error('找不到生成钮\nstack') })
    expect(verdict).toMatchObject({ passed: false, request: null })
    expect(verdict.reason).toContain('之前就失败——找不到生成钮')
    expect(verdict.reason).not.toContain('stack')
  })
  it('a script error the guard did not cause (no stop yet) is not a pass even if a vendor block shows up afterwards', () => {
    expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('own bug'), stoppedByGuard: false }).passed).toBe(false)
  })
  it('a run that never sent anything to the vendor is not a pass', () => {
    expect(rehearsalVerdict({ entries: [loaded], lockedAtEntry: 1, judgedAllow }).reason).toContain('也没有向供应商发出请求')
  })
  it('the connection layer has no path; result-download wildcard hosts count as the vendor', () => {
    expect(blockedRequestOf({ via: 'socket', host: 'api.apimart.ai', url: 'tcp://api.apimart.ai:443' })).toEqual({ via: 'socket', method: null, host: 'api.apimart.ai', path: null })
    // fetch 层不记方法：只能算「读」——终点是创建请求的脚本靠它判不了过（宁低不高）
    const cdn = [{ kind: 'blocked', via: 'fetch', host: 'cdn.getapib.org', url: 'https://cdn.getapib.org/a.mp4' }]
    expect(rehearsalVerdict({ entries: cdn, lockedAtEntry: 0, judgedAllow, endsAt: 'vendor-read' }).passed).toBe(true)
    expect(rehearsalVerdict({ entries: cdn, lockedAtEntry: 0, judgedAllow }).passed).toBe(false)
  })
})
