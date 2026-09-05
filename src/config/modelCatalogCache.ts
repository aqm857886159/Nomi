import {
  getWorkbenchModelCatalogHealth,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type ModelCatalogHealthDto,
  type ProfileKind,
} from '../workbench/api/modelCatalogApi'
import type { ModelOption, NodeKind } from './models'
import {
  normalizeModelId,
  trimModelIdentifier,
  resolveExecutableImageModelFromOptions,
  type ResolvedExecutableImageModel,
} from './modelOptionResolvers'
import { toCatalogModelOptions } from './modelOptionMappers'
import { resolveCatalogKind } from './modelCatalogStatus'

export const MODEL_REFRESH_EVENT = 'nomi-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

const catalogOptionsCache = new Map<string, ModelOption[]>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
let catalogHealthCache: ModelCatalogHealthDto | null = null
let catalogHealthPromise: Promise<ModelCatalogHealthDto> | null = null
let enabledVendorKeysCache: Set<string> | null = null
let enabledVendorKeysPromise: Promise<Set<string>> | null = null
let configuredVendorKeysCache: Set<string> | null = null
let vendorNamesCache: Map<string, string> | null = null

const HIDDEN_IMAGE_MODEL_ID_RE = /^(gemini-.*-image(?:-(?:landscape|portrait))?|imagen-.*-(?:landscape|portrait))$/i

export function filterHiddenOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  if (kind !== 'image' && kind !== 'imageEdit') return options
  return options.filter((opt) => {
    const normalizedValue = normalizeModelId(opt.value)
    if (!HIDDEN_IMAGE_MODEL_ID_RE.test(normalizedValue)) return true
    const normalizedAlias = normalizeModelId(trimModelIdentifier(opt.modelAlias))
    return Boolean(normalizedAlias && normalizedAlias !== normalizedValue)
  })
}

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
  catalogHealthCache = null
  catalogHealthPromise = null
  enabledVendorKeysCache = null
  enabledVendorKeysPromise = null
  configuredVendorKeysCache = null
  vendorNamesCache = null
}

export async function getCatalogHealth(): Promise<ModelCatalogHealthDto> {
  if (catalogHealthCache) return catalogHealthCache
  if (!catalogHealthPromise) {
    catalogHealthPromise = (async () => {
      try {
        const health = await getWorkbenchModelCatalogHealth()
        catalogHealthCache = health
        return health
      } finally {
        catalogHealthPromise = null
      }
    })()
  }
  return catalogHealthPromise
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

async function getEnabledVendorKeys(): Promise<Set<string>> {
  if (enabledVendorKeysCache) return enabledVendorKeysCache
  if (!enabledVendorKeysPromise) {
    enabledVendorKeysPromise = (async () => {
      try {
        const vendors = await listWorkbenchModelCatalogVendors()
        const rows = Array.isArray(vendors) ? vendors : []
        const enabled = new Set(rows.filter((v) => Boolean(v?.enabled)).map((v) => String(v?.key || '').trim().toLowerCase()).filter(Boolean))
        const configured = new Set(rows.filter((v) => Boolean(v?.enabled) && (v?.authType === 'none' || Boolean(v?.hasApiKey))).map((v) => String(v?.key || '').trim().toLowerCase()).filter(Boolean))
        const names = new Map<string, string>()
        for (const v of rows) { const key = String(v?.key || '').trim().toLowerCase(); const name = String(v?.name || '').trim(); if (key && name) names.set(key, name) }
        vendorNamesCache = names
        enabledVendorKeysCache = enabled
        configuredVendorKeysCache = configured
        return enabled
      } finally { enabledVendorKeysPromise = null }
    })()
  }
  return enabledVendorKeysPromise
}

function defaultPublishedMode(kind?: NodeKind): ProfileKind {
  if (kind === 'imageEdit') return 'image_edit'
  if (kind === 'image') return 'text_to_image'
  if (kind === 'video') return 'text_to_video'
  if (kind === 'audio') return 'text_to_audio'
  if (kind === 'model3d') return 'text_to_3d'
  return 'chat'
}

async function getCatalogModelOptions(kind?: NodeKind, requiredMode = defaultPublishedMode(kind)): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const cacheKey = `${catalogKind}:${requiredMode}`
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listWorkbenchModelCatalogModels({ kind: catalogKind, enabled: true })
      const enabledVendorKeys = await getEnabledVendorKeys()
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (!row?.published || !Array.isArray(row.publishedModes) || !row.publishedModes.includes(requiredMode)) return false
        const vendorKey = String(row?.vendorKey || '').trim().toLowerCase()
        if (!vendorKey) return false
        // 空集 = 「一家可用供应商都没有」，不是「随便放行」。此前在这里 return true，
        // 于是供应商还没加载完 / 用户一家都没配时，整个 catalog 会被全量曝给选择器。
        return enabledVendorKeys.has(vendorKey)
      })
      const normalized = toCatalogModelOptions(filteredRows)
      // 回填厂商显示名（getEnabledVendorKeys 已顺手缓存 key→name）。
      const names = vendorNamesCache
      const withVendorName = names
        ? normalized.map((opt) => {
            const name = opt.vendor ? names.get(opt.vendor.toLowerCase()) : undefined
            return { ...opt, ...(name ? { vendorName: name } : {}), configured: Boolean(opt.vendor && configuredVendorKeysCache?.has(opt.vendor.toLowerCase())) }
          })
        : normalized
      catalogOptionsCache.set(cacheKey, withVendorName)
      return withVendorName
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

export async function preloadModelOptions(kind?: NodeKind, requiredMode?: ProfileKind): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind, requiredMode)
  return filterHiddenOptionsByKind(catalogOptions, kind)
}

export async function resolveExecutableImageModel(params: {
  kind: 'image' | 'imageEdit'
  value: string | null | undefined
  vendor?: string | null | undefined
}): Promise<ResolvedExecutableImageModel> {
  const options = await preloadModelOptions(params.kind)
  return resolveExecutableImageModelFromOptions(options, params)
}
