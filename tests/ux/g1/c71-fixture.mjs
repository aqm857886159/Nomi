import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { publicPrices, CNY_PER_USD } from './c0-real-budget.mjs'
import { createSyntheticC0Media } from './c0-fixture.mjs'
import { createAgentRuntimeFixture, FIXTURE_VENDOR } from '../agent-runtime-fixture.mjs'
import { prepareIsolation } from '../../../evals/lib/isoApp.mjs'
export function selectQuote(prices, catalog, defaults) {
  const offers = []
  for (const model of catalog.models.filter(m => m.vendorKey === 'apimart' && m.kind === 'video')) {
    if (!catalog.mappings.some(m => m.vendorKey === 'apimart' && m.modelKey === model.modelKey && m.taskKind === 'text_to_video')) continue
    const params = defaults[model.meta?.archetypeId]?.text_to_video?.['*']
    const price = prices.get(model.modelKey)
    if (!params?.duration || price?.fixed_prices?.unit !== 'usd_per_second') continue
    const resolution = params.resolution ?? params.quality
    const tier = price.fixed_prices.items.find(i => i.key.toLowerCase() === String(resolution).toLowerCase())
    if (!tier) continue // Do not invent the meaning of a default pricing tier.
    const usdPerSecond = Math.max(tier.original_price, tier.after_discount)
    if (!Number.isFinite(usdPerSecond) || usdPerSecond <= 0) continue
    offers.push({ model: model.modelKey, label: model.labelZh, params, resolution, usdPerSecond,
      wireModels: [model.modelKey, price.alias].filter(Boolean), perShotUpperCny: usdPerSecond * params.duration * CNY_PER_USD })
  }
  offers.sort((a, b) => a.perShotUpperCny - b.perShotUpperCny)
  if (!offers.length) throw Error('C71_NO_QUOTED_CONFIGURED_T2V_MODEL')
  return { ...offers[0], shots: 2, budgetCny: 6, upperCny: offers[0].perShotUpperCny * 2,
    cnyPerUsd: CNY_PER_USD, source: 'https://apimart.ai/pricing', checkedAt: new Date().toISOString(),
    selectionScope: 'configured text-to-video models with explicit live-priced default tier', candidates: offers }
}
export function selectPlannerQuote(prices, catalog) {
  const candidates = catalog.models.filter(m => m.vendorKey === 'apimart' && m.kind === 'text').flatMap(model => {
    const pricing = prices.get(model.modelKey)?.pricing
    if (pricing?.unit !== 'usd_per_million_tokens' || pricing.tier_count !== 1
        || ![pricing.rates?.input, pricing.rates?.output, pricing.limits?.max_output_tokens].every(n => Number.isFinite(n) && n > 0)) return []
    return [{ model: model.modelKey, label: model.labelZh, rates: pricing.rates,
      maxOutputTokens: pricing.limits?.max_output_tokens }]
  }).sort((a,b) => a.rates.input + a.rates.output - b.rates.input - b.rates.output)
  if (!candidates.length) throw Error('C71_NO_QUOTED_PLANNER')
  return { ...candidates[0], candidates, selectionScope: 'configured text models with live token prices and published maximum output for unmodified requests', source: 'https://apimart.ai/pricing' }
}
export async function prepareReal(root, profile, output) {
  const response = await fetch('https://apimart.ai/pricing', { signal: AbortSignal.timeout(30000), redirect: 'error' })
  if (!response.ok) throw Error('C71_PRICE_UNAVAILABLE')
  const html = await response.text()
  fs.writeFileSync(path.join(output, 'public-pricing.html'), html)
  const iso = prepareIsolation(profile, { requireCatalog: true })
  const file = path.join(iso.settingsDir, 'model-catalog.json'), catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const require = createRequire(import.meta.url)
  const { ARCHETYPE_WIRE_DEFAULTS } = require(path.join(root, 'dist-electron/catalog/archetypeWireDefaults.generated.js'))
  const prices = publicPrices(html)
  const quote = { ...selectQuote(prices, catalog, ARCHETYPE_WIRE_DEFAULTS), planner: selectPlannerQuote(prices, catalog) }
  if (quote.upperCny > quote.budgetCny) throw Error('C71_BUDGET_EXCEEDED')
  if (catalog.apiKeysByVendor.apimart?.enc !== 'safeStorage') throw Error('C71_ENCRYPTED_CREDENTIAL_REQUIRED')
  for (const vendor of catalog.vendors) vendor.enabled = vendor.key === 'apimart'
  for (const model of catalog.models) model.enabled = model.vendorKey === 'apimart' && [quote.model, quote.planner.model].includes(model.modelKey)
  catalog.apiKeysByVendor = { apimart: catalog.apiKeysByVendor.apimart }
  fs.writeFileSync(file, JSON.stringify(catalog), { mode: 0o600 })
  return { quote, iso, model: quote.model, shots: quote.shots, duration: quote.params.duration, async close() { fs.rmSync(iso.settingsDir, { recursive: true, force: true }) } }
}
export async function createBarrierFixture(root, settingsDir, mediaDir) {
  const text = await createAgentRuntimeFixture({ rootDir: root, settingsDir })
  const results = createSyntheticC0Media(mediaDir).map(file => `data:video/mp4;base64,${fs.readFileSync(file).toString('base64')}`)
  const calls = [], terminals = [], sockets = new Set()
  const model = 'c71-barrier-video', vendorKey = 'c71-barrier-provider'
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET' && req.url.startsWith('/v1/tasks/')) {
        const shot = Number(req.url.split('/').at(-1)), ready = calls.length === results.length
        if (!calls.some(c => c.shot === shot)) throw Error('unknown task')
        if (ready) terminals.push({ shot, admitted: calls.length, at: new Date().toISOString() })
        res.end(JSON.stringify({ data: { id: String(shot), status: ready ? 'completed' : 'processing',
          ...(ready ? { result: { videos: [{ url: [results[shot - 1]] }] } } : {}) } }))
        return
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks)), shot = Number(/^C71-S(\d+)：/.exec(body.prompt)?.[1])
      if (req.method !== 'POST' || req.url !== '/v1/videos/generations' || body.model !== model
          || !Number.isInteger(shot) || shot < 1 || shot > results.length || calls.some(c => c.shot === shot)) throw Error('unexpected submission')
      calls.push({ shot, started: new Date().toISOString(), startedMs: performance.now() })
      res.end(JSON.stringify({ data: [{ task_id: String(shot), status: 'submitted' }] }))
    } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'C71_BARRIER_PROTOCOL_FAILURE' })) }
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = path.join(settingsDir, 'model-catalog.json'), catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  catalog.vendors.push({ ...catalog.vendors.find(v => v.key === FIXTURE_VENDOR), key: vendorKey, name: 'C71 protocol barrier', baseUrlHint: `http://127.0.0.1:${server.address().port}` })
  catalog.apiKeysByVendor[vendorKey] = { ...catalog.apiKeysByVendor[FIXTURE_VENDOR], vendorKey }
  catalog.models = [{ modelKey: model, vendorKey, labelZh: 'C71 零费用协议测试', kind: 'video', enabled: true, published: true, meta: { archetypeId: 'wan-2.7' } }]
  catalog.mappings.push({ id: 'c71-barrier-t2v', vendorKey, modelKey: model, taskKind: 'text_to_video', enabled: true,
    create: { method: 'POST', path: '/v1/videos/generations', body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
      response_mapping: { task_id: 'data.0.task_id' }, provider_meta_mapping: { task_id: 'data.0.task_id' } },
    query: { method: 'GET', path: '/v1/tasks/{{providerMeta.task_id}}', response_mapping: { task_id: 'data.id', status: 'data.status', video_url: 'data.result.videos.0.url.0' } },
    statusMapping: { queued: ['submitted'], running: ['processing'], succeeded: ['completed'], failed: ['failed'] } })
  fs.writeFileSync(file, JSON.stringify(catalog))
  return { model, baseUrl: `http://127.0.0.1:${server.address().port}`, shots: results.length, duration: 8, calls, terminals, async close() {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve)); await text.close()
  } }
}
