// 保存 key 时的拒收闸（F1）：种子声明的免费探测只回答一件事——上游是不是明确说了 401 / 403。
// 其余结果（通、不通、超时、5xx）一律照存，不产出任何状态（D-1117-delete-verification）。
import { mutateCatalog, readCatalog } from './catalogStore'
import { builtinVendorSeed } from './builtinVendorSeeds'
import { credentialProbePlan } from './credentialProbePolicy'
import { buildHttpRequest, appendQueryParams } from '../ai/requestPipeline'
import { appFetch } from '../appFetch'
import type { Vendor } from './types'

export type DirectKeyProbeOutcome = 'invalid-key' | 'saved'

export function directKeyProbeModelId(state: ReturnType<typeof readCatalog>, vendorKey: string): string | null {
  const models = state.models.filter((model) => model.vendorKey === vendorKey && model.enabled)
  const text = models.find((model) => model.kind === 'text')
  return (text ?? models[0])?.modelKey ?? null
}

export type DirectKeyProbeOptions = {
  fetchImpl?: typeof fetch
}

/**
 * 跑种子声明的凭据探测（`credentialProbe`，**不是**每周雷达那条 `livenessProbe`）。**发不发由 `credentialProbePolicy` 一家说了算**：
 * 只有有出处地证明过零费用的探测（apimart 的 `GET /v1/balance`、higgsfield 的 estimate）才会走到这里；
 * 会花钱的探测在策略那一层就落「首次使用」，不发。
 *
 * 永不落盘上游响应体、请求头或异常信息（它们可能回显凭据）——与每周雷达探针同一纪律。
 */
export async function probeDirectKeyCredential(vendor: Vendor, apiKey: string, options: DirectKeyProbeOptions = {}): Promise<DirectKeyProbeOutcome> {
  const fetchImpl = options.fetchImpl ?? appFetch
  const plan = credentialProbePlan(vendor.key)
  if (plan.kind !== 'seed-probe') return 'saved'
  const declaration = plan.probe
  const model = directKeyProbeModelId(readCatalog(), vendor.key)
  if (!model) return 'saved'
  try {
    const request = buildHttpRequest({
      baseUrl: vendor.baseUrlHint || builtinVendorSeed(vendor.key)!.baseUrl,
      authType: vendor.authType || 'bearer',
      authHeaderName: vendor.authHeader ?? undefined,
      authScheme: vendor.authScheme ?? undefined,
      authQueryParam: vendor.authQueryParam ?? undefined,
      apiKey,
      context: { model },
      operation: declaration.request,
    })
    const response = await fetchImpl(appendQueryParams(request.url, request.query), {
      method: request.method,
      headers: request.headers,
      // 免费探测多半是 GET（apimart 的余额查询就是），带 body 的 GET 会被 undici 直接拒。
      // 声明里没有 body 就不要造一个 "undefined" 出来。
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    // 只认明确的 401 / 403；通了也不留「验过了」的记号——没有这一档。
    return response.status === 401 || response.status === 403 ? 'invalid-key' : 'saved'
  } catch {
    return 'saved'
  }
}

/** Saving a key enables the connection; model availability still requires its own request format. */
export function publishConfiguredVendor(vendorKey: string): void {
  mutateCatalog((_tx, current) => {
    const vendor = current.vendors.find((item) => item.key === vendorKey)
    if (!vendor || vendor.enabled) return
    vendor.enabled = true
    vendor.updatedAt = new Date().toISOString()
  })
}
