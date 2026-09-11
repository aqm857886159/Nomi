import { BrowserWindow } from 'electron'
import { readCatalog, normalizeProviderKind, mutateCatalog } from './catalogStore'
import { decryptApiKeyRecord } from './secrets'
import type { Vendor } from './types'
import { authHeaders, authQueryParams } from '../ai/requestPipeline'
import { fetchModelList, readExtraHeaders } from '../ai/onboarding/modelListProbe'
import { isJsonRecord, mergeHeadersCaseInsensitive } from '../jsonUtils'
import { desktopT } from '../i18n'
import { providerProxyUrl } from '../providerNetwork'
import { credentialValidationStrategy } from './builtinVendorSeeds'
import { probeDirectKeyCredential, publishBuiltinCuratedVendor } from './directKeyCredential'

/**
 * 返回「是否仍待验证」；明确的鉴权拒绝直接抛，候选不发布。
 *
 * 判据按**种子声明**分派（credentialValidationStrategy），不按 vendor 名、也不假设人人都有
 * `GET /v1/models`：apimart 对合法 key 恒 401、minimax 回 200 却连最小生成都跑不通，
 * 两个方向的反例都在我们自己的证据里（prior-art ④）。
 */
export async function validateCandidateCredential(vendor: Vendor, apiKey: string): Promise<boolean> {
  const strategy = credentialValidationStrategy(vendor.key)
  // 内置家里没有便宜且可信的预检的那一类（最小真实请求 = 一次付费生成，不能替用户花钱）：
  // 存 key 即发布，首次生成时的鉴权失败走现有诚实报错。
  // 火山语音这类 authType:'none'（三头鉴权由 audioTaskRunner 手搓）也从这条路存得进去。
  //
  // 刻意**不**标 verificationPending：那个标记在本仓的语义是「这次没验成，之后还会再验」
  // （UI 文案逐字为「已保存 · 未验证 / 联网后会自动复验，下次调用前也会先检查一次」）。
  // 对这一类我们不会再验——没有可验的便宜端点。挂上它等于让 12 家常驻一句做不到的承诺，
  // 并把接入卡上的「N 个可使用」永久换成「未验证」。那还是名实不一，只是换了个方向。
  if (strategy === 'first-use') {
    if (!apiKey) throw new Error(desktopT('credential.validationUnavailable'))
    return false
  }
  if (!apiKey || !vendor.baseUrlHint || vendor.authType === 'none') {
    throw new Error(desktopT('credential.validationUnavailable'))
  }
  // 种子声明了零成本存活探测的（apimart）：那份代码拥有的 livenessProbe 才是诚实的 key 判据。
  if (strategy === 'liveness-probe') {
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
  // 存量装机可能还留着本次改动之前写下的 pending 记录。对 `first-use` 这一类没有零成本预检
  // 可跑（唯一判据就是这次真实调用本身），在这里挡住等于把「没法便宜地预检」翻译成「不许用」。
  // 鉴权真错时，上游 401 会经现有诚实报错路径回到用户面前。
  if (credentialValidationStrategy(vendorKey) === 'first-use') return
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
    // pending→verified 的转正：探测型凭据存进来时是 enabled:false（诚实门要求未验证先不发布），
    // 复检通过后凭据与 vendor 一起发布——只清 pending 不发布，用户会卡在
    // 「验证过了但模型还是不出现」的半截状态。
    if (credentialValidationStrategy(vendorKey)) {
      mutateCatalog((_tx, current) => { const record = current.apiKeysByVendor[vendorKey]; if (record) record.enabled = true })
      publishBuiltinCuratedVendor(vendorKey)
    }
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nomi:model-catalog:changed')
  })()
  pendingProbes.set(vendorKey, { snapshot, promise })
  try { await promise } finally {
    if (pendingProbes.get(vendorKey)?.promise === promise) pendingProbes.delete(vendorKey)
  }
}
