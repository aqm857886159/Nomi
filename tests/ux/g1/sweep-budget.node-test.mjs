import { makeTempDir } from '../../../scripts/_test-temp.mjs'
import './credential-precheck.node-test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reserveSweepRequest } from './sweep-budget.mjs'
import { attachRealText } from './sweep-real.mjs'
const quote = { textRequestUsd: .1, maxOutputTokens: 1024 }
const body = { model: 'gpt-5-nano', max_tokens: 1024 }
const url = 'https://api.apimart.ai/v1/chat/completions'
test('all attempts including concurrent retries reserve before dispatch and share the ceiling', async () => {
  const ledger = { reservedCny: 0, requests: [] }, persisted = []
  const attempt = async () => reserveSweepRequest({ url, method: 'POST', body, quote, ledger, budgetCny: 1,
    persist: () => persisted.push(structuredClone(ledger)) })
  const results = await Promise.allSettled([attempt(), attempt(), attempt()])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(ledger.requests.length, 1)
  assert.equal(persisted.length, 1)
  assert.ok(ledger.reservedCny <= 1)
})
test('media, foreign endpoints, unknown models and unknown budget cannot spend', () => {
  for (const variation of [
    { url: 'https://api.apimart.ai/v1/videos/generations' },
    { url: 'https://example.com/v1/chat/completions' },
    { url: url + '?redirect=1' }, { body: { ...body, model: 'unquoted' } },
    { body: { ...body, max_tokens: 2048 } }, { budgetCny: NaN }, { budgetCny: 4 },
  ]) {
    const ledger = { reservedCny: 0, requests: [] }
    assert.throws(() => reserveSweepRequest({ url, method: 'POST', body, quote, ledger, budgetCny: 3, persist() {}, ...variation }))
    assert.equal(ledger.reservedCny, 0)
    assert.equal(ledger.requests.length, 0)
  }
})
test('real-text bridge cleans executable scratch on both attachment success and failure', async () => {
  const directory = makeTempDir('sweep-bridge-')
  const profile = path.join(directory, 'profile')
  fs.mkdirSync(profile)
  try {
    for (const fail of [false, true]) {
      const launched = { app: { async evaluate(_fn, options) {
        assert.equal(fs.existsSync(options.bridge), true)
        fs.writeFileSync(options.credentialMarker, JSON.stringify({ status: 'ready' }))
        if (fail) throw Error('attach failed')
      } }, win: { async evaluate() {} } }
      const result = attachRealText(launched, { profile, quote, budgetCny: 3 })
      if (fail) await assert.rejects(result, /attach failed/)
      else await result
      assert.equal(fs.existsSync(path.join(profile, 'sweep-main.cjs')), false)
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('mixed dispatch caps each quoted text tier at 1.5 and never forwards media', async () => {
  const { createDispatchWrapper } = await import('./c0-real-main.mjs')
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const dir = makeTempDir('mixed-boundary-')
  try {
    const file = path.join(dir, 'signal.mp4'); fs.writeFileSync(file, 'synthetic')
    for (const text of ['gpt-5-nano', 'deepseek-v4-pro']) {
      const ledger = { reservedCny: 0, requests: [] }; let sent = 0, persisted = false
      const quote = { mediaDryRun: true, models: { text, video: 'MiniMax-H3' }, rates: { input: .1, output: 1 }, maxOutputTokens: 8192, budgetCny: 1.5 }
      const dispatch = createDispatchWrapper({ quote, ledger, persist: () => { persisted = true }, mediaFiles: [file], ledgerPath: path.join(dir, text) })(async (_url, init) => {
        assert.ok(persisted); sent++; assert.equal(JSON.parse(init.body).max_tokens, 8192); return new Response('native')
      })
      const post = body => ({ method: 'POST', body: JSON.stringify(body) })
      assert.equal(await (await dispatch('https://api.apimart.ai/v1/chat/completions', post({ model: text, max_tokens: 16000, messages: [] }))).text(), 'native')
      assert.equal((await (await dispatch('https://api.apimart.ai/v1/videos/generations', post({ model: 'MiniMax-H3', resolution: '768P', duration: 8 }))).json()).data[0].url, 'data:video/mp4;base64,c3ludGhldGlj')
      ledger.reservedCny = 1.5
      await assert.rejects(dispatch('https://api.apimart.ai/v1/chat/completions', post({ model: text })), /BLOCKED_BUDGET/)
      await assert.rejects(dispatch('https://api.apimart.ai/v1/images/generations', post({ model: 'gpt-image-2' })), /REFUSED/)
      assert.equal(sent, 1)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('C0 invocation passes the selected real text tier and budget; default stays dry', async () => {
  const { c0Invocation } = await import('./sweep-c0.mjs')
  const base = { root: '/repo', target: '/case', directory: '/run', budgetCny: 1.5, env: {} }
  assert.deepEqual(c0Invocation(base).args, [path.join('/repo', 'tests/ux/g1/c0-short-film.walk.mjs'), '--dry-run'])
  for (const plannerModel of ['gpt-5-nano', 'deepseek-v4-pro']) {
    const child = c0Invocation({ ...base, realText: true, plannerModel, packaged: '/Nomi.app' })
    assert.deepEqual(child.args.slice(1), ['--real', '--planner-model', plannerModel, '--packaged', '/Nomi.app'])
    assert.equal(child.env.NOMI_C0_TEXT_BUDGET, '1.5')
    assert.equal(child.env.NOMI_C0_MEDIA_DRY_RUN, '1')
    assert.equal(child.env.NOMI_C0_LEDGER_DIR, '/run')
  }
})

test('real-text without a configured enabled key fails explicitly before any request', async () => {
  const { requireCredential } = await import('./credential-precheck.mjs')
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const dir = makeTempDir('mixed-key-'), file = path.join(dir, 'catalog.json')
  try {
    assert.throws(() => requireCredential(file, dir), /CREDENTIAL_BLOCKED/)
    for (const apimart of [undefined, { enc: 'safeStorage', enabled: false }]) {
      fs.writeFileSync(file, JSON.stringify({ apiKeysByVendor: { apimart } }))
      assert.throws(() => requireCredential(file, dir), /CREDENTIAL_BLOCKED/)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('both dispatch outlets share reservations, cap output, and reject every non-text outbound route', async () => {
  const { quotePlanSample } = await import('./c0-plan-sample-budget.mjs')
  const { createDispatchWrapper } = await import('./c0-real-main.mjs')
  for (const [model, cap] of [['gpt-5-nano', 16000], ['deepseek-v4-pro', 8192]]) {
    const prices = new Map([[model, { pricing: { unit: 'usd_per_million_tokens', tier_count: 1,
      rates: { input: .1, output: 1 }, limits: { max_output_tokens: 100000 } } }]])
    const quote = { ...quotePlanSample(prices, model), mediaDryRun: true, budgetCny: .15 }
    assert.equal(quote.maxOutputTokens, cap)
    const ledger = { reservedCny: 0, requests: [] }, outgoing = []
    const wrap = createDispatchWrapper({ quote, ledger, persist() {} })
    const send = async (url, init) => { outgoing.push({ url, ...init }); return new Response('native') }
    const appFetch = wrap(send), globalFetch = wrap(send)
    const body = { model, max_tokens: 100000, messages: [{ role: 'user', content: '中文🙂' }], tools: [{ schema: 'x'.repeat(500) }] }
    const request = () => new Request('https://api.apimart.ai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => (i % 2 ? appFetch : globalFetch)(request())))
    assert.ok(results.some(r => r.status === 'rejected' && /BLOCKED_BUDGET/.test(r.reason.message)))
    assert.ok(ledger.reservedCny <= .15)
    assert.equal(outgoing.length, results.filter(r => r.status === 'fulfilled').length)
    for (const row of outgoing) {
      assert.equal(JSON.parse(row.body).max_tokens, cap)
      assert.equal(row.headers.get('content-type'), 'application/json')
      assert.equal(row.redirect, 'error')
    }
    assert.equal(ledger.requests[0].inputBytes, Buffer.byteLength(outgoing[0].body))
    const count = outgoing.length
    for (const url of ['https://api.apimart.ai/v1/images/generations', 'https://api.apimart.ai/v1/audio/speech', 'https://api.apimart.ai/v1/videos/generations', 'https://other.example/video.mp4', 'https://api.apimart.ai/v1/chat/completions?x=1']) {
      await assert.rejects(appFetch(url, { method: 'POST', body: JSON.stringify({ model }) }), /REFUSED/)
    }
    assert.equal(outgoing.length, count)
  }
})

test('mixed budget refuses unbounded output and keeps failed dispatch reservations', async () => {
  const { planSampleFetch, quotePlanSample } = await import('./c0-plan-sample-budget.mjs')
  assert.throws(() => quotePlanSample(new Map(), 'gpt-5-nano'), /PRICE_UNKNOWN/)
  assert.throws(() => quotePlanSample(new Map(), 'unknown'), /MODEL_REFUSED/)
  const quote = { models: { text: 'gpt-5-nano' }, rates: { input: .1, output: 1 }, maxOutputTokens: 16000, budgetCny: 1.5 }
  let sent = 0
  const send = async () => { sent++; throw Error('transport failed') }
  const ledger = { requests: [], reservedCny: 0 }
  const dispatch = planSampleFetch({ send, quote, ledger, persist() {} })
  const call = extra => dispatch('https://api.apimart.ai/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: quote.models.text, ...extra }) })
  for (const max_tokens of [0, -1, 1.5, 'bad']) await assert.rejects(call({ max_tokens }), /OUTPUT_LIMIT_REQUIRED/)
  await assert.rejects(call({ max_completion_tokens: 1 }), /MODEL_REFUSED/)
  assert.equal(sent, 0)
  await assert.rejects(call({ messages: [] }), /PROVIDER_REQUEST_FAILED/)
  assert.equal(sent, 1)
  assert.ok(ledger.reservedCny > 0)
  assert.equal(ledger.requests[0].transportFailed, true)
  const cannotPersist = planSampleFetch({ send, quote, ledger, persist() { throw Error('disk full') } })
  await assert.rejects(cannotPersist('https://api.apimart.ai/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: quote.models.text }) }), /disk full/)
  assert.equal(sent, 1)
})
