import { useEffect, useState } from 'react'
import {
  getWorkbenchModelCatalogHealth,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type BillingModelKind,
  type ModelCatalogHealthDto,
  type ModelCatalogModelDto,
} from '../workbench/api/modelCatalogApi'
import type { ModelOption, ModelOptionPricing, NodeKind } from './models'

export const MODEL_REFRESH_EVENT = 'tapcanvas-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

const catalogOptionsCache = new Map<string, ModelOption[]>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
let catalogHealthCache: ModelCatalogHealthDto | null = null
let catalogHealthPromise: Promise<ModelCatalogHealthDto> | null = null
let enabledVendorKeysCache: Set<string> | null = null
let enabledVendorKeysPromise: Promise<Set<string>> | null = null

const HIDDEN_IMAGE_MODEL_ID_RE = /^(gemini-.*-image(?:-(?:landscape|portrait))?|imagen-.*-(?:landscape|portrait))$/i

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

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
}

async function getCatalogHealth(): Promise<ModelCatalogHealthDto> {
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
        const enabled = new Set(
          (Array.isArray(vendors) ? vendors : [])
            .filter((v) => Boolean(v?.enabled))
            .map((v) => String(v?.key || '').trim().toLowerCase())
            .filter(Boolean),
        )
        enabledVendorKeysCache = enabled
        return enabled
      } finally {
        enabledVendorKeysPromise = null
      }
    })()
  }
  return enabledVendorKeysPromise
}

function resolveCatalogKind(kind?: NodeKind): BillingModelKind {
  if (kind === 'image' || kind === 'imageEdit') {
    return 'image'
  }
  if (kind === 'video') {
    return 'video'
  }
  return 'text'
}

export function normalizeCatalogLoadError(caught: unknown): Error {
  if (caught instanceof Error) {
    const message = caught.message.trim()
    if (
      caught instanceof TypeError ||
      /failed to fetch|networkerror|load failed|fetch failed/i.test(message)
    ) {
      return new Error('模型目录 API 未连接：请确认本地 API 8788 和 Postgres 已启动，然后刷新模型目录。')
    }
    return caught
  }
  return new Error('模型目录加载失败')
}

function trimModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimVendorIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function inferImageModelVendor(value: string | null | undefined): string | null {
  const normalized = trimModelIdentifier(value).toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('gpt') ||
    normalized.includes('openai') ||
    normalized.includes('dall') ||
    normalized.includes('o3-')
  ) {
    return 'openai'
  }
  if (normalized.includes('qwen')) {
    return 'qwen'
  }
  if (
    normalized.includes('gemini') ||
    normalized.includes('banana') ||
    normalized.includes('imagen')
  ) {
    return 'gemini'
  }
  return null
}

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
): ModelOption | null {
  const identifier = trimModelIdentifier(value)
  const normalizedIdentifier = normalizeModelId(identifier)
  if (!identifier) return null
  return (
    options.find((option) => {
      const rawValue = trimModelIdentifier(option.value)
      const rawModelKey = trimModelIdentifier(option.modelKey)
      const rawModelAlias = trimModelIdentifier(option.modelAlias)
      const normalizedValue = normalizeModelId(rawValue)
      const normalizedModelKey = normalizeModelId(rawModelKey)
      const normalizedModelAlias = normalizeModelId(rawModelAlias)
      return (
        identifier === rawValue ||
        identifier === rawModelKey ||
        identifier === rawModelAlias ||
        normalizedIdentifier === normalizedValue ||
        normalizedIdentifier === normalizedModelKey ||
        normalizedIdentifier === normalizedModelAlias
      )
    }) || null
  )
}

export function getModelOptionRequestAlias(
  options: readonly ModelOption[],
  value: string | null | undefined,
): string {
  const identifier = trimModelIdentifier(value)
  const matched = findModelOptionByIdentifier(options, identifier)
  const alias = trimModelIdentifier(matched?.modelAlias)
  if (alias) return alias
  const modelKey = trimModelIdentifier(matched?.modelKey)
  if (modelKey) return modelKey
  const fallbackValue = trimModelIdentifier(matched?.value)
  if (fallbackValue) return fallbackValue
  return identifier
}

function toCatalogModelPricing(pricing: ModelCatalogModelDto['pricing']): ModelOptionPricing | undefined {
  if (!pricing) return undefined
  const cost = typeof pricing.cost === 'number' && Number.isFinite(pricing.cost)
    ? Math.max(0, Math.floor(pricing.cost))
    : 0
  const specCosts = Array.isArray(pricing.specCosts)
    ? pricing.specCosts
        .map((spec) => {
          const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
          if (!specKey) return null
          const specCost = typeof spec.cost === 'number' && Number.isFinite(spec.cost)
            ? Math.max(0, Math.floor(spec.cost))
            : 0
          return {
            specKey,
            cost: specCost,
            enabled: typeof spec.enabled === 'boolean' ? spec.enabled : true,
          }
        })
        .filter((spec): spec is ModelOptionPricing['specCosts'][number] => spec !== null)
    : []
  return {
    cost,
    enabled: typeof pricing.enabled === 'boolean' ? pricing.enabled : true,
    specCosts,
  }
}

export function toCatalogModelOptions(items: ModelCatalogModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const item of items) {
    const alias = typeof item?.modelAlias === 'string' ? item.modelAlias.trim() : ''
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    const value = modelKey || alias
    if (!value || seen.has(value)) continue
    seen.add(value)
    const labelZh = typeof item?.labelZh === 'string' ? item.labelZh.trim() : ''
    const label = labelZh || alias || value
    const vendor = typeof item?.vendorKey === 'string' ? item.vendorKey : undefined
    out.push({
      value,
      label,
      vendor,
      modelKey: modelKey || value,
      modelAlias: alias || null,
      meta: item?.meta,
      pricing: toCatalogModelPricing(item?.pricing),
    })
  }
  return out
}

export type ResolvedExecutableImageModel = {
  value: string
  vendor: string | null
  didFallback: false
  shouldWriteBack: boolean
  reason: 'canonicalized' | null
  source: 'requested'
}

export type ModelOptionsState = {
  options: ModelOption[]
  error: Error | null
  healthError: Error | null
  loading: boolean
  health: ModelCatalogHealthDto | null
  status: ModelCatalogStatus
  statusMessage: string
}

export type ModelCatalogStatus =
  | 'loading'
  | 'api_unreachable'
  | 'catalog_empty'
  | 'kind_empty'
  | 'incomplete'
  | 'ready'

export function deriveModelCatalogStatus(input: {
  kind?: NodeKind
  options: readonly ModelOption[]
  health: ModelCatalogHealthDto | null
  error: Error | null
  healthError?: Error | null
  loading: boolean
}): { status: ModelCatalogStatus; message: string } {
  if (input.loading) {
    return { status: 'loading', message: '正在读取模型目录...' }
  }
  if (input.error) {
    return { status: 'api_unreachable', message: `模型目录加载失败：${input.error.message}` }
  }
  if (input.healthError) {
    return { status: 'api_unreachable', message: `模型目录健康检查失败：${input.healthError.message}` }
  }
  const catalogKind = resolveCatalogKind(input.kind)
  const health = input.health
  if (health?.issues.some((issue) => issue.code === 'catalog_empty' && issue.severity === 'error')) {
    return { status: 'catalog_empty', message: '模型目录为空' }
  }
  const kindSummary = health?.byKind.find((item) => item.kind === catalogKind)
  if (kindSummary && kindSummary.enabledModels === 0) {
    const label = catalogKind === 'image' ? '图像' : catalogKind === 'video' ? '视频' : '文本'
    return { status: 'kind_empty', message: `没有可用${label}模型` }
  }
  if (
    health?.issues.some((issue) =>
      issue.severity === 'error' &&
      (issue.kind === catalogKind || typeof issue.kind === 'undefined')
    )
  ) {
    return { status: 'incomplete', message: '模型目录配置不完整' }
  }
  if (input.options.length === 0) {
    const label = catalogKind === 'image' ? '图像' : catalogKind === 'video' ? '视频' : '文本'
    return { status: 'kind_empty', message: `没有可用${label}模型` }
  }
  return { status: 'ready', message: '模型目录可用' }
}

function resolveModelOptionVendor(
  option: ModelOption | null,
  explicitVendor: string | null,
  resolvedValue: string,
): string | null {
  const optionVendor = trimVendorIdentifier(option?.vendor)
  if (optionVendor) return optionVendor
  if (explicitVendor) return explicitVendor
  return inferImageModelVendor(resolvedValue)
}

export function resolveExecutableImageModelFromOptions(
  options: readonly ModelOption[],
  params: {
    kind: 'image' | 'imageEdit'
    value: string | null | undefined
    vendor?: string | null | undefined
  },
): ResolvedExecutableImageModel {
  const requestedValue = trimModelIdentifier(params.value)
  const requestedVendor = trimVendorIdentifier(params.vendor)
  const requestedOption = findModelOptionByIdentifier(options, requestedValue)

  if (requestedOption) {
    const resolvedValue = trimModelIdentifier(requestedOption.value)
    const resolvedVendor = resolveModelOptionVendor(requestedOption, requestedVendor || null, resolvedValue)
    const reason =
      requestedValue && requestedValue !== resolvedValue
        ? 'canonicalized'
        : null
      return {
        value: resolvedValue,
        vendor: resolvedVendor,
        didFallback: false,
      shouldWriteBack: reason !== null || requestedVendor !== trimVendorIdentifier(resolvedVendor),
      reason,
      source: 'requested',
    }
  }

  if (options.length === 0) {
    throw new Error('未找到可用图片模型：请先在系统模型管理中启用 image 模型。')
  }

  if (!requestedValue) {
    throw new Error('未选择图片模型：请在节点参数中选择一个已启用的 image 模型。')
  }

  throw new Error(`图片模型不可用：${requestedValue}。请在系统模型管理中启用该模型，或在节点参数中重新选择模型。`)
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
      catalogOptionsCache.set(cacheKey, normalized)
      return normalized
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

export function useModelOptionsState(kind?: NodeKind): ModelOptionsState {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [healthError, setHealthError] = useState<Error | null>(null)
  const [health, setHealth] = useState<ModelCatalogHealthDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions([])
    setError(null)
    setHealthError(null)
    setHealth(null)
    setLoading(true)
  }, [kind])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    let canceled = false
    setLoading(true)
    ;(async () => {
      try {
        const catalogOptions = await preloadModelOptions(kind)
        if (!canceled) {
          setError(null)
          setOptions(catalogOptions)
        }
      } catch (caught: unknown) {
      if (!canceled) {
        setError(normalizeCatalogLoadError(caught))
        setOptions([])
        setHealthError(null)
        setHealth(null)
      }
      }
      try {
        const catalogHealth = await getCatalogHealth()
        if (!canceled) {
          setHealth(catalogHealth)
          setHealthError(null)
        }
      } catch (caught: unknown) {
        if (!canceled) {
          setHealth(null)
          setHealthError(normalizeCatalogLoadError(caught))
        }
      }
      if (!canceled) {
        setLoading(false)
      }
    })()

    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  const derived = deriveModelCatalogStatus({ kind, options, health, error, healthError, loading })
  return {
    options,
    error,
    healthError,
    loading,
    health,
    status: derived.status,
    statusMessage: derived.message,
  }
}

export function useModelOptions(kind?: NodeKind): ModelOption[] {
  const state = useModelOptionsState(kind)
  if (state.error) throw state.error

  return state.options
}
