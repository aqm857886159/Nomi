import { BrowserWindow } from 'electron'
import { readCatalog, normalizeProviderKind, mutateCatalog } from './catalogStore'
import { decryptApiKeyRecord } from './secrets'
import type { Vendor } from './types'
import { authHeaders, authQueryParams } from '../ai/requestPipeline'
import { fetchModelList, readExtraHeaders } from '../ai/onboarding/modelListProbe'
import { isJsonRecord, mergeHeadersCaseInsensitive } from '../jsonUtils'
import { desktopT } from '../i18n'
import { providerProxyUrl } from '../providerNetwork'
import { isBuiltinDirectKeyVendor, builtinVendorSeed } from './builtinVendorSeeds'
import { probeDirectKeyCredential, promoteDirectKeyVendor } from './directKeyCredential'

/** Return whether verification is pending; explicit auth rejection throws without publishing the candidate. */
export async function validateCandidateCredential(vendor: Vendor, apiKey: string): Promise<boolean> {
  if (!apiKey || !vendor.baseUrlHint || vendor.authType === 'none') {
    throw new Error(desktopT('credential.validationUnavailable'))
  }
  // direct-key 供应商（apimart）：代码拥有的 livenessProbe 才是诚实的 key 判据。
  // /v1/models 探测对 apimart 恒 401（vendorBaseFallback.ts 注释），把它当「key 无效」
  // 是 2026-09-10 走查的回归根因。见 directKeyCredential.ts 顶部说明。
  if (isBuiltinDirectKeyVendor(vendor.key) && builtinVendorSeed(vendor.key)?.livenessProbe) {
    const outcome = await probeDirectKeyCredential(vendor, apiKey)
    if (outcome === 'invalid-key') throw new Error(desktopT('credential.invalid'))
    return outcome === 'pending'
  }
  const providerKind = normalizeProviderKind(vendor.providerKind)
  const authType = vendor.authType || (providerKind === 'anthropic' ? 'x-api-key' : 'bearer')
  const headers = mergeHeadersCaseInsensitive(
    providerKind === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {},
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
    authHeaders(authType, apiKey, vendor.authHeader ?? undefined),
  )
  const result = await fetchModelList(providerKind, vendor.baseUrlHint, headers, AbortSignal.timeout(12_000), {
    query: authQueryParams(authType, apiKey, vendor.authQueryParam ?? undefined),
    proxyUrl: providerProxyUrl(vendor),
  })
  if (!result.ok && result.failureKind === 'auth') throw new Error(desktopT('credential.invalid'))
  return !result.ok
}

export function candidateCredentialSnapshot(vendorKey: string): string {
  const state = readCatalog()
  return JSON.stringify({ vendor: state.vendors.find((vendor) => vendor.key === vendorKey), key: state.apiKeysByVendor[vendorKey] })
}


const pendingProbes = new Map<string, { snapshot: string; promise: Promise<void> }>()

/** One zero-cost probe before a pending credential is used. Never promotes model certification. */
export async function revalidatePendingCredential(vendorKey: string): Promise<void> {
  const state = readCatalog()
  const credential = state.apiKeysByVendor[vendorKey]
  if (!credential?.verificationPending) return
  const vendor = state.vendors.find(item => item.key === vendorKey)
  if (!vendor) throw new Error(desktopT('credential.validationUnavailable'))
  const snapshot = candidateCredentialSnapshot(vendorKey)
  const inflight = pendingProbes.get(vendorKey)
  if (inflight?.snapshot === snapshot) return inflight.promise
  const promise = (async () => {
    const pending = await validateCandidateCredential(vendor, decryptApiKeyRecord(credential))
    if (snapshot !== candidateCredentialSnapshot(vendorKey)) throw new Error(desktopT('credential.changed'))
    if (pending) throw new Error(desktopT('credential.revalidationUnavailable'))
    mutateCatalog((_tx, current) => { delete current.apiKeysByVendor[vendorKey].verificationPending })
    // pending→verified 的转正：direct-key 凭据存进来时是 enabled:false（诚实门要求
    // 未验证先不发布），复检通过后凭据与 vendor 一起发布——只清 pending 不发布，
    // 用户会卡在「验证过了但模型还是不出现」的半截状态。
    if (isBuiltinDirectKeyVendor(vendorKey)) {
      mutateCatalog((_tx, current) => { const record = current.apiKeysByVendor[vendorKey]; if (record) record.enabled = true })
      promoteDirectKeyVendor(vendorKey)
    }
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nomi:model-catalog:changed')
  })()
  pendingProbes.set(vendorKey, { snapshot, promise })
  try { await promise } finally {
    if (pendingProbes.get(vendorKey)?.promise === promise) pendingProbes.delete(vendorKey)
  }
}
