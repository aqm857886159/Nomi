// Credential probes remain diagnostic; configured routes publish independently of their outcome.
import { mutateCatalog, readCatalog } from './catalogStore'
import { builtinVendorSeed } from './builtinVendorSeeds'
import { credentialProbePlan } from './credentialProbePolicy'
import { confirmCredentialProbeSpend } from './credentialProbeConfirm'
import { buildHttpRequest, appendQueryParams } from '../ai/requestPipeline'
import { readNestedRecord } from '../jsonUtils'
import { appFetch } from '../appFetch'
import type { Vendor } from './types'

export type DirectKeyProbeOutcome = 'verified' | 'invalid-key' | 'pending' | 'declined'

export function directKeyProbeModelId(state: ReturnType<typeof readCatalog>, vendorKey: string): string | null {
  const models = state.models.filter((model) => model.vendorKey === vendorKey && model.enabled)
  const text = models.find((model) => model.kind === 'text')
  return (text ?? models[0])?.modelKey ?? null
}

export type DirectKeyProbeOptions = {
  fetchImpl?: typeof fetch
  /**
   * 「这次验证会花钱，发不发」的问人函数。缺省走全仓那张付费确认卡
   * （`credentialProbeConfirm.ts` → `requestRendererDecision('spend.confirm')`）。
   */
  confirmSpend?: (input: { vendorKey: string; vendorName?: string; modelKey: string }) => Promise<boolean>
}

/**
 * 跑种子声明的凭据探测（`credentialProbe`，**不是**每周雷达那条 `livenessProbe`）。**发不发、花不花钱，由 `credentialProbePolicy` 一家说了算**
 * （T-MO-10，用户 2026-09-22 拍板「免费探测」）：
 *
 *   · 免费档（apimart 的 `GET /v1/balance`、higgsfield 的 estimate）→ 直接发，不打扰用户；
 *   · 付费档（含**缺省**：种子没声明 `cost` 的一律按付费）→ 先经确认面问一句，
 *     用户没点同意就 `declined`，**一个字节都不发**。
 *
 * 这条边界为什么存在、09-11 撞上的是什么，只写在 owner 那里（`credentialProbePolicy.ts` 文件头）。
 *
 * 永不落盘上游响应体、请求头或异常信息（它们可能回显凭据）——与每周雷达探针同一纪律。
 */
export async function probeDirectKeyCredential(vendor: Vendor, apiKey: string, options: DirectKeyProbeOptions = {}): Promise<DirectKeyProbeOutcome> {
  const fetchImpl = options.fetchImpl ?? appFetch
  const plan = credentialProbePlan(vendor.key)
  if (plan.kind !== 'seed-probe') return 'pending'
  const declaration = plan.probe
  const model = directKeyProbeModelId(readCatalog(), vendor.key)
  if (!model) return 'pending'
  // 花钱的那一档：先问人，再决定发不发。问不到人 = 不发（fail-closed）。
  if (plan.cost === 'paid') {
    const confirm = options.confirmSpend ?? confirmCredentialProbeSpend
    const approved = await confirm({ vendorKey: vendor.key, vendorName: vendor.name, modelKey: model })
    if (!approved) return 'declined'
  }
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
    if (response.status === 401 || response.status === 403) return 'invalid-key'
    if (!response.ok) return 'pending'
    const result: unknown = await response.json()
    const value = readNestedRecord(result, declaration.successPath.split('.'))
    return value !== undefined && value !== null ? 'verified' : 'pending'
  } catch {
    return 'pending'
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
