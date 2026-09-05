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

/**
 * 「列出来的都能跑」是这一层对所有下游的**默认承诺**（根因修复 2026-06-08）：拔了 key 但 vendor
 * 仍 enabled 的家，它的模型不许出现在任何调用方眼前，否则用户选中就撞 `API key missing`。
 * 依赖这条承诺的不止选择器——agent 的可用模型清单（agent/availableModels.ts）、批量成本预估、
 * 「换到 X」指路（nodes/controls/narrowedModeGuidance.ts 的注释把它写成了前提）都在它上面。
 *
 * `includeUnconfigured` 是**唯一**的放宽口，给「选择器要把没配的家灰显出来、点了跳接入」那一个用途；
 * 拿到的行会带 `configured: false`，调用方**必须**自己拦住选中（见 useDedupedModelSelect）。
 * 默认关着 = fail-closed：将来新加的调用方不写这个参数，拿到的就是能跑的那一份。
 */
export type CatalogOptionScope = { includeUnconfigured?: boolean }

/**
 * 模型**选择器**的取景：连没配 key 的家也要（灰显沉底、点了跳接入）。
 *
 * 只有这一族界面配得上它——它们都把 `configured === false` 的行拦在选中之外，改为触发
 * `nomi-open-model-catalog`。别处（agent 可用模型清单、成本预估、「换到 X」指路）一律用默认取景，
 * 那边的前提是「列出来的都能跑」。放宽是**逐个调用点显式声明**的，不是全局默认。
 */
export const MODEL_PICKER_CATALOG_SCOPE: CatalogOptionScope = { includeUnconfigured: true }

async function getCatalogModelOptions(
  kind?: NodeKind,
  requiredMode = defaultPublishedMode(kind),
  scope: CatalogOptionScope = {},
): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const includeUnconfigured = scope.includeUnconfigured === true
  // 两种取景各自成缓存项：同 key 存两份不同内容会让先到的那份决定后到者看见什么。
  const cacheKey = `${catalogKind}:${requiredMode}:${includeUnconfigured ? 'all' : 'usable'}`
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listWorkbenchModelCatalogModels({ kind: catalogKind, enabled: true })
      const enabledVendorKeys = await getEnabledVendorKeys()
      const configuredVendorKeys = configuredVendorKeysCache ?? new Set<string>()
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (!row?.published || !Array.isArray(row.publishedModes) || !row.publishedModes.includes(requiredMode)) return false
        const vendorKey = String(row?.vendorKey || '').trim().toLowerCase()
        if (!vendorKey) return false
        // 空集 = 「一家可用供应商都没有」，不是「随便放行」。此前在这里 return true，
        // 于是供应商还没加载完 / 用户一家都没配时，整个 catalog 会被全量曝给选择器。
        if (!enabledVendorKeys.has(vendorKey)) return false
        return includeUnconfigured || configuredVendorKeys.has(vendorKey)
      })
      const normalized = toCatalogModelOptions(filteredRows)
      // 回填厂商显示名（getEnabledVendorKeys 已顺手缓存 key→name）与「这家现在能不能跑」。
      // `configured` 必须**无条件**打上：只在有显示名时才打，会让没名字的家 configured 恒 undefined，
      // 而下游把 undefined 当「已配置」——一条静默的假绿。
      const names = vendorNamesCache
      const annotated = normalized.map((opt) => {
        const vendorKey = opt.vendor?.toLowerCase()
        const name = vendorKey ? names?.get(vendorKey) : undefined
        return {
          ...opt,
          ...(name ? { vendorName: name } : {}),
          configured: Boolean(vendorKey && configuredVendorKeys.has(vendorKey)),
        }
      })
      catalogOptionsCache.set(cacheKey, annotated)
      return annotated
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

export async function preloadModelOptions(
  kind?: NodeKind,
  requiredMode?: ProfileKind,
  scope?: CatalogOptionScope,
): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind, requiredMode, scope)
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
