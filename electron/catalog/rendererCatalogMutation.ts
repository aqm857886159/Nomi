import { importModelCatalogPackage, readCatalog, upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor, upsertModelCatalogVendorApiKey } from './catalogStore'
import type { CatalogState, Model } from './types'
import { derivePublishedExecution, modelHasPublishedExecution } from '../shared/modelPublication'

import { validateCandidateCredential, candidateCredentialSnapshot } from './validateCandidateCredential'
import { isBuiltinDirectKeyVendor } from './builtinVendorSeeds'
import { promoteDirectKeyVendor } from './directKeyCredential'
import { desktopT } from '../i18n'

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function hasAdapter(meta: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(record(meta), 'adapter')
}

const SECURITY_SCOPE_FIELDS = ['baseUrlHint', 'authType', 'authHeader', 'authQueryParam', 'providerKind'] as const

function normalizedScopeValue(key: (typeof SECURITY_SCOPE_FIELDS)[number], value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  const trimmed = value.trim()
  return key === 'baseUrlHint' ? trimmed.replace(/\/+$/, '') : trimmed
}

function certificationOwnedConnection(state: CatalogState, vendorKey: string): boolean {
  const vendor = state.vendors.find((item) => item.key === vendorKey)
  return hasAdapter(vendor?.meta) || state.models.some((model) => model.vendorKey === vendorKey && hasAdapter(model.meta))
}

function assertMutableConnectionScope(raw: Json, existing: CatalogState['vendors'][number] | undefined, state: CatalogState): void {
  if (!existing || !certificationOwnedConnection(state, existing.key)) return
  const changed = SECURITY_SCOPE_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(raw, key)
      && normalizedScopeValue(key, raw[key]) !== normalizedScopeValue(key, existing[key]),
  )
  if (changed) throw new Error('Certification-owned connection changes require a new integration session')
}

/** Renderer may edit presentation/config fields, never certification ownership. */
function preserveCertificationMeta(incoming: unknown, existing: unknown): Json | undefined {
  const next = { ...record(incoming) }
  delete next.adapter
  const current = record(existing)
  if (Object.prototype.hasOwnProperty.call(current, 'adapter')) next.adapter = current.adapter
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
    && (!modelKey || model.modelKey === modelKey) && hasAdapter(model.meta))
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
  return upsertModelCatalogVendor(sanitizeRendererVendorMutation(payload, readCatalog()))
}

/** Renderer credential writes are configuration only.  For certification vendors a key
 * can never promote the vendor — certification owns the later enabled transition.  The
 * paired vendor de-publish is inherited from the store, not done here — see
 * `credentialPublication.ts`.  direct-key vendors (apimart) are the designed exception:
 * the code-owned contract *is* the certification, so a verified key publishes the
 * credential and the vendor in the same step (see `directKeyCredential.ts`). */
export async function upsertRendererCatalogVendorApiKey(vendorKey: string, payload: unknown) {
  const candidate = sanitizeRendererVendorApiKeyMutation(payload)
  const vendor = readCatalog().vendors.find((item) => item.key === vendorKey)
  if (!vendor) throw new Error(desktopT('credential.validationUnavailable'))
  const snapshot = candidateCredentialSnapshot(vendorKey)
  const verificationPending = await validateCandidateCredential(vendor, String(candidate.apiKey || '').trim())
  if (snapshot !== candidateCredentialSnapshot(vendorKey)) throw new Error(desktopT('credential.changed'))
  // direct-key：verified → 凭据 enabled:true + vendor 重新发布；pending（网络/上游抖动）
  // → 诚实保持停用 + verificationPending，首用前 revalidatePendingCredential 再转正。
  // 渲染层传来的 enabled 永远不算数（恒 false），启用与否只由这里的验证结果决定。
  const directKeyVerified = isBuiltinDirectKeyVendor(vendorKey) && !verificationPending
  const result = upsertModelCatalogVendorApiKey(vendorKey, {
    ...candidate,
    ...(verificationPending ? { verificationPending: true } : {}),
    ...(directKeyVerified ? { enabled: true } : {}),
  })
  if (directKeyVerified) promoteDirectKeyVendor(vendorKey)
  return result
}

export function sanitizeRendererVendorApiKeyMutation(payload: unknown): Json {
  const { verificationPending: _ignored, ...candidate } = record(payload)
  return { ...candidate, enabled: false }
}

export function upsertRendererCatalogModel(payload: unknown) {
  return upsertModelCatalogModel(sanitizeRendererModelMutation(payload, readCatalog()))
}

export function upsertRendererCatalogMapping(payload: unknown) {
  return upsertModelCatalogMapping(sanitizeRendererMappingMutation(payload, readCatalog()))
}

export function importRendererCatalogPackage(payload: unknown) {
  return importModelCatalogPackage(sanitizeRendererCatalogImport(payload))
}
