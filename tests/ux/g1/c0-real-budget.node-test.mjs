import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestQuote, reserve, assertAffordable, REAL_MODELS } from './c0-real-budget.mjs'
const quote = { textRequestUsd: .01, maxOutputTokens: 16000, videoPerSecondUsd: .0714, imageUsd: .010625 }
test('current H3 64s cannot pass the eight yuan preflight', () => {
  assert.throws(() => assertAffordable({ totalUpperCny: 64 * quote.videoPerSecondUsd * 7 }), /BLOCKED_BUDGET/)
  assert.throws(() => assertAffordable({ totalUpperCny: NaN }), /BLOCKED_BUDGET/)
})
test('unquoted models, paid routes, parameters and cross-origin destinations are refused', () => {
  const body = { model: REAL_MODELS.video, resolution: '768P', duration: 8, aspect_ratio: '16:9' }
  assert.equal(requestQuote('https://api.apimart.ai/v1/videos/generations', 'POST', body, quote).duration, 8)
  for (const patch of [{ model: 'unknown' }, { resolution: '2K' }, { duration: 15 }, { n: 2 }, { video_urls: ['https://example.org/x'] }])
    assert.throws(() => requestQuote('https://api.apimart.ai/v1/videos/generations', 'POST', { ...body, ...patch }, quote), /UNQUOTED/)
  assert.throws(() => requestQuote('https://other.example/v1/videos/generations', 'POST', body, quote), /REFUSED/)
  assert.throws(() => requestQuote('https://api.apimart.ai/v1/chat/completions', 'POST', { model: REAL_MODELS.text }, quote), /OUTPUT_LIMIT/)
})
test('in-flight requests and failures retain reservations; persistence fails before send', () => {
  const ledger = { reservedCny: 0, requests: [] }, written = []
  for (let i = 0; i < 8; i++) reserve(ledger, { upperUsd: 1 / 7 }, (l) => written.push(l.reservedCny))
  assert.deepEqual(written, [1, 2, 3, 4, 5, 6, 7, 8])
  assert.throws(() => reserve(ledger, { upperUsd: .001 }, () => {}), /BLOCKED_BUDGET/)
  assert.equal(ledger.requests.length, 8)
  assert.throws(() => reserve({ reservedCny: 0, requests: [] }, { upperUsd: .1 }, () => { throw new Error('disk-full') }), /disk-full/)
})

test('dispatch reserves before forwarding, preserves real responses and never retries a failed send', async () => {
  const { budgetedFetch } = await import('./c0-real-budget.mjs')
  const ledger = { reservedCny: 0, requests: [] }, sent = []
  let writes = 0
  const dispatch = budgetedFetch({ quote, ledger, persist: () => { writes++ }, send: async (url, init) => {
    assert.ok(writes > 0)
    sent.push({ url, body: JSON.parse(init.body), redirect: init.redirect })
    return new Response('upstream-content', { status: 201 })
  } })
  const body = { model: REAL_MODELS.text, messages: [{ role: 'user', content: 'hello' }] }
  const result = await dispatch('https://api.apimart.ai/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) })
  assert.equal(await result.text(), 'upstream-content')
  assert.equal(result.status, 201)
  assert.equal(sent[0].body.max_tokens, quote.maxOutputTokens)
  assert.equal(sent[0].redirect, 'error')
  assert.equal(ledger.requests[0].httpStatus, 201)
  assert.equal(JSON.stringify(ledger).includes('hello'), false)
  const before = ledger.reservedCny
  const fail = budgetedFetch({ quote, ledger, persist: () => {}, send: async () => { throw new Error('sensitive upstream detail') } })
  await assert.rejects(fail('https://api.apimart.ai/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) }),
    (error) => error.message === 'C0_PROVIDER_REQUEST_FAILED')
  assert.ok(ledger.reservedCny > before)
  assert.equal(ledger.requests.length, 2)
})
