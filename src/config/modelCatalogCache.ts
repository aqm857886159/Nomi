import {
  getWorkbenchModelCatalogHealth,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type ModelCatalogHealthDto,
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
        // 「可见」= 启用 **且** 现在能用（有 API key，或免鉴权）。只看 enabled 会把断开的供应商
        // （拔了 key 但 vendor.enabled 仍 true）的模型留在下拉，让用户误选到没钥匙的家 → 运行时报
        // `API key missing`。可用性必须由 hasApiKey 派生（根因修复 2026-06-08）。
        const enabled = new Set(
          (Array.isArray(vendors) ? vendors : [])
            .filter((v) => Boolean(v?.enabled) && (v?.authType === 'none' || Boolean(v?.hasApiKey)))
            .map((v) => String(v?.key || '').trim().toLowerCase())
            .filter(Boolean),
        )
        // 顺手缓存 key→显示名（节点下拉标注厂商用；自定义中转 key 是 baseUrl 派生串不宜直显）。
        const names = new Map<string, string>()
        for (const v of Array.isArray(vendors) ? vendors : []) {
          const key = String(v?.key || '').trim().toLowerCase()
          const name = String(v?.name || '').trim()
          if (key && name) names.set(key, name)
        }
        vendorNamesCache = names
        enabledVendorKeysCache = enabled
        return enabled
      } finally {
        enabledVendorKeysPromise = null
      }
    })()
  }
  return enabledVendorKeysPromise
}

async function getCatalogModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const cacheKey = catalogKind
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listWorkbenchModelCatalogModels({ kind: catalogKind, enabled: true })
      const enabledVendorKeys = await getEnabledVendorKeys()
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const vendorKey = String(row?.vendorKey || '').trim().toLowerCase()
        if (!vendorKey) return false
        if (!enabledVendorKeys.size) return true
        return enabledVendorKeys.has(vendorKey)
      })
      const normalized = toCatalogModelOptions(filteredRows)
      // 回填厂商显示名（getEnabledVendorKeys 已顺手缓存 key→name）。
      const names = vendorNamesCache
      const withVendorName = names
        ? normalized.map((opt) => {
            const name = opt.vendor ? names.get(opt.vendor.toLowerCase()) : undefined
            return name ? { ...opt, vendorName: name } : opt
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

export async function preloadModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind)
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
