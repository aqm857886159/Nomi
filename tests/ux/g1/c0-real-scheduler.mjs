import fs from 'node:fs'
import { scorePlanner } from './c0-r30.mjs'
import path from 'node:path'
import { prepareIsolation, readEventsLog } from '../../../evals/lib/isoApp.mjs'
import { publicPrices, quoteC0, assertAffordable, REAL_MODELS } from './c0-real-budget.mjs'

export async function createRealScheduler({ tempRoot, attemptDir, outputDir, report }) {
  const response = await fetch('https://apimart.ai/pricing', { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error('C0_PUBLIC_PRICE_UNAVAILABLE')
  const html = await response.text()
  fs.writeFileSync(path.join(attemptDir, 'public-pricing.html'), html)
  const quote = quoteC0(publicPrices(html))
  report.quote = quote
  // Reject before copying settings or decrypting credentials when a complete film is unaffordable.
  assertAffordable(quote)
  const iso = prepareIsolation(tempRoot, { requireCatalog: true })
  const catalogFile = path.join(iso.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  for (const vendor of catalog.vendors) vendor.enabled = vendor.key === 'apimart'
  for (const model of catalog.models) model.enabled = model.vendorKey === 'apimart' && Object.values(REAL_MODELS).includes(model.modelKey)
  for (const modelKey of Object.values(REAL_MODELS)) {
    if (!catalog.models.some((m) => m.enabled && m.modelKey === modelKey)) throw new Error('C0_CONFIGURED_MODEL_UNAVAILABLE')
  }
  // Retain only encrypted APIMart credentials; never copy them into any fixture or report.
  catalog.apiKeysByVendor = { apimart: catalog.apiKeysByVendor.apimart }
  if (catalog.apiKeysByVendor.apimart?.enc !== 'safeStorage') throw new Error('C0_ENCRYPTED_SETTINGS_REQUIRED')
  fs.writeFileSync(catalogFile, JSON.stringify(catalog), { mode: 0o600 })
  const lockPath = path.join(outputDir, 'real-budget.lock')
  const lock = fs.openSync(lockPath, 'wx', 0o600)
  fs.closeSync(lock)
  const ledgerPath = path.join(outputDir, 'real-budget-ledger.json')
  let app, planEvents = []
  const bridge = path.join(tempRoot, 'c0-main.cjs')
  fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(new URL('./c0-real-main.mjs', import.meta.url).href)});`, { mode: 0o600 })
  const snapshot = async () => {
    if (!app) return
    try {
      const ledger = await app.evaluate(() => globalThis.__c0Dispatch.snapshot())
      report.costCny = ledger.billedCnyAtBudgetRate
      report.billedUsd = ledger.billedUsd
      report.billingAttribution = 'APIMart token balance delta; concurrent use of the same token may be included'
    } catch {
      report.costCny = null
      report.billingError = 'C0_BILLING_UNAVAILABLE'
      throw new Error('C0_BILLING_UNAVAILABLE')
    } finally {
      // Preserve reservations even if Electron died or the balance query failed.
      if (fs.existsSync(ledgerPath)) {
        const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
        report.outbound = ledger.requests
        report.paidCalls = ledger.requests.length
        report.reservedCny = ledger.reservedCny
      }
    }
  }
  return {
    iso, model: REAL_MODELS.video,
    async attach(launched) {
      app = launched.app
      await app.evaluate(async (_electron, options) => {
        const module = await process.mainModule.require(options.bridge)
        globalThis.__c0Dispatch = await module.attachRealDispatch(options)
      }, { bridge, quote, ledgerPath })
      await launched.win.evaluate(({ models }) => {
        localStorage.setItem('nomi.assistantModel', JSON.stringify({ vendorKey: 'apimart', modelKey: models.text }))
        window.dispatchEvent(new CustomEvent('nomi:assistant-model-changed'))
      }, { models: REAL_MODELS })
    },
    preparePlan() {}, async planRequested() {},
    async assertNoGeneration(expect) {
      await snapshot()
      expect(report.outbound.filter((r) => r.model !== REAL_MODELS.text)).toEqual([])
    },
    async planCompleted({ projectRoot, expect }) {
      await expect.poll(() => readEventsLog(projectRoot).some((e) => e.type === 'agent.turn.finished'), { timeout: 180_000 }).toBe(true)
      planEvents = readEventsLog(projectRoot)
    },
    verifyPlan(actual, expect) {
      expect(actual.every((s) => s.modelKey === REAL_MODELS.video && s.params?.resolution === '768P')).toBe(true)
      report.r30.real = scorePlanner(planEvents, true)
      fs.writeFileSync(path.join(attemptDir, 'r30-events.json'), JSON.stringify(planEvents.filter((e) => /^agent\.(turn\.|tool\.)/.test(e.type))
        .map((e) => ({ type: e.type, toolName: e.payload?.toolName, status: e.payload?.status, ok: e.payload?.ok,
          toolCallId: e.payload?.toolCallId, hasFinalText: Boolean(e.payload?.finalTextHead?.trim()) })), null, 2))
    },
    prepareGeneration() {}, async generationCompleted() { await snapshot() },
    async finish() { await snapshot() },
    async close() {
      try { await snapshot() } finally {
        fs.rmSync(iso.settingsDir, { recursive: true, force: true })
        fs.rmSync(lockPath, { force: true })
      }
    },
  }
}
