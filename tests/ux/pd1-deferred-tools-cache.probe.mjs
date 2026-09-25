#!/usr/bin/env node
// 手动探针，付费 ≤¥0.3；不进 CI。NOMI_AGENT_LIVE=1 node tests/ux/pd1-deferred-tools-cache.probe.mjs
// Prerequisites: pnpm build; pnpm exec tsc -p tests/agent-runtime/tsconfig.json.
// Real Electron + existing probe lane; attachment unlock is probe-only, not shipped UI wiring.
// Only numeric usage/cost and fixed diagnostic labels leave Electron. Never log keys, headers or errors.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUDGET_CNY = 0.30
// Conservative budget conversion: Sep 8 USD/CNY quote 6.7108; reserve at 7.
// Source: https://www.investing.com/currencies/usd-cny-historical-data (2026-09-08).
const CNY_PER_USD = 7
const MAX_OUTPUT = 64
const budgetFile = path.join(root, '.tmp/pd1-cache-budget.json')
const transports = [
  { api: 'anthropic-messages', kind: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { api: 'openai-responses', kind: 'openai-responses', model: 'gpt-5-nano' },
  { api: 'openai-completions', kind: 'openai-compatible', model: 'gpt-5-nano' },
]
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
const usageFields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_tokens', 'cache_write_tokens',
  'ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens', 'reasoning_tokens',
  'claude_cache_creation_5_m_tokens', 'claude_cache_creation_1_h_tokens']
function safeUsage(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  for (const key of usageFields) if (number(value[key]) !== null) out[key] = value[key]
  for (const key of ['cache_creation', 'input_tokens_details', 'output_tokens_details',
    'prompt_tokens_details', 'completion_tokens_details']) {
    if (value[key] && typeof value[key] === 'object') out[key] = safeUsage(value[key])
  }
  return out
}
function piUsage(value) {
  return Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']
    .map((key) => [key, number(value?.[key])]))
}
function modelPrices(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/g)]
    .map((match) => JSON.parse(match[1])).filter((entry) => typeof entry[1] === 'string')
    .map((entry) => entry[1]).join('')
  // Extract balanced JSON objects from Next's public server-rendered pricing data.
  const prices = new Map()
  for (const match of chunks.matchAll(/\{"id":"([^"\n]+)","name":/g)) {
    let depth = 0, quoted = false, escaped = false
    for (let i = match.index; i < chunks.length; i++) {
      const ch = chunks[i]
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false }
      else if (ch === '"') quoted = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        const item = JSON.parse(chunks.slice(match.index, i + 1))
        if (item.pricing?.unit === 'usd_per_million_tokens') prices.set(item.id, item.pricing)
        break
      }
    }
  }
  return prices
}

// Called only by a file-backed CJS import bridge inside the actual Nomi main process.
export async function createMainProbe() {
  if (!process.versions.electron) throw new Error('electron-required')
  const require = createRequire(import.meta.url)
  const { app } = require('electron')
  await app.whenReady()
  const { readCatalog } = require(path.join(root, 'dist-electron/catalog/catalogStore.js'))
  const { decryptApiKeyRecord } = require(path.join(root, 'dist-electron/catalog/secrets.js'))
  const catalog = readCatalog()
  const record = catalog.apiKeysByVendor?.apimart
  const key = record?.enabled !== false ? decryptApiKeyRecord(record) : ''
  if (!key) throw new Error('application-credential-unavailable')
  const { openProbeLane, PROBE_CONTEXT: context } = await import(pathToFileURL(path.join(root,
    '.tmp/agent-runtime-tests/tests/agent-runtime/stage3ProbeHarness.mjs')).href)
  const { LANE_MODEL_TOOL_CATALOG } = await import(pathToFileURL(path.join(root,
    '.tmp/agent-runtime-tests/electron/agentLane/laneToolCatalog.js')).href)
  const { laneToolMenu, LANE_TOOL_REQUEST_TOOL_NAME } = await import(pathToFileURL(path.join(root,
    '.tmp/agent-runtime-tests/electron/agentLane/laneToolGroups.mjs')).href)
  const { createCodingTools, createReadOnlyTools } = await import('@earendil-works/pi-coding-agent')
  const sourceFetch = globalThis.fetch
  const report = { startedAt: new Date().toISOString(), budgetCny: BUDGET_CNY, budgetCnyPerUsd: CNY_PER_USD,
    credential: 'decrypted-in-isolated-electron', requests: [], rows: [], prices: {},
    apiNotRun: { 'openai-codex-responses': 'APIMart API key does not provide native Codex OAuth transport' } }
  const getBalance = async () => {
    const response = await sourceFetch('https://api.apimart.ai/v1/balance', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
    })
    const data = await response.json()
    if (!response.ok || !data.success || number(data.used_balance) === null || number(data.used_credits) === null
      || Math.abs(data.used_credits - data.used_balance * 10) > 0.00001) throw new Error('balance-unit-unverified')
    return data.used_balance
  }
  const currentBalance = await getBalance()
  const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { initialBalance: currentBalance }
  const before = budget.initialBalance
  if (number(before) === null || currentBalance < before) throw new Error('budget-ledger-invalid')
  fs.writeFileSync(budgetFile, JSON.stringify(budget, null, 2))
  let spentUsd = currentBalance - before
  let usageUpperUsd = budget.usageUpperUsd ?? 0
  if (number(usageUpperUsd) === null || usageUpperUsd < 0) throw new Error('budget-ledger-invalid')
  const refreshCost = async () => {
    spentUsd = Math.max(spentUsd, (await getBalance()) - before)
    report.billedUsd = spentUsd
    report.billedCnyAtBudgetRate = spentUsd * CNY_PER_USD
    report.accountingUpperCny = Math.max(spentUsd, usageUpperUsd) * CNY_PER_USD
  }
  const priceResponse = await sourceFetch('https://apimart.ai/pricing', { signal: AbortSignal.timeout(20_000) })
  if (!priceResponse.ok) throw new Error('public-pricing-unavailable')
  const prices = modelPrices(await priceResponse.text())
  const modelsResponse = await sourceFetch('https://api.apimart.ai/v1/models?expand=category&category=chat', {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
  })
  const available = (await modelsResponse.json()).data
  if (!modelsResponse.ok || !Array.isArray(available)) throw new Error('account-models-unavailable')
  async function runTransport(api) {
    const transport = transports.find((entry) => entry.api === api)
    if (!transport) throw new Error('unsupported-probe-transport')
    if (report.rows.some((row) => row.api === api)) throw new Error('no-paid-replays')
    const pricing = prices.get(transport.model)
    if (!pricing || !available.some((model) => model.id === transport.model)) throw new Error('model-price-unavailable')
    report.prices[api] = { model: transport.model, group: pricing.group, rates: pricing.rates,
      effectiveRates: pricing.effective_rates, source: 'https://apimart.ai/pricing' }
    // Haiku's default-group price is corroborated by the calibration debit;
    // the OpenAI control reserves the undiscounted rate (observed billing differs).
    const rates = api === 'anthropic-messages' ? pricing.effective_rates : pricing.rates
    const inputRate = Math.max(rates.input, rates.cache_write_5m ?? 0)
    const outputRate = rates.output
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('price-unavailable')
    const projectDir = path.join(process.env.NOMI_PROJECTS_DIR, api)
    fs.mkdirSync(projectDir, { recursive: true })
    const deny = async () => { throw new Error('probe-tool-execution-disabled') }
    const specs = LANE_MODEL_TOOL_CATALOG.map((spec) => ({ ...spec, execute: deny }))
    const cleanup = []
    let turn = 0, sentThisTurn = false, latestPayload, blockedReason
    let probe, stage = 'open-probe-lane'
    const rawUsageReads = []
    try {
      probe = await openProbeLane({ after: (fn) => cleanup.push(fn) }, {
        projectDir, systemPrompt: 'Reply OK only. Do not call tools. Do not explain or think.', tools: specs,
        model: { kind: transport.kind, providerId: 'apimart', modelId: transport.model,
          baseURL: 'https://api.apimart.ai/v1', authType: 'api-key', apiKey: key,
          contextWindow: 128000, maxOutputTokens: MAX_OUTPUT, reasoning: false },
      }, { beforeTool: () => ({ block: { reason: 'Probe: tools are disabled.', terminate: true } }),
        wrapProvider: (provider) => ({ ...provider,
          streamSimple: (model, ctx, options) => provider.streamSimple(model, ctx, { ...options,
            maxRetries: 0, sessionId: `${probe.sessionId}-${api}`, cacheRetention: 'short',
            onPayload: async (body) => {
              // Literal API knobs only; schema, order and cache markers remain pi's output.
              if (transport.model === 'gpt-5-nano') {
                if (api === 'openai-responses') body.reasoning = { effort: 'minimal' }
                else { delete body.max_tokens; body.max_completion_tokens = MAX_OUTPUT; body.reasoning_effort = 'minimal' }
              }
              latestPayload = body
              return options?.onPayload ? (await options.onPayload(body, model)) ?? body : body
            },
            fetch: async (input, init) => {
              const request = new Request(input, init)
              const url = new URL(request.url)
              if (url.origin !== 'https://api.apimart.ai'
                || !['/v1/messages', '/v1/responses', '/v1/chat/completions'].includes(url.pathname)) {
                blockedReason = 'unexpected-endpoint'; throw new Error(blockedReason)
              }
              if (sentThisTurn) { blockedReason = 'extra-request-disabled'; throw new Error(blockedReason) }
              // UTF-8 bytes bound byte-based tokenization; +4096 reserves protocol wrappers.
              // Count the entire JSON body (including non-input knobs), not chars/4 estimates.
              const bodyBytes = Buffer.byteLength(await request.clone().text())
              // A previous measured, identical initial menu calibrates this fixed append-only sequence.
              // New coding schemas/history are bounded by their added UTF-8 bytes, plus 512 incremental wrapper tokens (cold start: 4096).
              const toolsHash = createHash('sha256').update(JSON.stringify(latestPayload.tools)).digest('hex')
              const anchor = budget.calibration?.[api]
              const initialHash = report.requests.find((entry) => entry.api === api && entry.turn === 1)?.toolsSha256
              const calibrated = anchor?.model === transport.model && bodyBytes >= anchor.bodyBytes
                && (turn === 1 ? toolsHash === anchor.toolsSha256 : initialHash === anchor.toolsSha256)
              const inputBound = (calibrated ? anchor.inputTokens + bodyBytes - anchor.bodyBytes : bodyBytes) + (calibrated ? 512 : 4096)
              const reserveUsd = (inputBound * inputRate + MAX_OUTPUT * outputRate) / 1e6
              await refreshCost()
              if ((Math.max(spentUsd, usageUpperUsd) + reserveUsd) * CNY_PER_USD > BUDGET_CNY) {
                blockedReason = 'remaining-budget-below-cold-byte-bound'; throw new Error(blockedReason)
              }
              sentThisTurn = true
              const wire = { api, turn, bodyBytes, reserveCny: reserveUsd * CNY_PER_USD,
                inputBound, calibration: calibrated ? anchor.source : null,
                topLevelTools: (latestPayload.tools ?? []).map((tool) => tool.name ?? tool.function?.name),
                toolsSha256: createHash('sha256').update(JSON.stringify(latestPayload.tools)).digest('hex'),
                deferredCount: (latestPayload.tools ?? []).filter((tool) => tool.defer_loading).length,
                additionalTools: (latestPayload.input ?? []).filter((item) => item.type === 'additional_tools').length,
                cacheMarkers: (JSON.stringify(latestPayload).match(/"cache_control"/g) ?? []).length,
                rawUsage: [] }
              report.requests.push(wire)
              const response = await sourceFetch(request, { redirect: 'error' })
              wire.httpStatus = response.status
              rawUsageReads.push(response.clone().text().then((body) => {
                for (const line of body.split('\n')) {
                  const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
                  if (!text.startsWith('{')) continue
                  try {
                    const event = JSON.parse(text)
                    const raw = event.usage ?? event.message?.usage ?? event.response?.usage
                    if (raw) wire.rawUsage.push(safeUsage(raw))
                  } catch { /* Non-JSON SSE metadata carries no usage. */ }
                }
              }).catch(() => { wire.usageReadFailed = true }))
              return response
            },
          }),
        }),
      })
      stage = 'configure-lane'
      await probe.harness.setRetryPolicy({ enabled: false, maxRetries: 0, baseDelayMs: 0 }, context)
      await probe.harness.setStreamOptions({ transport: 'sse', timeoutMs: 60_000, maxRetries: 0, cacheRetention: 'short' }, context)
      const locked = laneToolMenu({ unlocked: [] }).activeToolNames
      const unlocked = laneToolMenu({ unlocked: ['user-supplied-code'] }).activeToolNames
      const coding = new Map([...createCodingTools(projectDir), ...createReadOnlyTools(projectDir)]
        .map((tool) => [tool.name, { ...tool, execute: deny }]))
      const unlock = { name: LANE_TOOL_REQUEST_TOOL_NAME, label: LANE_TOOL_REQUEST_TOOL_NAME,
        description: 'Unlock the coding tool group.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }, execute: deny }
      await probe.harness.setTools([...(await probe.harness.getTools(context)), unlock, ...coding.values()], context)
      await probe.lane.setActiveTools([...locked], context)
      const prompts = ['Reply OK.', 'Attached probe.js:\n```js\nconst n = 1;\n```\nReply OK. Do not run it.', 'Thanks. Reply OK.']
      let stopped
      for (turn = 1; turn <= 3; turn++) {
        const row = { api, model: transport.model, turn, sessionId: probe.sessionId,
          status: 'unmeasured', input: null, output: null, cacheRead: null, cacheWrite: null }
        report.rows.push(row)
        if (stopped) { row.reason = stopped; continue }
        if (turn === 2) await probe.lane.setActiveTools([...unlocked], context)
        row.activeTools = await probe.lane.getActiveTools(context)
        if (JSON.stringify(row.activeTools) !== JSON.stringify(turn === 1 ? locked : unlocked)) throw new Error('menu-mismatch')
        sentThisTurn = false
        blockedReason = undefined
        stage = 'prompt'
        await probe.lane.prompt(prompts[turn - 1], undefined, context)
        stage = 'usage-read'
        await Promise.all(rawUsageReads)
        await refreshCost()
        const entries = await probe.lane.findEntries(undefined, context)
        const assistants = entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant')
          .sort((a, b) => a.seq - b.seq)
        const message = assistants.at(-1)?.message
        row.piUsage = sentThisTurn ? piUsage(message?.usage) : piUsage(null)
        row.stopReason = message?.stopReason
        row.laneStats = (await probe.lane.watch(context)).snapshot.stats
        row.billedUsdCumulative = spentUsd
        const wire = report.requests.findLast((entry) => entry.api === api && entry.turn === turn)
        row.httpStatus = wire?.httpStatus ?? null
        if (blockedReason || !wire || wire.httpStatus !== 200 || !wire.rawUsage.length || message?.stopReason === 'error') {
          row.reason = blockedReason ?? (wire ? `http-${wire.httpStatus ?? 'network-failed'}-or-missing-usage` : 'no-request')
          stopped = row.reason
          continue
        }
        const raw = Object.assign({}, ...wire.rawUsage)
        row.input = api === 'anthropic-messages' ? number(raw.input_tokens)
          : number((raw.input_tokens ?? raw.prompt_tokens) - (raw.input_tokens_details ?? raw.prompt_tokens_details)?.cached_tokens)
        row.output = number(api === 'openai-completions' ? raw.completion_tokens : raw.output_tokens)
        row.cacheRead = number(api === 'anthropic-messages' ? raw.cache_read_input_tokens
          : (raw.input_tokens_details ?? raw.prompt_tokens_details)?.cached_tokens)
        row.cacheWrite = number(api === 'anthropic-messages' ? raw.cache_creation_input_tokens
          : (raw.input_tokens_details ?? raw.prompt_tokens_details)?.cache_write_tokens)
        if (row.input !== row.piUsage.input || row.output !== row.piUsage.output
          || row.cacheRead !== row.piUsage.cacheRead || (row.cacheWrite !== null && row.cacheWrite !== row.piUsage.cacheWrite)) {
          throw new Error('raw-versus-pi-usage-mismatch')
        }
        row.status = 'measured'
        const inputTokens = row.piUsage.input + row.piUsage.cacheRead + row.piUsage.cacheWrite
        usageUpperUsd += (row.piUsage.input * rates.input + row.piUsage.cacheRead * (rates.cached_input ?? rates.input)
          + row.piUsage.cacheWrite * (rates.cache_write_5m ?? rates.input) + row.piUsage.output * outputRate) / 1e6 + 0.00001
        budget.usageUpperUsd = usageUpperUsd
        if (api === 'anthropic-messages') {
          budget.calibration ??= {}
          budget.calibration[api] = { model: transport.model, bodyBytes: wire.bodyBytes,
            toolsSha256: report.requests.find((entry) => entry.api === api)?.toolsSha256, inputTokens, source: report.startedAt }
        }
        fs.writeFileSync(budgetFile, JSON.stringify(budget, null, 2))
      }
      return report.rows.filter((row) => row.api === api)
    } catch {
      report.rows.push({ api, turn, status: 'unmeasured', reason: blockedReason ?? `probe-${stage}-failed` })
      return report.rows.filter((row) => row.api === api)
    } finally {
      for (const close of cleanup.reverse()) await close()
      await refreshCost()
    }
  }
  return { runTransport, report: () => report }
}

async function main() {
  if (process.env.CI || process.env.NOMI_AGENT_LIVE !== '1') throw new Error('manual-paid-opt-in-required')
  const { prepareIsolation } = await import('../../evals/lib/isoApp.mjs')
  const { realNomiProfile } = await import('./_realProfile.mjs')
  const { launchNomiApp } = await import('./_launchApp.mjs')
  const realCatalog = realNomiProfile().catalogPath
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-pd1-cache-'))
  const output = path.join(root, '.tmp', `pd1-cache-${Date.now()}.json`)
  const sourceHash = createHash('sha256').update(fs.readFileSync(realCatalog)).digest('hex')
  let launched, report
  try {
    const iso = prepareIsolation(tempRoot)
    const bridge = path.join(tempRoot, 'pd1-import.cjs')
    fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(import.meta.url)}).then(m => m.createMainProbe());`, { mode: 0o600 })
    launched = await launchNomiApp({ name: 'pd1-cache', tempRoot, userDataDir: iso.chromiumDir, ...iso,
      waitForWindow: false, env: { NOMI_SMOKE_NO_WINDOW: '1', NOMI_DISABLE_AUTO_UPDATE: '1' }, args: ['--disable-gpu'] })
    await launched.app.evaluate(async (_electron, bridgePath) => {
      globalThis.__pd1 = await process.mainModule.require(bridgePath)
    }, bridge)
    const args = process.argv.slice(2)
    const selected = args.length === 0 ? transports : args.length === 2 && args[0] === '--transport'
      ? transports.filter((entry) => entry.api === args[1]) : []
    if (!selected.length) throw new Error('invalid-probe-arguments')
    for (const { api } of selected) {
      const rows = await launched.app.evaluate((_electron, name) => globalThis.__pd1.runTransport(name), api)
      console.log(JSON.stringify({ api, rows }))
      report = await launched.app.evaluate(() => globalThis.__pd1.report())
      fs.writeFileSync(output, JSON.stringify(report, null, 2))
    }
  } catch {
    process.exitCode = 1
    console.error('P-D1 stopped: setup/runtime failed; raw exception suppressed.')
  } finally {
    if (launched) await launched.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    const sourceUnchanged = createHash('sha256').update(fs.readFileSync(realCatalog)).digest('hex') === sourceHash
    if (report) {
      report.temporaryCredentialRemoved = !fs.existsSync(tempRoot)
      report.sourceCatalogUnchanged = sourceUnchanged
      if (report.rows.some((row) => row.status !== 'measured')) process.exitCode = 1
      fs.writeFileSync(output, JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ output, billedUsd: report.billedUsd, billedCnyAtBudgetRate: report.billedCnyAtBudgetRate,
        temporaryCredentialRemoved: report.temporaryCredentialRemoved, sourceCatalogUnchanged: sourceUnchanged }))
    }
    if (!sourceUnchanged) process.exitCode = 1
  }
}
if (!process.versions.electron && process.argv[1] === fileURLToPath(import.meta.url)) await main()
