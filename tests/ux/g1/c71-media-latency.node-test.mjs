import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetGuard, drainTextEvidence } from './c71-budget-main.mjs'
import { selectQuote, selectPlannerQuote, createBarrierFixture } from './c71-fixture.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const quote = { wireModels: ['cheap'], params: { duration: 6 }, resolution: '480p', shots: 2, perShotUpperCny: 0.6, budgetCny: 6 }
const body = shot => ({ model: 'cheap', prompt: `C71-S${shot}：leaves`, duration: 6, resolution: '480p', size: '16:9' })
const post = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
const url = 'https://api.apimart.ai/v1/videos/generations'
test('reserves before real dispatch, accepts two unique shots, rejects any third or duplicate', async () => {
  const ledger = { requests: [], polls: [], reservedCny: 0 }, order = []
  const send = budgetGuard({ quote, ledger, persist: () => order.push('persist'), send: async () => {
    order.push('send'); return Response.json({ data: [{ task_id: String(ledger.requests.length) }] })
  } })
  await send(url, post(body(1))); await send(url, post(body(2)))
  assert.deepEqual(order.slice(0, 2), ['persist', 'send'])
  assert.equal(ledger.reservedCny, 1.2)
  for (const shot of [1, 3]) await assert.rejects(send(url, post(body(shot))), /C71_DUPLICATE_OR_UNKNOWN_SHOT/)
  assert.equal(order.filter(x => x === 'send').length, 2)
})
test('rejects actual parameter drift, unpriced generation and paid background text before dispatch', async () => {
  const ledger = { requests: [], polls: [], reservedCny: 0 }; let sent = false
  const send = budgetGuard({ quote, ledger, persist() {}, send: async () => { sent = true } })
  for (const patch of [{ duration: 15 }, { resolution: '720p' }, { model: 'expensive' }, { quality: '480p', resolution: undefined }, { n: 2 }])
    await assert.rejects(send(url, post({ ...body(1), ...patch })), /C71_UNQUOTED_REQUEST/)
  await assert.rejects(send('https://api.apimart.ai/v1/chat/completions', post({})), /C71_OUTBOUND_REFUSED/)
  assert.equal(sent, false)
})
test('failed request remains durably reserved and budget refuses further spending', async () => {
  const ledger = { requests: [], polls: [], reservedCny: 0 }; let saves = 0
  const send = budgetGuard({ quote: { ...quote, budgetCny: 0.6 }, ledger, persist: () => saves++, send: async () => { throw Error('offline') } })
  await assert.rejects(send(url, post(body(1))), /offline/)
  await assert.rejects(send(url, post(body(2))), /C71_BUDGET_EXCEEDED/)
  assert.equal(ledger.reservedCny, 0.6); assert.ok(saves >= 2)
})
test('selection follows current configured catalog and live priced tier, not a model-name default', () => {
  const catalog = { models: ['first', 'second'].map(modelKey => ({ vendorKey: 'apimart', kind: 'video', modelKey, meta: { archetypeId: modelKey } })),
    mappings: ['first', 'second'].map(modelKey => ({ vendorKey: 'apimart', modelKey, taskKind: 'text_to_video' })) }
  const defaults = Object.fromEntries(['first', 'second'].map(k => [k, { text_to_video: { '*': { duration: 6, resolution: '480p' } } }]))
  const prices = new Map(['first', 'second'].map((k,i) => [k, { fixed_prices: { unit: 'usd_per_second', items: [{ key: '480P', original_price: 0.03 / (i + 1), after_discount: 0.01 }] } }]))
  assert.equal(selectQuote(prices, catalog, defaults).model, 'second')
  prices.get('first').fixed_prices.items[0].original_price = 0.005
  assert.equal(selectQuote(prices, catalog, defaults).model, 'first')
})

test('loopback withholds every terminal result until all eight real HTTP submissions arrive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c71-barrier-test-'))
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const fixture = await createBarrierFixture(root, path.join(directory, 'settings'), path.join(directory, 'media'))
  try {
    for (let shot = 1; shot < fixture.shots; shot++) {
      const response = await fetch(fixture.baseUrl + '/v1/videos/generations', post({ model: fixture.model, prompt: `C71-S${shot}：test` }))
      assert.equal(response.status, 200)
    }
    const firstPoll = await (await fetch(fixture.baseUrl + '/v1/tasks/1')).json()
    assert.equal(firstPoll.data.status, 'processing'); assert.equal(fixture.terminals.length, 0)
    await fetch(fixture.baseUrl + '/v1/videos/generations', post({ model: fixture.model, prompt: `C71-S${fixture.shots}：test` }))
    const lastPoll = await (await fetch(fixture.baseUrl + '/v1/tasks/1')).json()
    assert.equal(lastPoll.data.status, 'completed'); assert.equal(fixture.terminals[0].admitted, fixture.shots)
    assert.match(lastPoll.data.result.videos[0].url[0], /^data:video\/mp4;base64,/)
  } finally { await fixture.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('text is priced from actual body while preserving the entire future video allocation', async () => {
  const ledger = { requests: [], polls: [], reservedCny: 0 }; let actual
  const plannerQuote = { ...quote, cnyPerUsd: 7, planner: { model: 'planner', rates: { input: 0.257, output: 0.3855 } } }
  const send = budgetGuard({ quote: plannerQuote, ledger, persist() {}, send: async (input, init) => {
    actual = JSON.parse(init.body)
    return Response.json({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })
  } })
  const request = { model: 'planner', max_tokens: 16384, messages: [{ role: 'user', content: 'two shots' }] }
  await send('https://api.apimart.ai/v1/chat/completions', post(request)); await drainTextEvidence()
  assert.deepEqual(actual, request); assert.equal(ledger.requests[0].kind, 'text')
  assert.equal(ledger.requests[0].maxTokens, request.max_tokens)
  assert.equal(ledger.requests[0].usage.completion_tokens, 20)
  await assert.rejects(send('https://api.apimart.ai/v1/chat/completions', post({ ...request, max_tokens: 10000000 })), /C71_BUDGET_EXCEEDED/)
  await assert.rejects(send('https://api.apimart.ai/v1/chat/completions', post({ model: 'planner' })), /C71_TEXT_OUTPUT_LIMIT_REQUIRED/)
})
test('planner selection derives current configured token rates and rejects unavailable prices', () => {
  const catalog = { models: ['one', 'two'].map(modelKey => ({ modelKey, vendorKey: 'apimart', kind: 'text' })) }
  const prices = new Map(['one', 'two'].map((k,i) => [k, { pricing: { unit: 'usd_per_million_tokens', tier_count: 1, rates: { input: 1 + i, output: 2 + i }, limits: { max_output_tokens: 16000 } } }]))
  assert.equal(selectPlannerQuote(prices, catalog).model, 'one')
  assert.throws(() => selectPlannerQuote(new Map(), catalog), /C71_NO_QUOTED_PLANNER/)
})

test('transport wrappers share task/media admission instead of overwriting each others ledger', async () => {
  const ledger = { requests: [], polls: [], reservedCny: 0 }
  const first = budgetGuard({ quote, ledger, persist() {}, send: async () => Response.json({ data: [{ task_id: 'shared' }] }) })
  const second = budgetGuard({ quote, ledger, persist() {}, send: async () => Response.json({ data: { id: 'shared', status: 'processing' } }) })
  await first(url, post(body(1)))
  const response = await second('https://api.apimart.ai/v1/tasks/shared')
  assert.equal(response.status, 200); assert.deepEqual(ledger.tasks, ['shared'])
})
test('only completely quoted planner can reserve an unmodified request without max_tokens', async () => {
  const catalog = { models: ['unknown-cap', 'known-cap'].map(modelKey => ({ modelKey, vendorKey: 'apimart', kind: 'text' })) }
  const prices = new Map(catalog.models.map((m,i) => [m.modelKey, { pricing: { unit: 'usd_per_million_tokens', tier_count: 1,
    rates: { input: 1 + i, output: 2 + i }, ...(i ? { limits: { max_output_tokens: 16000 } } : {}) } }]))
  const planner = selectPlannerQuote(prices, catalog); assert.equal(planner.model, 'known-cap')
  const ledger = { requests: [], polls: [], reservedCny: 0 }; let transmitted
  const send = budgetGuard({ quote: { ...quote, cnyPerUsd: 7, planner }, ledger, persist() {}, send: async (_url, init) => {
    transmitted = JSON.parse(init.body); return Response.json({ choices: [] })
  } })
  const request = { model: planner.model, messages: [] }
  await send('https://api.apimart.ai/v1/chat/completions', post(request)); await drainTextEvidence()
  assert.deepEqual(transmitted, request); assert.equal(ledger.requests[0].maxTokens, 16000)
})
