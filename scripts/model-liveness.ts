/** Weekly paid evidence is separate from free list evidence and never mutates the app catalog. */
import { buildHttpRequest, appendQueryParams } from '../electron/ai/requestPipeline.ts'
import { readNestedRecord } from '../electron/jsonUtils.ts'
import type { VendorSeed } from '../electron/catalog/builtinVendorSeeds.ts'

export type LivenessReceipt = {
  vendorKey: string
  modelKey: string
  checkedAt?: string
  ok: boolean
  status?: number
  reason?: 'credential-missing' | 'network' | 'invalid-response' | 'upstream'
}
const WEEK_MS = 7 * 24 * 60 * 60_000

export async function probeWeeklyModels(input: {
  vendors: readonly VendorSeed[]
  modelIds: (vendorKey: string) => string[]
  apiKey: (vendorKey: string) => string
  previous: readonly LivenessReceipt[]
  now: string
  fetcher?: typeof fetch
}): Promise<LivenessReceipt[]> {
  const receipts: LivenessReceipt[] = []
  const fetcher = input.fetcher || fetch
  for (const vendor of input.vendors) {
    const declaration = vendor.livenessProbe
    if (!declaration) continue
    for (const modelKey of input.modelIds(vendor.key)) {
      const old = input.previous.find((row) => row.vendorKey === vendor.key && row.modelKey === modelKey)
      const elapsed = Date.parse(input.now) - Date.parse(old?.checkedAt || '')
      if (old && elapsed >= 0 && elapsed < WEEK_MS) { receipts.push(old); continue }
      const apiKey = input.apiKey(vendor.key)
      if (!apiKey) { receipts.push({ vendorKey: vendor.key, modelKey, ok: false, reason: 'credential-missing' }); continue }
      const receipt: LivenessReceipt = { vendorKey: vendor.key, modelKey, checkedAt: input.now, ok: false }
      try {
        const request = buildHttpRequest({ baseUrl: vendor.baseUrl, authType: vendor.authType ?? 'none', authHeaderName: vendor.authHeader || undefined,
          authQueryParam: vendor.authQueryParam || undefined, apiKey, context: { model: modelKey }, operation: declaration.request })
        const response = await fetcher(appendQueryParams(request.url, request.query), {
          method: request.method, headers: request.headers, body: JSON.stringify(request.body), redirect: 'error', signal: AbortSignal.timeout(15_000),
        })
        receipt.status = response.status
        if (!response.ok) receipt.reason = 'upstream'
        else {
          const result: unknown = await response.json()
          const value = readNestedRecord(result, declaration.successPath.split('.'))
          receipt.ok = value !== undefined && value !== null
          if (!receipt.ok) receipt.reason = 'invalid-response'
        }
      } catch { receipt.reason = 'network' }
      // Never persist upstream bodies, request headers, or exception messages (they may echo credentials).
      receipts.push(receipt)
    }
  }
  return receipts
}
