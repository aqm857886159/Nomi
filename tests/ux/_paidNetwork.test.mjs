// 付费走查的出网名单与「被挡即失败」：不真起 App，把 openPaidWalk 的接线、名单计算、被挡即失败各自钉住。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'

import { PAID_UNVERIFIED_EXIT_CODE, assertExactOrigin, blockedError, blockedRequestOf, classifyAllowedVendorResponse, describeBlocked, hostedUploadRelayOrigin, guardLoadedError, paidRunVerdict, paidWalkAllowlist, rehearsalLedgerRequests, rehearsalShotsReached, rehearsalShouldStop, rehearsalStation, rehearsalVerdict, scriptErrorText, standInLaunchEnv, startRehearsalStandIn, stationReaches, VENDOR_RESULT_DOMAINS, vendorRowClass } from './_paidNetwork.mjs'

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
    return { calls, paid: await openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'apimart', modelKey: 'm' }], { assertBuild: () => {}, remindRehearsal: () => {}, ...extraDeps }) }
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
  it('a script error after the guard / stand-in stopped the app at the endpoint is the expected consequence, still a pass', () => {
    for (const stoppedBy of ['endpoint', 'guard-block']) expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('Target closed'), stoppedBy }).passed).toBe(true)
  })
  it('真问题 1 · the grace timeout is never a pass, and the script error that follows it is counted, not swallowed', () => {
    const verdict = rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('请求体判据没过：omni_reference_task_type\n    at x (y.mjs:1:1)'), stoppedBy: 'idle' })
    expect(verdict).toMatchObject({ passed: false, status: 'failed', stoppedBy: 'idle', scriptErrorCounted: true })
    expect(verdict.reason).toMatch(/兜底超时[\s\S]*omni_reference_task_type/)
    expect(verdict.reason).not.toContain('y.mjs')
  })
  it('真问题 1 · a script that holds the app (judges the body itself) has its error counted even when the stop was the endpoint', () => {
    expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('判据没过'), stoppedBy: 'endpoint', hold: true }).passed).toBe(false)
  })
  it('真问题 2 · N shots declared: passes only when the endpoint class shows up N times after the lock; the reason says N 发里走到 M 发', () => {
    const create = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }
    const balance = { kind: 'rehearsal-answered', via: 'rehearsal-vendor', role: 'vendor', method: 'GET', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/balance' }
    const two = rehearsalVerdict({ entries: [loaded, create, balance, create], lockedAtEntry: 1, judgedAllow, hold: true, shots: 4 })
    expect(two).toMatchObject({ passed: false, shots: { declared: 4, reached: 2 } })
    expect(two.reason).toContain('4 发里只走到 2 发')
    expect(rehearsalVerdict({ entries: [loaded, create, create, create, create], lockedAtEntry: 1, judgedAllow, hold: true, shots: 4 })).toMatchObject({ passed: true, shots: { declared: 4, reached: 4 } })
    // 收窄之前的创建行不数
    expect(rehearsalShotsReached([loaded, create, loaded, create], { lockedAtEntry: 3, vendorAllow: judgedAllow })).toBe(1)
  })
  it('真问题 3 · a script whose end is the create request but that only reached the brain (chat/completions) is its own status, never a pass', () => {
    const brain = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/chat/completions' }
    const verdict = rehearsalVerdict({ entries: [loaded, brain], lockedAtEntry: 1, judgedAllow, scriptError: new Error('Target closed'), stoppedBy: 'brain' })
    expect(verdict).toMatchObject({ passed: false, status: 'brain-only', station: 'brain' })
    expect(rehearsalShouldStop([loaded, brain], { lockedAtEntry: 1, judgedAllow, now: Date.now() })).toBe('brain')
    // 声明终点就是大脑的脚本：走到大脑 = 过
    expect(rehearsalVerdict({ entries: [loaded, brain], lockedAtEntry: 1, judgedAllow, stoppedBy: 'endpoint', endsAt: 'brain' })).toMatchObject({ passed: true, status: 'passed' })
    expect(rehearsalShouldStop([loaded, brain], { lockedAtEntry: 1, judgedAllow, endsAt: 'brain', now: Date.now() })).toBe('endpoint')
    // 大脑之后又走到了创建请求：按创建算
    const create = { ...brain, url: 'https://api.apimart.ai/v1/videos/generations' }
    expect(rehearsalVerdict({ entries: [loaded, brain, create], lockedAtEntry: 1, judgedAllow, stoppedBy: 'endpoint' })).toMatchObject({ passed: true, station: 'vendor-create' })
  })
  it('真问题 4 · real-key tier: a main-process request the product guard / fetch layer blocked without a method is classified by its path', () => {
    const mainCreate = { kind: 'blocked', via: 'product-guard', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }
    const mainChat = { kind: 'blocked', via: 'fetch', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/chat/completions' }
    const mainTask = { kind: 'blocked', via: 'product-guard', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/tasks/task-1' }
    expect(vendorRowClass(mainCreate)).toEqual({ station: 'vendor-create', methodInferred: true })
    expect(vendorRowClass(mainChat)).toEqual({ station: 'brain', methodInferred: true })
    expect(vendorRowClass(mainTask)).toEqual({ station: 'vendor-read', methodInferred: true })
    expect(vendorRowClass({ kind: 'blocked', via: 'socket', host: 'api.apimart.ai', url: 'tcp://api.apimart.ai:443' }).station).toBe('vendor-read')
    expect(vendorRowClass({ kind: 'blocked', via: 'fetch', host: 'cdn.getapib.org', url: 'https://cdn.getapib.org/x/result' }).station).toBe('vendor-read')
    expect(vendorRowClass({ kind: 'blocked', via: 'chromium', method: 'GET', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }).station).toBe('vendor-read')
    expect(vendorRowClass({ kind: 'blocked', via: 'fetch', host: 'api.apimart.ai', url: 'https://api.apimart.ai/api/pricing/model?model=gpt-image-2' }).station).toBe('vendor-read')
    expect(vendorRowClass({ kind: 'blocked', via: 'fetch', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/user/balance' }).station).toBe('vendor-read')
    const verdict = rehearsalVerdict({ entries: [loaded, mainCreate], lockedAtEntry: 1, judgedAllow, stoppedBy: 'guard-block' })
    expect(verdict).toMatchObject({ passed: true, station: 'vendor-create' })
    expect(verdict.reason).toContain('方法没记、按路径推')
    expect(rehearsalShouldStop([loaded, mainCreate], { lockedAtEntry: 1, judgedAllow, now: Date.now() })).toBe('guard-block')
  })
  it('scriptErrorText: one line, no stack frames, every line of the message kept (not just the first)', () => {
    const error = new Error('花钱前核对没过（一分钱没花）：\n- aspect_ratio 是 1:1\n- duration 是 5')
    error.stack = `${error.message}\n    at run (x.mjs:1:1)`
    expect(scriptErrorText(error)).toBe('花钱前核对没过（一分钱没花）： ⏎ - aspect_ratio 是 1:1 ⏎ - duration 是 5')
    expect(scriptErrorText(null)).toBe(null)
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
  it('rehearsalShouldStop: keeps the app running through vendor blocks before the lock and vendor-read blocks after the lock (real-key reopen balance/pricing reads); stops at endpoint block or foreign origin', () => {
    const balance = { kind: 'blocked', via: 'product-guard', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/user/balance' }
    const pricing = { kind: 'blocked', via: 'fetch', host: 'api.apimart.ai', url: 'https://api.apimart.ai/api/pricing/model?model=gpt-image-2' }
    expect(rehearsalShouldStop([loaded, balance], { lockedAtEntry: null, judgedAllow })).toBe(null)
    // real-key reopen 后后台发出的余额 / 询价只读请求在 lockedAtEntry 之后被闸挡下时，不能提前杀掉正在点项目卡的 App
    expect(rehearsalShouldStop([loaded, balance, pricing], { lockedAtEntry: 1, judgedAllow, endsAt: 'vendor-create', now: Date.now() })).toBe(null)
    expect(rehearsalShouldStop([loaded, balance], { lockedAtEntry: 1, judgedAllow, endsAt: 'vendor-read', now: Date.now() })).toBe('guard-block')
    expect(rehearsalShouldStop([loaded, balance, vendorPost], { lockedAtEntry: 1, judgedAllow, endsAt: 'vendor-create', now: Date.now() })).toBe('guard-block')
    // holdForScript（验请求体的演练）下，非替身闸挡下的 vendor-create 同样必须立即报 guard-block 关窗判红，不许被后续替身请求盖掉
    const standInPost = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/images/generations' }
    expect(rehearsalShouldStop([loaded, vendorPost], { lockedAtEntry: 1, judgedAllow, holdForScript: true, endsAt: 'vendor-create', now: Date.now() })).toBe('guard-block')
    expect(rehearsalVerdict({ entries: [loaded, vendorPost, standInPost], lockedAtEntry: 1, judgedAllow, hold: true, stoppedBy: 'guard-block' }).passed).toBe(false)
    expect(rehearsalShouldStop([loaded, elsewhere], { lockedAtEntry: null, judgedAllow })).toBe('foreign')
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
      const verdict = rehearsalVerdict({ entries, lockedAtEntry, judgedAllow, stoppedBy: 'endpoint' })
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
  it('stations: before-click < upload-relay < vendor-read < brain < vendor-create; only reaching upload is not a pass for a script whose end is the create request', () => {
    const relayAllow = ['https://nomi-asset-relay.example.workers.dev']
    const uploaded = { kind: 'rehearsal-answered', answer: 'upload', via: 'rehearsal-relay', role: 'relay', host: 'nomi-asset-relay.example.workers.dev' }
    const create = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' }
    const list = { kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'GET', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/models' }
    expect(rehearsalStation([loaded], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('before-click')
    expect(rehearsalStation([loaded, uploaded], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('upload-relay')
    expect(rehearsalStation([loaded, uploaded, list], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('vendor-read')
    expect(rehearsalStation([loaded, uploaded, list, create], { lockedAtEntry: 1, vendorAllow: judgedAllow, relayAllow })).toBe('vendor-create')
    const onlyUpload = rehearsalVerdict({ entries: [loaded, uploaded], lockedAtEntry: 1, judgedAllow, relayAllow, stoppedBy: 'endpoint' })
    expect(onlyUpload).toMatchObject({ passed: false, station: 'upload-relay' })
    expect(onlyUpload.reason).toContain('只走到了「upload-relay」')
    expect(rehearsalVerdict({ entries: [loaded, list], lockedAtEntry: 1, judgedAllow, stoppedBy: 'endpoint' }).passed).toBe(false)
    expect(rehearsalVerdict({ entries: [loaded, list], lockedAtEntry: 1, judgedAllow, stoppedBy: 'endpoint', endsAt: 'vendor-read' }).passed).toBe(true)
    expect(stationReaches('vendor-create', 'vendor-read')).toBe(true)
    expect(stationReaches('brain', 'vendor-create')).toBe(false)
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
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, now })).toBe('endpoint')
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, holdForScript: true, now })).toBe(null)
    expect(rehearsalShouldStop([loaded, create], { lockedAtEntry: 1, judgedAllow, holdForScript: true, now: now + 30_000 })).toBe('idle')
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, now })).toBe(null)
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, now: now + 30_000 })).toBe('idle')
    // 只读脚本声明了终点 vendor-read：第一条读请求就是终点，立刻停（不等兜底、不让脚本拿着 503 自己报错）
    expect(rehearsalShouldStop([loaded, list], { lockedAtEntry: 1, judgedAllow, endsAt: 'vendor-read', now })).toBe('endpoint')
  })
  it('the script failing before any vendor request is not a pass, and says where it failed', () => {
    const verdict = rehearsalVerdict({ entries: [loaded], lockedAtEntry: 1, judgedAllow, scriptError: new Error('找不到生成钮\n    at reach (tests/ux/x.mjs:3:9)') })
    expect(verdict).toMatchObject({ passed: false, request: null })
    expect(verdict.reason).toContain('之前就失败——找不到生成钮')
    expect(verdict.reason).not.toContain('x.mjs')
  })
  it('a script error the guard did not cause (no stop yet) is not a pass even if a vendor block shows up afterwards', () => {
    expect(rehearsalVerdict({ entries: [loaded, vendorPost], lockedAtEntry: 1, judgedAllow, scriptError: new Error('own bug'), stoppedBy: null }).passed).toBe(false)
  })
  it('a run that never sent anything to the vendor is not a pass', () => {
    expect(rehearsalVerdict({ entries: [loaded], lockedAtEntry: 1, judgedAllow }).reason).toContain('也没有向供应商发出请求')
  })
  it('the connection layer has no path; result-download wildcard hosts count as the vendor', () => {
    expect(blockedRequestOf({ via: 'socket', host: 'api.apimart.ai', url: 'tcp://api.apimart.ai:443' })).toEqual({ via: 'socket', method: null, host: 'api.apimart.ai', path: null })
    // fetch 层不记方法：成片下载（成片下载域 / 路径是个文件）按「读」——终点是创建请求的脚本靠它判不了过（宁低不高）
    const cdn = [{ kind: 'blocked', via: 'fetch', host: 'cdn.getapib.org', url: 'https://cdn.getapib.org/a.mp4' }]
    expect(rehearsalVerdict({ entries: cdn, lockedAtEntry: 0, judgedAllow, endsAt: 'vendor-read' }).passed).toBe(true)
    expect(rehearsalVerdict({ entries: cdn, lockedAtEntry: 0, judgedAllow }).passed).toBe(false)
  })
})

describe('paidRunVerdict · 真付费总闸判据（按产品 decideGenerationFailure 归类）', () => {
  const vendorAllow = ['https://api.apimart.ai', '*.getapib.org']
  const allow = [...vendorAllow, 'https://relay.example.test']
  const loaded = { kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] }
  const responseRow = (status, body, extra = {}) => ({
    kind: 'allowed-response', via: 'fetch', method: 'POST', host: 'api.apimart.ai',
    url: 'https://api.apimart.ai/v1/responses', status, text: typeof body === 'string' ? body : JSON.stringify(body), ...extra,
  })

  it('delegates vendor HTTP / envelope classification to decideGenerationFailure without custom wording rules', () => {
    expect(PAID_UNVERIFIED_EXIT_CODE).toBe(3)
    expect(classifyAllowedVendorResponse(responseRow(402, { error: { message: 'Insufficient account balance for this request' } }))).toMatchObject({ kind: 'balance', vendorSide: true })
    expect(classifyAllowedVendorResponse(responseRow(400, { error: { message: 'Invalid input: replay rejected' } }))).toMatchObject({ kind: 'input', vendorSide: true })
    expect(classifyAllowedVendorResponse(responseRow(200, { id: 'resp_1', status: 'completed' }))).toBeNull()
  })

  it.each([
    [{ code: 'insufficient_quota', message: 'You exceeded your current quota' }, 'balance'],
    [{ type: 'insufficient_quota', message: 'Request rejected' }, 'balance'],
    [{ code: 'rate_limit_exceeded', message: 'Request rejected' }, 'quota'],
  ])('classifies vendor 429 by its identifier in both HTTP and logical errors: %j', (error, kind) => {
    const expected = { kind, vendorSide: true }
    expect(classifyAllowedVendorResponse(responseRow(429, { error }))).toMatchObject(expected)
    expect(classifyAllowedVendorResponse(responseRow(200, { code: 429, error }))).toMatchObject(expected)
  })

  it('marks授权供应商 balance / quota exhaustion as unverified, while relay 429 or product 400 stays 不过', () => {
    const balanceVerdict = paidRunVerdict({
      entries: [loaded, responseRow(402, { error: { message: '账户余额不足，请充值' } })],
      lockedAtEntry: 1, allow, vendorAllow, scriptError: new Error('GPT-6.1 Sol 检查未完成'),
    })
    expect(balanceVerdict).toMatchObject({ status: 'unverified', passed: false, verdict: '未验证：服务商余额不足', upstreamErrorKind: 'balance' })

    // 托管中转（不在 vendorAllow 里）的 429 不算模型服务商余额/额度：脚本失败照判不过
    const relay429 = paidRunVerdict({
      entries: [loaded, responseRow(429, { error: { message: 'Too Many Requests' } }, { host: 'relay.example.test', url: 'https://relay.example.test/v1/assets' })],
      lockedAtEntry: 1, allow, vendorAllow, scriptError: new Error('托管上传失败'),
    })
    expect(relay429).toMatchObject({ status: 'failed', passed: false, verdict: '不过' })
  })
})
