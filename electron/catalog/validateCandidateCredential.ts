import { readCatalog, normalizeProviderKind } from './catalogStore'
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

/**
 * 保存 key 前的拒收闸（F1，D-1117-delete-verification）。只做一件事：上游**明确**说这把 key 不对
 * （401 / 403）就不存，旧 key 照用。其余一律照存——404、网页、断网、超时都不是「key 不对」的证据。
 * 不产出任何状态：没有「待验证」，也没有「验过了」。
 */
export async function validateCandidateCredential(vendor: Vendor, apiKey: string): Promise<void> {
  const strategy = credentialProbePlan(vendor.key).kind
  // 没有零成本预检或无需鉴权时，保存即用。
  if (strategy === 'first-use' || vendor.authType === 'none') {
    if (!apiKey) throw credentialFailure('credential.validationUnavailable', vendor.key)
    return
  }
  if (!apiKey || !vendor.baseUrlHint) {
    throw credentialFailure('credential.validationUnavailable', vendor.key)
  }
  // 种子声明了免费凭据端点的（apimart / higgsfield）：明确的 401/403 = 拒收（协调 2026-11-17 裁定）。
  if (strategy === 'seed-probe') {
    if (await probeDirectKeyCredential(vendor, apiKey) === 'invalid-key') throw credentialFailure('credential.invalid', vendor.key)
    return
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
  // 主分支有、上一轮丢了的那条（F1）：自接走免费 `GET /models`，明确 401 / 403 就拒收。
  if (!result.ok && result.failureKind === 'auth') throw credentialFailure('credential.invalid', vendor.key)
}

export function candidateCredentialSnapshot(vendorKey: string): string {
  const state = readCatalog()
  return JSON.stringify({ vendor: state.vendors.find((vendor) => vendor.key === vendorKey), key: state.apiKeysByVendor[vendorKey] })
}
