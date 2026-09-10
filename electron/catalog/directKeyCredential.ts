// direct-key 凭据的验证与发布 —— 2026-09-10 走查反馈回归修复。
//
// 根因（docs/plan/2026-09-10-ux-feedback-triage.md §5）：direct-key 供应商（apimart）
// 的设计契约是「填 key 即解锁全部预置模型」，但两道门把它拦死：
//   ① 验证用 `GET /v1/models` 的可达性当 key 有效性判据，而 apimart 对该端点回 401
//     （vendorBaseFallback.ts 有注释确认）→ 存 key 转圈 12s 后报「验证失败」；
//   ② 渲染层 key 写入强制 `enabled:false` + `verificationPending`，凭据停用又把
//     vendor 整体 de-publish → 模型从选择器和 agent 可用清单里全部消失。
// key 明明能用（直连生成没问题），目录却藏着——名实不一的假阴性。
//
// 本文件给出 direct-key 的两条正路（只对 isBuiltinDirectKeyVendor 且带 livenessProbe
// 的种子生效，certification 供应商一律走原路，诚实门不变量不放松）：
//   ① 验证 = 种子里代码拥有的 livenessProbe（apimart: POST /api/v1/chat/completions，
//     max_tokens:1，与每周雷达 scripts/model-liveness.ts 同一声明、同一成功判据）。
//     401/403 → key 无效（throw）；探测成功 → verified；网络/上游其它失败 → pending
//     （诚实：不假装可用，也不把网络抖动误报成 key 错误）。
//   ② 发布 = verified 后把凭据写 enabled:true 并把 vendor 行重新 enable（direct-key
//     的「认证」就是代码拥有的契约本身：scope 匹配 + 无认证占用 + curated 执行契约
//     还在，三者缺一就不 promote，供应商改过 baseUrl/契约漂移照样 fail-closed）。

import { mutateCatalog, readCatalog } from './catalogStore'
import { builtinVendorSeed, builtinVendorScopeMatches, isBuiltinDirectKeyVendor } from './builtinVendorSeeds'
import { hasBuiltinCuratedExecution } from './seedBuiltins'
import { buildHttpRequest, appendQueryParams } from '../ai/requestPipeline'
import { readNestedRecord } from '../jsonUtils'
import { appFetch } from '../appFetch'
import type { Vendor } from './types'

export type DirectKeyProbeOutcome = 'verified' | 'invalid-key' | 'pending'

export function directKeyProbeModelId(state: ReturnType<typeof readCatalog>, vendorKey: string): string | null {
  const models = state.models.filter((model) => model.vendorKey === vendorKey && model.enabled)
  const text = models.find((model) => model.kind === 'text')
  return (text ?? models[0])?.modelKey ?? null
}

/**
 * Run the code-owned liveness probe declared on the vendor seed. Paid by this
 * single verification call (max_tokens:1), never by reconciliation. Never
 * persists upstream bodies, request headers, or exception messages (they may
 * echo credentials) — same discipline as the weekly radar probe.
 */
export async function probeDirectKeyCredential(vendor: Vendor, apiKey: string, fetchImpl: typeof fetch = appFetch): Promise<DirectKeyProbeOutcome> {
  const declaration = builtinVendorSeed(vendor.key)?.livenessProbe
  if (!declaration) return 'pending'
  const model = directKeyProbeModelId(readCatalog(), vendor.key)
  if (!model) return 'pending'
  try {
    const request = buildHttpRequest({
      baseUrl: vendor.baseUrlHint || builtinVendorSeed(vendor.key)!.baseUrl,
      authType: vendor.authType || 'bearer',
      authHeaderName: vendor.authHeader ?? undefined,
      authQueryParam: vendor.authQueryParam ?? undefined,
      apiKey,
      context: { model },
      operation: declaration.request,
    })
    const response = await fetchImpl(appendQueryParams(request.url, request.query), {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
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

function hasCertificationOwnedAdapter(state: Parameters<typeof hasBuiltinCuratedExecution>[0], vendorKey: string): boolean {
  const hasAdapter = (meta: unknown): boolean => Boolean(meta && typeof meta === 'object' && !Array.isArray(meta)
    && Object.prototype.hasOwnProperty.call(meta, 'adapter'))
  return state.vendors.some((vendor) => vendor.key === vendorKey && hasAdapter(vendor.meta))
    || state.models.some((model) => model.vendorKey === vendorKey && hasAdapter(model.meta))
}

/**
 * Re-enable the vendor row for a verified direct-key credential. Guards are
 * the same triple the runtime bootstrap checks (scope match / no certification
 * adapter / curated execution contract intact) — promotion only happens when
 * the transport still points at the code-owned contract.
 */
export function promoteDirectKeyVendor(vendorKey: string): void {
  if (!isBuiltinDirectKeyVendor(vendorKey)) return
  mutateCatalog((_tx, current) => {
    const vendor = current.vendors.find((item) => item.key === vendorKey)
    if (!vendor || vendor.enabled) return
    if (hasCertificationOwnedAdapter(current, vendorKey)) return
    if (!builtinVendorScopeMatches(vendor)) return
    if (!hasBuiltinCuratedExecution(current, vendorKey)) return
    vendor.enabled = true
    vendor.updatedAt = new Date().toISOString()
  })
}
