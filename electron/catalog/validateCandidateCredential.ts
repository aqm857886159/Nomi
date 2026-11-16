import { BrowserWindow } from 'electron'
import { readCatalog, normalizeProviderKind, mutateCatalog } from './catalogStore'
import { decryptStoredApiKeyRecord } from './secrets'
import type { Vendor } from './types'
import { authQueryParams } from '../ai/requestPipeline'
import { vendorAuthSpec } from './vendorAuthSpec'
import { buildAuthHeaders, fetchModelList, readExtraHeaders } from '../ai/onboarding/modelListProbe'
import { isJsonRecord } from '../jsonUtils'
import { desktopT } from '../i18n'
import { providerProxyUrl } from '../providerNetwork'
import { credentialProbePlan } from './credentialProbePolicy'
import { probeDirectKeyCredential } from './directKeyCredential'

function credentialFailure(messageKey: 'credential.invalid' | 'credential.validationUnavailable', vendorKey: string): Error {
  const kept = Boolean(readCatalog().apiKeysByVendor[vendorKey])
  return new Error(kept ? `${desktopT(messageKey)}${desktopT('credential.sentenceGap')}${desktopT('credential.previousKept')}` : desktopT(messageKey))
}

/** Probe results are diagnostic; missing key/address remains a configuration error. */
export async function validateCandidateCredential(vendor: Vendor, apiKey: string): Promise<boolean> {
  const strategy = credentialProbePlan(vendor.key).kind
  // 没有零成本预检或无需鉴权时，保存即用；不承诺不存在的自动复验。
  if (strategy === 'first-use' || vendor.authType === 'none') {
    if (!apiKey) throw credentialFailure('credential.validationUnavailable', vendor.key)
    return false
  }
  if (!apiKey || !vendor.baseUrlHint) {
    throw credentialFailure('credential.validationUnavailable', vendor.key)
  }
  // 种子声明了凭据探测端点的（apimart / higgsfield）：那份代码拥有的 credentialProbe 才是诚实的 key 判据。
  // 花不花钱、要不要先问，由 `credentialProbePolicy` 决定，`probeDirectKeyCredential` 执行。
  if (strategy === 'seed-probe') {
    const outcome = await probeDirectKeyCredential(vendor, apiKey)
    // `declined` = 用户在报价卡上说了「不发」。那不是失败：密钥照存（标未验证），
    // 判据留给首次真实调用的诚实报错——把它当失败就等于「不付这一下钱就别想接入」。
    return outcome !== 'verified'
  }
  const providerKind = normalizeProviderKind(vendor.providerKind)
  const authType = vendor.authType || (providerKind === 'anthropic' ? 'x-api-key' : 'bearer')
  const headers = buildAuthHeaders(
    providerKind,
    apiKey,
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
    { ...vendorAuthSpec(vendor), authType },
  )
  const result = await fetchModelList(providerKind, vendor.baseUrlHint, headers, AbortSignal.timeout(12_000), {
    query: authQueryParams({ ...vendorAuthSpec(vendor), authType }, apiKey),
    proxyUrl: providerProxyUrl(vendor),
  })
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
  const plan = credentialProbePlan(vendorKey)
  if (plan.kind === 'first-use') return
  // 会花钱的探测**只由用户显式点「保存验证」发起**（T-MO-10，2026-09-22）。首用前的这一下
  // 是我们自己挑的时机，不该在这里横插一张付费确认卡；判据本来就有——紧接着的那次真实调用。
  if (plan.cost === 'paid') return
  const vendor = state.vendors.find(item => item.key === vendorKey)
  if (!vendor) throw credentialFailure('credential.validationUnavailable', vendorKey)
  const snapshot = candidateCredentialSnapshot(vendorKey)
  const inflight = pendingProbes.get(vendorKey)
  if (inflight?.snapshot === snapshot) return inflight.promise
  const promise = (async () => {
    const pending = await validateCandidateCredential(vendor, decryptStoredApiKeyRecord(credential))
    if (snapshot !== candidateCredentialSnapshot(vendorKey) || pending) return
    mutateCatalog((_tx, current) => { delete current.apiKeysByVendor[vendorKey].verificationPending })
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nomi:model-catalog:changed')
  })()
  pendingProbes.set(vendorKey, { snapshot, promise })
  try { await promise } finally {
    if (pendingProbes.get(vendorKey)?.promise === promise) pendingProbes.delete(vendorKey)
  }
}
