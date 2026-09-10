// Test-only paid dispatch guard; preserves production transport, credentials and request body.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const pendingText = new Set()
export async function drainTextEvidence() { await Promise.all([...pendingText]) }
export function budgetGuard({ quote, ledger, persist, send }) {
  if (!Number.isFinite(ledger.reservedCny) || ledger.reservedCny < 0 || !Array.isArray(ledger.requests)
      || !Number.isFinite(quote.budgetCny) || quote.budgetCny <= 0 || quote.budgetCny > 6) throw Error('C71_INVALID_BUDGET_LEDGER')
  const tasks = ledger.tasks ??= [], media = ledger.media ??= []
  const save = persist
  return async (input, init) => {
    const request = new Request(input instanceof Request ? input.clone() : input, init)
    const url = new URL(request.url)
    let row
    if (request.method === 'POST') {
      if (url.origin !== 'https://api.apimart.ai' || url.search) throw Error('C71_OUTBOUND_REFUSED')
      const body = await request.clone().json()
      let reservation
      if (url.pathname === '/v1/chat/completions' && quote.planner && body.model === quote.planner.model) {
        const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? quote.planner.maxOutputTokens
        const inputBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
        if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw Error('C71_TEXT_OUTPUT_LIMIT_REQUIRED')
        reservation = (inputBytes * quote.planner.rates.input + maxTokens * quote.planner.rates.output) / 1e6 * quote.cnyPerUsd
        // Future video submissions retain their allocation even while the planner is using text.
        const remainingVideo = (quote.shots - ledger.requests.filter(r => r.kind === 'video').length) * quote.perShotUpperCny
        if (ledger.reservedCny + reservation + remainingVideo > quote.budgetCny) throw Error('C71_BUDGET_EXCEEDED')
        row = { kind: 'text', model: body.model, inputBytes, maxTokens }
      } else if (url.pathname === '/v1/videos/generations') {
        if (!quote.wireModels.includes(body.model) || body.duration !== quote.params.duration
            || body.resolution?.toLowerCase() !== quote.resolution.toLowerCase()
            || body.size !== '16:9' || Object.keys(body).some(k => !['model', 'prompt', 'duration', 'resolution', 'size'].includes(k))) throw Error('C71_UNQUOTED_REQUEST')
        const shot = Number(/^C71-S(\d+)：/.exec(body.prompt)?.[1])
        if (!Number.isInteger(shot) || shot < 1 || shot > quote.shots || ledger.requests.some(r => r.shot === shot)) throw Error('C71_DUPLICATE_OR_UNKNOWN_SHOT')
        reservation = quote.perShotUpperCny
        row = { kind: 'video', shot, model: body.model, duration: body.duration, resolution: body.resolution }
      } else throw Error('C71_OUTBOUND_REFUSED')
      if (!Number.isFinite(reservation) || reservation <= 0 || ledger.reservedCny + reservation > quote.budgetCny) throw Error('C71_BUDGET_EXCEEDED')
      Object.assign(row, { started: new Date().toISOString(), startedMs: performance.now(), reservedCny: reservation })
      ledger.requests.push(row)
      ledger.reservedCny += row.reservedCny
      save() // Reserve durably before any side effect. Failed/aborted requests remain reserved.
    } else if (request.method !== 'GET' || !(url.origin === 'https://api.apimart.ai'
        && tasks.includes(url.pathname.split('/').at(-1)) && /^\/v1\/tasks\/[^/]+$/.test(url.pathname) && !url.search
        || media.includes(request.url))) throw Error('C71_OUTBOUND_REFUSED')
    try {
      const response = await send(input, { ...init, redirect: 'error' })
      if (row) { row.httpStatus = response.status; row.headersReceived = new Date().toISOString() }
      if (row?.kind === 'text') {
        const completion = response.clone().text().then(text => {
          const chunks = text.startsWith('data:') ? text.split('\n').filter(line => line.startsWith('data:') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(5))) : [JSON.parse(text)]
          row.usage = chunks.map(chunk => chunk.usage).filter(Boolean).at(-1)
        }).catch(() => { row.usageUnavailable = true }).finally(() => {
          row.ended = new Date().toISOString(); row.endedMs = performance.now(); save()
        })
        pendingText.add(completion); void completion.finally(() => pendingText.delete(completion))
        save(); return response
      }
      if (row) { row.ended = new Date().toISOString(); row.endedMs = performance.now() }
      if (response.headers.get('content-type')?.includes('json')) {
        const data = await response.clone().json()
        for (const task of Array.isArray(data.data) ? data.data : []) if (task.task_id && !tasks.includes(task.task_id)) tasks.push(task.task_id)
        const result = data.data?.result
        for (const entry of result?.videos ?? []) for (const value of [entry.url].flat()) {
          if (typeof value === 'string' && value.startsWith('https://') && !media.includes(value)) media.push(value)
        }
        if (data.data?.status && tasks.includes(data.data.id)) ledger.polls.push({ taskId: data.data.id, status: data.data.status, at: new Date().toISOString() })
      }
      save()
      return response
    } catch (error) {
      if (row) { row.ended = new Date().toISOString(); row.endedMs = performance.now(); row.error = 'C71_TRANSPORT_FAILED' }
      save()
      throw error
    }
  }
}
export function attachBudget({ quote, ledgerPath }) {
  const require = createRequire(import.meta.url)
  const { app } = require('electron')
  const transport = require(path.join(app.getAppPath(), 'dist-electron/appFetch.js'))
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { requests: [], polls: [], reservedCny: 0 }
  const persist = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 })
  transport.appFetch = budgetGuard({ quote, ledger, persist, send: transport.appFetch })
  globalThis.fetch = budgetGuard({ quote, ledger, persist, send: globalThis.fetch })
  persist()
  return { async snapshot() { await drainTextEvidence(); return { ...ledger, media: undefined } } }
}
