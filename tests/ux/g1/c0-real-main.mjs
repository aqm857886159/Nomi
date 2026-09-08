// Loaded through a file-backed bridge inside the candidate Electron main process.
// Credentials never cross this boundary. Production catalog/transport modules come from app.asar.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { budgetedFetch, CNY_PER_USD } from './c0-real-budget.mjs'
export async function attachRealDispatch({ quote, ledgerPath }) {
  const require = createRequire(import.meta.url)
  const { app } = require('electron')
  const compiled = path.join(app.getAppPath(), 'dist-electron')
  const { readCatalog } = require(path.join(compiled, 'catalog/catalogStore.js'))
  const { decryptApiKeyRecord } = require(path.join(compiled, 'catalog/secrets.js'))
  const catalog = readCatalog()
  const record = catalog.apiKeysByVendor?.apimart
  const key = record?.enabled !== false ? decryptApiKeyRecord(record) : ''
  if (!key) throw new Error('C0_APPLICATION_CREDENTIAL_UNAVAILABLE')
  const transport = require(path.join(compiled, 'appFetch.js'))
  const originalAppFetch = transport.appFetch
  const originalGlobalFetch = globalThis.fetch
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    : { reservedCny: 0, requests: [], initialUsedUsd: null, billedUsd: null }
  const persist = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 })
  const balance = async () => {
    try {
      const response = await originalAppFetch('https://api.apimart.ai/v1/balance', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
      })
      const data = await response.json()
      if (!response.ok || data.success !== true || !Number.isFinite(data.used_balance)
        || !Number.isFinite(data.used_credits) || Math.abs(data.used_credits - data.used_balance * 10) > .00001)
        throw new Error('invalid')
      return data.used_balance
    } catch { throw new Error('C0_BILLING_UNAVAILABLE') }
  }
  ledger.initialUsedUsd ??= await balance()
  persist()
  transport.appFetch = budgetedFetch({ send: originalAppFetch, quote, ledger, persist })
  globalThis.fetch = budgetedFetch({ send: originalGlobalFetch, quote, ledger, persist })
  return {
    async snapshot() {
      ledger.billedUsd = Math.max(ledger.billedUsd ?? 0, (await balance()) - ledger.initialUsedUsd)
      ledger.billedCnyAtBudgetRate = ledger.billedUsd * CNY_PER_USD
      persist()
      return ledger
    },
  }
}
