import { isApimartKeyCandidate } from '../shared/contracts/vendorAccountBalance'
import { builtinVendorKeyOfKey } from '../shared/builtinVendorIdentity'
import { checkVendorAccountBalance } from '../ai/onboarding/vendorAccountBalance'
import { importModelCatalogPackage, mutateCatalog, readCatalog, upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor, upsertModelCatalogVendorApiKey } from './catalogStore'
import type { CatalogState, Model } from './types'
import { derivePublishedExecution, modelHasPublishedExecution } from '../shared/modelPublication'

import { validateCandidateCredential, candidateCredentialSnapshot } from './validateCandidateCredential'
import { carriesCertificationMark, isCertificationOwnedConnection } from './certificationOwnership'
import { publishConfiguredVendor } from './directKeyCredential'
import { bindCredentialDestination, judgeCredentialDestination, readCredentialBinding } from './credentialBinding'
import { codeDeclaredFallbackOrigins } from '../vendor/vendorBaseFallback'
import { desktopT } from '../i18n'

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

/** 认证连接上设置页改不了的字段。接口地址不在其中：它归用户在设置里亲手改（2026-09-29，主域被墙要能换线路）。 */
const SECURITY_SCOPE_FIELDS = ['authType', 'authHeader', 'authQueryParam', 'providerKind'] as const

function normalizedScopeValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value ?? null
}

function assertMutableConnectionScope(raw: Json, existing: CatalogState['vendors'][number] | undefined, state: CatalogState): void {
  if (!existing || !isCertificationOwnedConnection(state, existing.key)) return
  const changed = SECURITY_SCOPE_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(raw, key)
      && normalizedScopeValue(raw[key]) !== normalizedScopeValue(existing[key]),
  )
  if (changed) throw new Error(desktopT('catalog.connectionScopeLocked'))
}

/** Renderer may edit presentation/config fields, never certification ownership. */
function preserveCertificationMeta(incoming: unknown, existing: unknown): Json | undefined {
  const next = { ...record(incoming) }
  delete next.adapter
  const current = record(existing)
  if (carriesCertificationMark(current)) next.adapter = current.adapter
  return Object.keys(next).length ? next : undefined
}

export function sanitizeRendererVendorMutation(payload: unknown, state: CatalogState): Json {
  const raw = record(payload)
  const key = String(raw.key || '').trim()
  const existing = state.vendors.find((vendor) => vendor.key === key)
  assertMutableConnectionScope(raw, existing, state)
  const hasPublishedModel = state.models.some((model) => model.vendorKey === key
    && modelHasPublishedExecution(model, { mappings: state.mappings }))
  return {
    ...raw,
    ...(raw.enabled === true && !hasPublishedModel ? { enabled: false } : {}),
    meta: preserveCertificationMeta(raw.meta, existing?.meta),
  }
}

export function sanitizeRendererModelMutation(payload: unknown, state: CatalogState): Json {
  const raw = record(payload)
  const vendorKey = String(raw.vendorKey || '').trim()
  const modelKey = String(raw.modelKey || '').trim()
  const existing = state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)
  const preservedMeta = preserveCertificationMeta(raw.meta, existing?.meta)
  const meta = existing ? preservedMeta : {
    ...record(preservedMeta),
    adapter: { state: 'unverified', modes: [] },
  }
  const proposed = { ...(existing || {}), ...raw, vendorKey, modelKey, meta } as Model
  return {
    ...raw,
    vendorKey,
    modelKey,
    meta,
    ...(raw.enabled === true && !modelHasPublishedExecution(proposed, { mappings: state.mappings }) ? { enabled: false } : {}),
  }
}

export function sanitizeRendererMappingMutation(payload: unknown, state: CatalogState): Json {
  const raw = record(payload)
  if (raw.enabled !== true) return raw
  const vendorKey = String(raw.vendorKey || '').trim()
  const modelKey = String(raw.modelKey || '').trim()
  const taskKind = String(raw.taskKind || '').trim()
  const targets = state.models.filter((model) => model.vendorKey === vendorKey
    && (!modelKey || model.modelKey === modelKey) && carriesCertificationMark(model.meta))
  if (targets.length === 0) return raw
  const publishedForTask = targets.some((model) => derivePublishedExecution(model, { mappings: state.mappings })
    .publishedModes.includes(taskKind as never))
  return publishedForTask ? raw : { ...raw, enabled: false }
}

export function sanitizeRendererCatalogImport(payload: unknown): Json {
  const raw = record(payload)
  const vendors = Array.isArray(raw.vendors) ? raw.vendors.map((value) => {
    const bundle = record(value)
    const vendor = record(bundle.vendor)
    return {
      ...bundle,
      vendor: { ...vendor, enabled: false, meta: preserveCertificationMeta(vendor.meta, undefined) },
      models: Array.isArray(bundle.models) ? bundle.models.map((value) => {
        const model = record(value)
        return {
          ...model,
          enabled: false,
          meta: {
            ...record(preserveCertificationMeta(model.meta, undefined)),
            adapter: { state: 'unverified', modes: [] },
          },
        }
      }) : [],
      mappings: Array.isArray(bundle.mappings)
        ? bundle.mappings.map((value) => ({ ...record(value), enabled: false }))
        : [],
    }
  }) : []
  return { ...raw, vendors }
}

export function upsertRendererCatalogVendor(payload: unknown) {
  const saved = upsertModelCatalogVendor(sanitizeRendererVendorMutation(payload, readCatalog()))
  if (Object.prototype.hasOwnProperty.call(record(payload), 'baseUrlHint')) followSavedAddressWithCredential(saved.key)
  return saved
}

/**
 * 用户在设置里亲手存了新地址，而已存的 key 还绑在旧地址上——凭据守卫会把去新地址的请求全拦下。
 * 这一次保存就是他的确认，所以绑定跟到新地址（写法只有 `bindCredentialDestination` 那一个）。
 * 新地址本来就放行（绑定的那个 origin 或代码里写死的官方备用域）时不动；没存过 key 的连接没有绑定可跟。
 */
function followSavedAddressWithCredential(vendorKey: string): void {
  const vendor = readCatalog().vendors.find((item) => item.key === vendorKey)
  const binding = readCredentialBinding(vendor)
  if (!vendor?.baseUrlHint || !binding) return
  if (judgeCredentialDestination({ binding, url: vendor.baseUrlHint, codeDeclaredOrigins: codeDeclaredFallbackOrigins(vendorKey) }).allowed) return
  mutateCatalog((_tx, state) => bindCredentialDestination(state.vendors.find((item) => item.key === vendorKey), new Date().toISOString()))
}

/**
 * 保存 key 就是接入（D-1117-delete-verification）：存下、发布已有请求格式的模型，没有「待验证」这一档。
 * 保存前只有一道拒收闸——明确的 401 / 403 不存，旧 key 照用（F1）；其余结果一律照存。
 */
export async function upsertRendererCatalogVendorApiKey(vendorKey: string, payload: unknown) {
  const candidate = sanitizeRendererVendorApiKeyMutation(payload)
  const vendor = readCatalog().vendors.find((item) => item.key === vendorKey)
  if (!vendor) throw new Error(desktopT('credential.validationUnavailable'))
  const snapshot = candidateCredentialSnapshot(vendorKey)
  const key = String(candidate.apiKey || '').trim()
  const checkOnConnect = builtinVendorKeyOfKey(vendorKey) === 'apimart' && record(payload).source === 'apimart-connect'
  if (checkOnConnect && !isApimartKeyCandidate(key)) throw new Error('apimart-key-format')
  const check = checkOnConnect ? await checkVendorAccountBalance({ vendorKey }, { candidateKey: key }) : null
  if (check?.status === 'invalid') throw new Error('apimart-key-invalid')
  if (check?.status === 'unavailable') throw new Error(desktopT('credential.validationUnavailable'))
  if (!check) await validateCandidateCredential(vendor, key)
  if (snapshot !== candidateCredentialSnapshot(vendorKey)) throw new Error(desktopT('credential.changed'))
  const result = upsertModelCatalogVendorApiKey(vendorKey, { ...candidate, enabled: true })
  publishConfiguredVendor(vendorKey)
  return check ?? result
}

export function sanitizeRendererVendorApiKeyMutation(payload: unknown): Json {
  return { ...record(payload), enabled: false }
}

export function upsertRendererCatalogModel(payload: unknown) {
  const saved = upsertModelCatalogModel(sanitizeRendererModelMutation(payload, readCatalog()))
  if (record(payload).enabled === true && saved.enabled) publishConfiguredVendor(saved.vendorKey)
  return saved
}

export function upsertRendererCatalogMapping(payload: unknown) {
  return upsertModelCatalogMapping(sanitizeRendererMappingMutation(payload, readCatalog()))
}

export function importRendererCatalogPackage(payload: unknown) {
  return importModelCatalogPackage(sanitizeRendererCatalogImport(payload))
}
