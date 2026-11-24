import { createHash } from 'node:crypto'
import { APIMART_VENDOR_SEED } from '../../catalog/apimartVendor'
import { readCatalog } from '../../catalog/catalogStore'
import { decryptApiKeyRecord } from '../../catalog/secrets'
import { userVendorBaseUrl } from '../../catalog/userVendorBase'
import { vendorAuthSpec } from '../../catalog/vendorAuthSpec'
import { findIllegalHeader, isJsonRecord } from '../../jsonUtils'
import { builtinVendorKeyOfKey } from '../../shared/builtinVendorIdentity'
import type { ModelAccountBalance } from '../../shared/contracts/modelSettingsAccount'
import { authorizeSubmitDestination } from '../../vendor/vendorOutboundGuard'
import { codeDeclaredFallbackOrigins, fetchVendorWithBaseFallback } from '../../vendor/vendorBaseFallback'
import { authHeaders, looksLikeLogicalError } from '../requestPipeline'

const cache = new Map<string, { revision: string; expires: number; last?: ModelAccountBalance; reading: Promise<ModelAccountBalance> }>()

function balanceTarget(key: string) {
  if (typeof key !== 'string' || builtinVendorKeyOfKey(key) !== 'apimart') return null
  const catalog = readCatalog()
  const vendor = catalog.vendors.find(row => row.key === key && row.enabled)
  const record = catalog.apiKeysByVendor[key]
  if (!vendor || !record?.enabled) return null
  const base = userVendorBaseUrl(vendor)
  if (!URL.canParse(base)) return null
  const url = new URL(base)
  const origins = [APIMART_VENDOR_SEED.baseUrl, ...codeDeclaredFallbackOrigins('apimart')]
  if (!origins.includes(url.origin) || url.username || url.password || !['/', '/v1', '/v1/'].includes(url.pathname)) return null
  const revision = createHash('sha256').update(JSON.stringify([record, base, vendor.credentialBinding, vendorAuthSpec(vendor)])).digest('hex')
  return { record, revision, vendor, origin: url.origin }
}

function numberField(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export async function readVendorAccountBalance(key: string, refresh = false): Promise<ModelAccountBalance | null> {
  const target = balanceTarget(key)
  if (!target) { cache.delete(key); return null }
  let entry = cache.get(key)
  if (!entry || entry.revision !== target.revision || (entry.expires !== Infinity && (refresh || entry.expires <= Date.now()))) {
    const secret = decryptApiKeyRecord(target.record)
    if (!secret) return null
    const headers = authHeaders(vendorAuthSpec(target.vendor), secret)
    if (findIllegalHeader(headers)) return null
    const read = async (path: string) => {
      const url = new URL(path, target.origin).href
      if (await authorizeSubmitDestination({ vendor: target.vendor, url, carriesCredential: true })) return null
      try {
        const reply = await fetchVendorWithBaseFallback(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(8000) })
        if (!reply.ok) { await reply.body?.cancel(); return null }
        const json: unknown = await reply.json()
        if (!isJsonRecord(json) || json.success === false || looksLikeLogicalError(json) !== null) return null
        return isJsonRecord(json.data) ? json.data : json
      } catch { return null }
    }
    const last = entry?.revision === target.revision ? entry.last : undefined
    const reading = Promise.all([read('/v1/user/balance'), read(APIMART_VENDOR_SEED.credentialProbe.request.path)]).then(([account, quota]) => {
      const accountCredits = numberField(account?.remain_credits)
      const keyCredits = numberField(quota?.remain_credits)
      const unlimited = quota?.unlimited_quota === true || keyCredits === -1 || numberField(quota?.remain_balance) === -1
      const accountReady = accountCredits !== null && accountCredits >= 0
      const quotaReady = unlimited || (keyCredits !== null && keyCredits >= 0)
      return {
        keySuffix: secret.length > 4 ? secret.slice(-4) : '',
        accountCredits: accountReady ? accountCredits : last?.accountCredits ?? null,
        keyCredits: quotaReady ? (unlimited ? null : keyCredits) : last?.keyCredits ?? null,
        unlimited: quotaReady ? unlimited : last?.unlimited ?? false,
        accountStaleSince: !accountReady && last?.accountCredits != null ? last.accountStaleSince ?? last.observedAt : null,
        quotaStaleSince: !quotaReady && last && (last.unlimited || last.keyCredits !== null) ? last.quotaStaleSince ?? last.observedAt : null,
        observedAt: Date.now(),
      }
    })
    entry = { revision: target.revision, expires: Infinity, reading }
    cache.set(key, entry)
  }
  const snapshot = await entry.reading
  entry.last = snapshot
  entry.expires = snapshot.observedAt + 30_000
  return balanceTarget(key)?.revision === entry.revision ? snapshot : null
}
