import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

export const MODEL_COST = Object.freeze({ vendorKey: 'apimart', modelKey: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', size: '1:3', resolution: '1K', quality: 'low' })
export const stepsHash = () => createHash('sha256').update(fs.readFileSync(new URL('./_modelSurfaceCostSteps.mjs', import.meta.url))).digest('hex')

export function assertModelCostRehearsal(file, now = Date.now()) {
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(receipt.status, 'passed', 'Free rehearsal must pass')
  const age = now - Date.parse(receipt.finishedAt)
  assert(Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60_000, 'Free rehearsal receipt expired (24 hours)')
  assert.equal(receipt.stepsHash, stepsHash(), 'Shared steps changed after rehearsal')
  assert.deepEqual(receipt.model, MODEL_COST, 'Authorized model/spec must match rehearsal')
  assert.deepEqual(receipt.results.map(r => r.locale).sort(), ['en', 'zh-CN'])
  assert(receipt.results.every(r => Object.values(r.checks).length > 0 && Object.values(r.checks).every(Boolean)), 'Every rehearsal check must pass')
  assert.match(receipt.commit, /^[a-f0-9]{40}$/)
  execFileSync('git', ['diff', '--quiet', receipt.commit, 'HEAD', '--', 'src', 'electron'])
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'electron'])
  return receipt
}

export function costError(estimate, actual) {
  assert(Number.isFinite(estimate) && estimate > 0 && Number.isFinite(actual), 'Cost comparison requires measured finite values')
  return { absolute: Math.abs(actual - estimate), percentOfEstimate: Math.abs(actual - estimate) / estimate * 100 }
}

/** One attempt including failures. Other POSTs fail closed; observations never retain request headers. */
export async function createModelCostProxy(target, { reply } = {}) {
  const upstreamOrigin = new URL(target)
  assert(!upstreamOrigin.username && !upstreamOrigin.password)
  assert(['https://api.apimart.ai', 'https://api.apib.ai'].includes(upstreamOrigin.origin) || (upstreamOrigin.protocol === 'http:' && upstreamOrigin.hostname === '127.0.0.1'))
  const records = [], reads = []
  let attempts = 0
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    if (req.method !== 'GET') {
      let value
      try { value = JSON.parse(body.toString()) } catch { res.writeHead(400).end(); return }
      if (req.method !== 'POST' || url.pathname !== '/v1/images/generations' || attempts !== 0
          || value.model !== MODEL_COST.modelKey || Number(value.n ?? 1) !== 1
          || value.size !== MODEL_COST.size || value.resolution !== MODEL_COST.resolution.toLowerCase() || value.quality !== MODEL_COST.quality
          || Object.keys(value).some(k => !['model', 'prompt', 'size', 'resolution', 'quality', 'background', 'n'].includes(k))
          || (value.background != null && value.background !== 'auto')) { res.writeHead(403).end(); return }
      attempts++
      records.push({ at: new Date().toISOString(), model: value.model, size: value.size, resolution: value.resolution, quality: value.quality })
    }
    const observe = (status, headers, bytes) => {
      const decode = { gzip: gunzipSync, deflate: inflateSync, br: brotliDecompressSync }[headers['content-encoding']]
      try {
        const raw = JSON.parse((decode ? decode(bytes) : bytes).toString())
        if (req.method === 'POST') {
          const data = Array.isArray(raw.data) ? raw.data[0] : raw.data
          Object.assign(records[0], { status, taskId: data?.task_id ?? data?.id ?? null })
        } else if (['/v1/balance', '/v1/user/balance', '/v1/usage', '/api/pricing/model'].includes(url.pathname)) {
          // Keep raw numeric facts, never arbitrary provider strings or credential-bearing headers.
          const facts = Object.fromEntries(['success', 'remain_balance', 'remain_credits', 'used_balance', 'used_credits', 'unlimited_quota'].filter(k => typeof raw[k] === 'number' || typeof raw[k] === 'boolean').map(k => [k, raw[k]]))
          if (url.pathname === '/v1/usage') facts.data = { total: raw.data?.total, start: raw.data?.start, end: raw.data?.end, scope: raw.data?.scope }
          if (url.pathname === '/api/pricing/model') facts.data = { model_name: raw.data?.model_name, paid_price: raw.data?.paid_price, size_quality_paid_prices: raw.data?.size_quality_paid_prices }
          reads.push({ at: new Date().toISOString(), path: url.pathname, status, raw: facts })
        }
      } catch { /* Non-JSON/error responses remain unmeasured, never zero. */ }
      res.writeHead(status, headers); res.end(bytes)
    }
    if (reply) {
      const response = reply(req, url, records)
      if (response) { observe(response.status ?? 200, { 'content-type': 'application/json' }, Buffer.from(JSON.stringify(response.body))); return }
    }
    const remote = (upstreamOrigin.protocol === 'https:' ? https : http).request(new URL(url.pathname + url.search, upstreamOrigin), {
      method: req.method, headers: { ...req.headers, host: upstreamOrigin.host }, timeout: 30_000,
    }, response => {
      const parts = []
      response.on('data', part => parts.push(part))
      response.on('end', () => observe(response.statusCode, response.headers, Buffer.concat(parts)))
    })
    remote.on('timeout', () => remote.destroy())
    remote.on('error', () => res.destroy())
    remote.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, records, reads,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
