#!/usr/bin/env node
// C72: one isolated production single-shot planner call. No user catalog or media API is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { officialPlannerPrice, requestQuote, textUsageCost, CNY_PER_USD } from './g1/c0-real-budget.mjs'

const MODEL = 'deepseek-v4-pro'
const VENDOR = 'deepseek-official'
const VIDEO = 'MiniMax-H3'
const ANCHOR = 'anchor-xiaohe'
const BUDGET_CNY = 1

/** Loaded inside the owned Electron main process; real credentials never cross IPC. */
export function attachAnchorPlanner({ outputDir, allowPaid }) {
  const require = createRequire(import.meta.url)
  const { app } = require('electron')
  const compiled = path.join(app.getAppPath(), 'dist-electron')
  const settingsDir = process.env.NOMI_SETTINGS_DIR
  assert.ok(settingsDir && path.resolve(settingsDir).startsWith(path.resolve(outputDir) + path.sep))
  const { applyBuiltinSeeds } = require(path.join(compiled, 'catalog/seedBuiltins.js'))
  const { makeApiKeyRecordFromPlain } = require(path.join(compiled, 'catalog/secrets.js'))
  const { CURRENT_CATALOG_VERSION } = require(path.join(compiled, 'catalog/types.js'))
  const { MINIMAX_H3_APIMART_ARCHETYPE: profile } = require(path.join(compiled, 'shared/videoCapabilities/minimaxH3Apimart.js'))
  const now = new Date().toISOString()
  const catalog = applyBuiltinSeeds({ version: CURRENT_CATALOG_VERSION, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, now).state
  catalog.vendors = catalog.vendors.filter(v => v.key === 'apimart').map(v => ({ ...v, enabled: true }))
  catalog.models = catalog.models.filter(m => m.vendorKey === 'apimart' && m.modelKey === VIDEO).map(m => ({ ...m, enabled: true }))
  catalog.mappings = catalog.mappings.filter(m => m.vendorKey === 'apimart' && m.modelKey === VIDEO).map(m => ({ ...m, enabled: true }))
  assert.equal(catalog.models.length, 1)
  assert.ok(catalog.mappings.some(m => m.taskKind === 'image_to_video'))
  const price = officialPlannerPrice(MODEL)
  catalog.vendors.push({ key: VENDOR, name: 'DeepSeek Official', enabled: true, baseUrlHint: 'https://api.deepseek.com', providerKind: 'openai-compatible', authType: 'bearer', createdAt: now, updatedAt: now })
  catalog.models.push({ vendorKey: VENDOR, modelKey: MODEL, labelZh: MODEL, kind: 'text', enabled: true, published: true,
    tokenPricing: { inputPerMTokUsd: price.rates.input, outputPerMTokUsd: price.rates.output, cacheReadPerMTokUsd: price.rates.cached_input }, createdAt: now, updatedAt: now })
  const secret = allowPaid ? process.env.DEEPSEEK_API_KEY : 'synthetic-prepare-only'
  if (!secret) throw Error('ANCHOR_OFFICIAL_CREDENTIAL_REQUIRED')
  catalog.apiKeysByVendor = {
    [VENDOR]: makeApiKeyRecordFromPlain(secret, VENDOR, true, now, now),
    apimart: makeApiKeyRecordFromPlain('synthetic-media-dispatch-disabled', 'apimart', true, now, now),
  }
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(catalog), { mode: 0o600 })
  fs.writeFileSync(path.join(outputDir, 'catalog-evidence.json'), JSON.stringify({ profile, models: catalog.models,
    mappingTaskKinds: catalog.mappings.map(m => m.taskKind), source: 'production applyBuiltinSeeds; no user catalog read', mediaCredential: 'synthetic; all media dispatch refused' }, null, 2))

  const quote = { plannerVendor: VENDOR, plannerPrice: price, models: { text: MODEL }, maxOutputTokens: 8192 }
  const ledger = { budgetCny: BUDGET_CNY, reservedCny: 0, requests: [], denied: [], observed: [] }
  const pending = new Set()
  const save = () => fs.writeFileSync(path.join(outputDir, 'budget-ledger.json'), JSON.stringify(ledger, null, 2), { mode: 0o600 })
  const wrap = send => async (input, init) => {
    const observation = { inputType: typeof input, initFields: Object.keys(init ?? {}) }
    ledger.observed.push(observation); save()
    try {
    const request = new Request(input instanceof Request ? input.clone() : input, init)
    const url = new URL(request.url)
    observation.path = url.pathname
    const body = request.method === 'POST' ? await request.clone().json() : undefined
    observation.bodyFields = Object.keys(body ?? {})
    if (body?.model === MODEL) {
      const bounded = { ...body, max_tokens: Math.min(body.max_tokens ?? quote.maxOutputTokens, quote.maxOutputTokens) }
      observation.inputBytes = Buffer.byteLength(JSON.stringify(bounded))
      observation.reservationCny = (observation.inputBytes * price.rates.input + bounded.max_tokens * price.rates.output) / 1e6 * CNY_PER_USD
    }
    if (!allowPaid || request.method !== 'POST' || url.origin !== 'https://api.deepseek.com' || !['/v1/chat/completions', '/chat/completions'].includes(url.pathname)) {
      ledger.denied.push({ method: request.method, origin: url.origin, path: url.pathname }); save()
      throw Error('ANCHOR_PLANNING_ONLY_OUTBOUND_REFUSED')
    }
    if (body.model !== MODEL || body.max_completion_tokens !== undefined) throw Error('ANCHOR_PLANNER_MODEL_REFUSED')
    body.max_tokens = Math.min(body.max_tokens ?? quote.maxOutputTokens, quote.maxOutputTokens)
    // Bound output to what remains after the conservative serialized-input reserve.
    // This changes only the test request's output limit, never model-visible tools/content.
    const inputUpperUsd = Buffer.byteLength(JSON.stringify(body)) * price.rates.input / 1e6
    const affordableOutput = Math.floor(((BUDGET_CNY - ledger.reservedCny) / CNY_PER_USD - inputUpperUsd) * 1e6 / price.rates.output)
    if (affordableOutput < 1) throw Error('ANCHOR_INPUT_EXCEEDS_REMAINING_BUDGET')
    body.max_tokens = Math.min(body.max_tokens, affordableOutput)
    if (ledger.requests.length) throw Error('ANCHOR_SINGLE_OFFICIAL_REQUEST_ONLY')
    const entry = requestQuote(request.url, request.method, body, quote)
    const reserve = ledger.reservedCny + entry.upperUsd * CNY_PER_USD
    if (!Number.isFinite(reserve) || reserve > BUDGET_CNY) throw Error('ANCHOR_BUDGET_REFUSED')
    const row = { ...entry, started: new Date().toISOString(), requestNumber: ledger.requests.length + 1 }
    ledger.requests.push(row)
    ledger.reservedCny = reserve
    fs.writeFileSync(path.join(outputDir, `request-${row.requestNumber}.json`), JSON.stringify(body, null, 2), { mode: 0o600 })
    save()
    try {
      const response = await send(request.url, { method: 'POST', headers: request.headers, signal: request.signal, body: JSON.stringify(body), redirect: 'error' })
      row.httpStatus = response.status
      const drain = response.clone().text().then(text => {
        // Provider payload only. Authorization headers and environment are never serialized.
        fs.writeFileSync(path.join(outputDir, `response-${row.requestNumber}.txt`), text.split(secret).join('[REDACTED]'), { mode: 0o600 })
        let chunks
        try { chunks = [JSON.parse(text)] } catch { chunks = text.split('\n').filter(line => line.startsWith('data:') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(5))) }
        row.usage = chunks.map(chunk => chunk.usage).filter(Boolean).at(-1)
        row.costCny = textUsageCost(row.usage, price)
        ledger.reservedCny += row.costCny - row.upperUsd * CNY_PER_USD
        save()
      }).catch(() => { row.usageError = 'ANCHOR_USAGE_UNAVAILABLE'; save() })
      pending.add(drain)
      void drain.finally(() => pending.delete(drain))
      save()
      return response
    } catch { row.transportFailed = true; save(); throw Error('ANCHOR_PROVIDER_REQUEST_FAILED') }
    } catch (error) {
      observation.error = String(error.message ?? error).split(secret).join('[REDACTED]')
      save()
      throw error
    }
  }
  const transport = require(path.join(compiled, 'appFetch.js'))
  transport.appFetch = wrap(transport.appFetch)
  globalThis.fetch = wrap(globalThis.fetch)
  save()
  return {
    async snapshot() { await Promise.all([...pending]); save(); return ledger },
  }
}

export function scoreAnchorPlan(plan, profile, referenceUrl) {
  const rows = (plan?.shots ?? []).map(shot => {
    const mode = profile.modes.find(m => m.id === (shot.modeId ?? profile.defaultModeId))
    const slots = mode?.slots.filter(s => ['image_ref', 'first_frame'].includes(s.kind)) ?? []
    const bound = slots.some(slot => (shot.referenceBindings?.[slot.kind] ?? []).some(b => b.anchorId === ANCHOR && b.url === referenceUrl))
    return { index: shot.index, modeId: shot.modeId ?? null, consumesReference: slots.length > 0,
      anchorBound: bound, referencesAnchor: shot.anchorIds?.includes(ANCHOR) === true }
  })
  return { total: rows.length, consuming: rows.filter(r => r.consumesReference).length,
    bound: rows.filter(r => r.anchorBound && r.referencesAnchor).length, rows }
}

async function run() {
  const { parseArgs } = await import('node:util')
  const { values } = parseArgs({ options: { prepare: { type: 'boolean' }, 'run-official': { type: 'boolean' }, 'output-dir': { type: 'string' }, 'replay-output': { type: 'string' } } })
  if (values['replay-output']) {
    if (values.prepare || values['run-official'] || values['output-dir']) throw Error('Replay accepts only --replay-output <official-evidence-directory>')
    return replayOfficialOutput(path.resolve(values['replay-output']))
  }
  if (Boolean(values.prepare) === Boolean(values['run-official'])) throw Error('Usage: node tests/ux/anchor-real-planner.mjs (--prepare | --run-official) [--output-dir /absolute/path]')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const outputDir = values['output-dir'] ? path.resolve(values['output-dir']) : fs.mkdtempSync(path.join(root, '.tmp/anchor-real-planner-'))
  fs.mkdirSync(outputDir, { recursive: true })
  const lock = fs.openSync(path.join(outputDir, 'attempt.lock'), 'wx', 0o600)
  fs.closeSync(lock) // A paid attempt is never silently repeated into the same evidence directory.
  const profileDir = path.join(outputDir, 'profile')
  const settingsDir = path.join(profileDir, 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  const { launchNomiApp } = await import('./_launchApp.mjs')
  const { expect, screenshotSettled } = await import('./_assert.mjs')
  const { DOCUMENT, readProject, stopRuntimeApp } = await import('./agent-runtime-walk-support.mjs')
  const { stationTimeout } = await import('./_station-budget.mjs')
  const { createServer } = await import('vite')
  const report = { mode: values.prepare ? 'prepare-no-network' : 'official-single-shot-planning',
    scope: 'Real runStoryboardPlanner -> pi singleShot; then real propose_storyboard_plan write. Not a resident multi-tool turn; no native lane JSONL is expected.',
    budgetCny: BUDGET_CNY, outputDir, paidCalls: 0, mediaCalls: 0, result: 'running', platform: `${os.platform()} ${os.arch()}` }
  let launched, server
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
    await server.listen()
    const address = server.httpServer.address()
    const rendererUrl = `http://127.0.0.1:${address.port}`
    launched = await launchNomiApp({ name: 'anchor-real-planner', tempRoot: profileDir, settingsDir, settleMs: 0,
      env: { NOMI_RENDERER_URL: rendererUrl, VITE_DEV_SERVER_URL: rendererUrl, NOMI_DESKTOP_DEV: '1', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
      initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
        'nomi.assistantModel': JSON.stringify({ vendorKey: VENDOR, modelKey: MODEL }) }, args: ['--no-proxy-server'] })
    const { app, win } = launched
    const bridge = path.join(profileDir, 'anchor-main.cjs')
    fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(import.meta.url)});`, { mode: 0o600 })
    await app.evaluate(async (_electron, options) => {
      const module = await process.mainModule.require(options.bridge)
      globalThis.__anchorPlanner = module.attachAnchorPlanner(options)
    }, { bridge, outputDir, allowPaid: Boolean(values['run-official']) })
    fs.rmSync(bridge)
    await win.reload({ waitUntil: 'domcontentloaded' })
    expect(await win.evaluate(() => window.nomiDesktop.projects.listAsync())).toEqual([])
    await win.getByRole('button', { name: /^新建空白项目/ }).click()
    await expect(win.locator(DOCUMENT)).toBeVisible()
    const available = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels())
    assert.ok(available.some(m => m.vendorKey === VENDOR && m.modelKey === MODEL && m.published))
    assert.ok(available.some(m => m.vendorKey === 'apimart' && m.modelKey === VIDEO && m.publishedModes.includes('image_to_video')))
    const [project] = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    assert.ok(project.rootPath.startsWith(launched.projectsDir + path.sep))
    report.projectRoot = project.rootPath
    const imagePath = path.join(project.rootPath, 'anchor-xiaohe.png')
    const png = await win.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 384
      const c = canvas.getContext('2d'); c.fillStyle = '#eee7db'; c.fillRect(0, 0, 256, 384)
      c.fillStyle = '#303039'; c.fillRect(87, 245, 34, 110); c.fillRect(135, 245, 34, 110)
      c.fillStyle = '#588576'; c.fillRect(67, 125, 122, 145)
      c.fillStyle = '#e2b692'; c.beginPath(); c.ellipse(128, 79, 42, 52, 0, 0, Math.PI * 2); c.fill()
      c.fillStyle = '#2b2626'; c.beginPath(); c.ellipse(128, 49, 44, 24, 0, 0, Math.PI * 2); c.fill()
      c.fillRect(108, 77, 5, 5); c.fillRect(144, 77, 5, 5)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    fs.writeFileSync(imagePath, Buffer.from(png, 'base64'))
    const referenceUrl = await app.evaluate(async ({ app: mainApp }, input) => {
      const importer = process.mainModule.require(`${mainApp.getAppPath()}/dist-electron/assets/localFileImport.js`)
      const asset = await importer.importLocalFile({ projectId: input.projectId, sourcePath: input.imagePath,
        fileName: 'anchor-xiaohe.png', contentType: 'image/png' }, { allowSourcePath: true })
      return asset.data.url
    }, { projectId: project.id, imagePath })
    assert.ok(referenceUrl.startsWith('nomi-local://asset/'))
    const anchor = { id: ANCHOR, kind: 'character', name: '小禾', carrier: 'visual', scope: 'selective', description: '短黑发，绿色上衣，深色裤子', referenceKind: 'image', referenceUrl }
    const input = `请用故事板规划师为《出门散步》规划恰好 8 个视频镜头，每镜 8 秒，16:9，APIMart 的 MiniMax-H3，768P。只保存分镜草稿，绝不生成媒体。\n小禾出门、关门、走下楼梯、走过街角、经过树下、坐在长椅、起身、回家。每镜都有同一位小禾。\n已有角色参考图：${JSON.stringify(anchor)}\n请复用这个角色锚及原有 id、URL，默认采用该模型能消费角色参考图的模式，每镜参考槽绑定它；不用创建新锚图。不要调用生图或生视频工具。`
    fs.writeFileSync(path.join(outputDir, 'input.md'), input)
    const { profile } = JSON.parse(fs.readFileSync(path.join(outputDir, 'catalog-evidence.json'), 'utf8'))
    await screenshotSettled(win, { path: path.join(outputDir, 'before.png') })
    const result = await win.evaluate(async ({ projectId, storyText, prepare }) => {
      const { runStoryboardPlanner } = await import('/src/workbench/generationCanvas/agent/runStoryboardPlanner.ts')
      const { readGenerationCanvasSnapshot } = await import('/src/workbench/generationCanvas/agent/generationCanvasTools.ts')
      const { captureCanvasReadResult } = await import('/src/workbench/generationCanvas/agent/canvasReadResultSeal.ts')
      const { captureCurrentProjectCanvasReadSurfaceBinding, sealCurrentProjectCanvasReadSnapshot } = await import('/src/workbench/project/projectCanvasReadSurface.ts')
      const snapshot = captureCanvasReadResult({ ...readGenerationCanvasSnapshot(), selectedNodeIds: [] })
      const binding = captureCurrentProjectCanvasReadSurfaceBinding()
      if (!binding) throw Error('ANCHOR_CANVAS_SURFACE_NOT_READY')
      const capturedCanvasReadSnapshot = await sealCurrentProjectCanvasReadSnapshot(binding, snapshot)
      try {
        return await runStoryboardPlanner({ target: 'production', projectId, shotMode: 'video', storyText,
          snapshot, capturedCanvasReadSnapshot, canWrite: () => true })
      } catch (error) {
        if (!prepare) throw error
        return { preflightError: String(error.message ?? error) }
      }
    }, { projectId: project.id, storyText: input, prepare: Boolean(values.prepare) })
    fs.writeFileSync(path.join(outputDir, 'planner-result.json'), JSON.stringify(result, null, 2))
    if (values.prepare) {
      const ledger = await app.evaluate(() => globalThis.__anchorPlanner.snapshot())
      assert.equal(ledger.requests.length, 0)
      assert.ok(ledger.observed.some(row => row.bodyFields?.includes('messages')), 'Preflight must reach real provider fetch')
      report.result = 'prepared'; return
    }
    assert.equal(result.status, 'finished')
    const rawText = result.text.trim()
    const raw = JSON.parse(rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? rawText)
    fs.writeFileSync(path.join(outputDir, 'raw-plan.json'), JSON.stringify(raw, null, 2))
    report.raw = scoreAnchorPlan(raw, profile, referenceUrl)
    report.normalized = scoreAnchorPlan(result.plan, profile, referenceUrl)
    const receipt = await win.evaluate(async plan => {
      const { applyCanvasToolCall } = await import('/src/workbench/generationCanvas/agent/applyCanvasToolCall.ts')
      return applyCanvasToolCall('propose_storyboard_plan', plan)
    }, result.plan)
    fs.writeFileSync(path.join(outputDir, 'write-receipt.json'), JSON.stringify(receipt, null, 2))
    await expect.poll(async () => {
      const p = (await readProject(win, project.id)).payload
      return p.storyboardDesignsByDocumentId?.[p.activeDocumentId]?.[0]?.plan?.shots?.length
    }, { timeout: stationTimeout({ turns: 1, operations: 2 }) }).toBe(8)
    const payload = (await readProject(win, project.id)).payload
    const plan = payload.storyboardDesignsByDocumentId[payload.activeDocumentId][0].plan
    assert.deepEqual(plan, result.plan, 'The second production write must preserve the normalized planner IR')
    report.persisted = scoreAnchorPlan(plan, profile, referenceUrl)
    fs.writeFileSync(path.join(outputDir, 'persisted-plan.json'), JSON.stringify(plan, null, 2))
    await win.locator('[data-storyboard-id]').first().click()
    await screenshotSettled(win, { path: path.join(outputDir, 'after.png') })
    assert.equal(report.persisted.total, 8)
    assert.equal(report.persisted.consuming, 8)
    assert.equal(report.persisted.bound, 8)
    report.result = 'passed'
  } catch (error) {
    report.result = 'failed'
    report.error = String(error.stack ?? error).split(process.env.DEEPSEEK_API_KEY || '\0').join('[REDACTED]')
    process.exitCode = 1
  } finally {
    if (launched) {
      try {
        const ledger = await launched.app.evaluate(() => globalThis.__anchorPlanner.snapshot())
        report.paidCalls = ledger.requests.length
        report.costCny = ledger.requests.reduce((sum, row) => sum + (row.costCny ?? row.upperUsd * CNY_PER_USD), 0)
        report.usageVerified = ledger.requests.every(row => row.costCny !== undefined && !row.usageError)
        if (report.costCny > BUDGET_CNY || !report.usageVerified) { report.result = 'failed'; process.exitCode = 1 }
      } catch { report.billingError = 'Could not read isolated main-process ledger'; report.result = 'failed'; process.exitCode = 1 }
      await stopRuntimeApp(launched.app).catch(() => { report.cleanupError = true; process.exitCode = 1 })
    }
    await server?.close()
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
}

/** Zero-network remediation replay; the original official result/report remain untouched. */
async function replayOfficialOutput(sourceDir) {
  const originalReport = JSON.parse(fs.readFileSync(path.join(sourceDir, 'report.json'), 'utf8'))
  const originalLedger = JSON.parse(fs.readFileSync(path.join(sourceDir, 'budget-ledger.json'), 'utf8'))
  assert.equal(originalLedger.requests.length, 1)
  assert.equal(originalLedger.requests[0].httpStatus, 200)
  const originalText = fs.readFileSync(path.join(sourceDir, 'model-original.txt'), 'utf8').trim()
  const raw = JSON.parse(originalText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? originalText)
  const referenceUrl = raw.anchors.find(anchor => anchor.id === ANCHOR)?.referenceUrl
  assert.ok(referenceUrl?.startsWith('nomi-local://asset/'))
  const projectRoot = originalReport.projectRoot
  assert.ok(path.resolve(projectRoot).startsWith(path.join(sourceDir, 'profile', 'projects') + path.sep))
  let outputDir = path.join(sourceDir, 'replay-after-fix')
  for (let suffix = 2; fs.existsSync(path.join(outputDir, 'attempt.lock')); suffix += 1) outputDir = path.join(sourceDir, `replay-after-fix-${suffix}`)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.closeSync(fs.openSync(path.join(outputDir, 'attempt.lock'), 'wx', 0o600))
  const { createServer } = await import('vite')
  const { launchNomiApp } = await import('./_launchApp.mjs')
  const { expect, screenshotSettled } = await import('./_assert.mjs')
  const { DOCUMENT, readProject, stopRuntimeApp } = await import('./agent-runtime-walk-support.mjs')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const tempRoot = path.join(outputDir, 'profile')
  const settingsDir = path.join(tempRoot, 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  const report = { mode: 'zero-network-replay-of-official-output', sourceDir, outputDir, projectRoot,
    scope: 'Original single official response, replayed through production parse + normalization + real propose_storyboard_plan write; no new model request.',
    originalPaidCalls: 1, originalCostCny: originalReport.costCny, paidCalls: 0, costCny: 0, result: 'running' }
  let server, launched
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' })
    await server.listen()
    const rendererUrl = `http://127.0.0.1:${server.httpServer.address().port}`
    launched = await launchNomiApp({ name: 'anchor-real-replay', tempRoot, settingsDir, projectsDir: path.dirname(projectRoot), settleMs: 0,
      env: { NOMI_RENDERER_URL: rendererUrl, VITE_DEV_SERVER_URL: rendererUrl, NOMI_DESKTOP_DEV: '1', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
      initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' }, args: ['--no-proxy-server'] })
    const { app, win } = launched
    const bridge = path.join(tempRoot, 'replay-main.cjs')
    fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(import.meta.url)});`, { mode: 0o600 })
    await app.evaluate(async (_electron, options) => {
      const module = await process.mainModule.require(options.bridge)
      globalThis.__anchorPlanner = module.attachAnchorPlanner(options)
    }, { bridge, outputDir, allowPaid: false })
    fs.rmSync(bridge)
    await win.reload({ waitUntil: 'domcontentloaded' })
    const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    const project = projects.find(item => item.rootPath === projectRoot)
    assert.ok(project)
    await win.locator('[data-project-card]').filter({ hasText: project.name }).dblclick()
    await win.getByRole('button', { name: '创作', exact: true }).click()
    await win.locator('[data-creation-resource-tree] [data-document-id]:not([data-storyboard-id])').first().click()
    await expect(win.locator(DOCUMENT)).toBeVisible()
    await screenshotSettled(win, { path: path.join(outputDir, 'before.png') })
    const profile = JSON.parse(fs.readFileSync(path.join(outputDir, 'catalog-evidence.json'), 'utf8')).profile
    report.raw = scoreAnchorPlan(raw, profile, referenceUrl)
    fs.writeFileSync(path.join(outputDir, 'raw-plan.json'), JSON.stringify(raw, null, 2))
    const result = await win.evaluate(async plan => {
      const { parseStoryboardPlan } = await import('/src/workbench/generationCanvas/agent/storyboardPlanSchema.ts')
      const { normalizeStoryboardAnchorDefaults } = await import('/src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts')
      const { listAvailableModelsForAgent } = await import('/src/workbench/generationCanvas/agent/availableModels.ts')
      const { applyCanvasToolCall } = await import('/src/workbench/generationCanvas/agent/applyCanvasToolCall.ts')
      const parsed = parseStoryboardPlan(plan)
      const normalized = normalizeStoryboardAnchorDefaults(parsed, await listAvailableModelsForAgent())
      const receipt = await applyCanvasToolCall('propose_storyboard_plan', normalized)
      return { normalized, receipt }
    }, raw)
    report.normalized = scoreAnchorPlan(result.normalized, profile, referenceUrl)
    fs.writeFileSync(path.join(outputDir, 'write-result.json'), JSON.stringify(result, null, 2))
    await expect.poll(async () => {
      const payload = (await readProject(win, project.id)).payload
      return Object.values(payload.storyboardDesignsByDocumentId ?? {}).flat().find(design => design.id === result.receipt.storyboardDesignId)?.plan?.shots?.length
    }).toBe(8)
    const payload = (await readProject(win, project.id)).payload
    const persisted = Object.values(payload.storyboardDesignsByDocumentId).flat().find(design => design.id === result.receipt.storyboardDesignId).plan
    assert.deepEqual(persisted, result.normalized)
    report.persisted = scoreAnchorPlan(persisted, profile, referenceUrl)
    fs.writeFileSync(path.join(outputDir, 'persisted-plan.json'), JSON.stringify(persisted, null, 2))
    await win.locator(`[data-storyboard-id="${result.receipt.storyboardDesignId}"]`).click()
    await expect(win.locator('[data-storyboard-editor="true"]')).toBeVisible()
    const collapsePanel = win.getByRole('button', { name: '收起面板', exact: true })
    // Panel preference is stored in this same isolated project and may already be collapsed.
    if (await collapsePanel.isVisible()) await collapsePanel.click()
    await win.getByRole('button', { name: '全部展开', exact: true }).click()
    await screenshotSettled(win, { path: path.join(outputDir, 'after.png') })
    await expect(win.getByRole('button', { name: '生成未生成的 8 镜', exact: true })).toBeEnabled()
    for (const index of [1, 3, 5, 7, 8]) {
      await win.locator(`[data-storyboard-editor="true"] [data-storyboard-row="${index}"]`).scrollIntoViewIfNeeded()
      await screenshotSettled(win, { path: path.join(outputDir, `after-row-${index}.png`) })
    }
    for (const key of ['total', 'consuming', 'bound']) assert.equal(report.persisted[key], 8)
    report.result = 'passed'
  } catch (error) {
    report.result = 'failed'
    report.error = String(error.stack ?? error).split(process.env.DEEPSEEK_API_KEY || '\0').join('[REDACTED]')
    process.exitCode = 1
    await launched?.win.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {})
  } finally {
    if (launched) {
      const ledger = await launched.app.evaluate(() => globalThis.__anchorPlanner.snapshot()).catch(() => null)
      if (!ledger || ledger.requests.length) { report.result = 'failed'; process.exitCode = 1 }
      await stopRuntimeApp(launched.app).catch(() => { report.cleanupError = true; process.exitCode = 1 })
    }
    await server?.close()
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
}

if (process.type !== 'browser' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
