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
let runnableVendorKeysCache: Set<string> | null = null
let runnableVendorKeysPromise: Promise<Set<string>> | null = null
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
  runnableVendorKeysCache = null
  runnableVendorKeysPromise = null
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

/**
 * 「现在就能跑」的供应商 key 集合：启用 **且** 手上有钥匙（有 API key，或本来就免鉴权）。
 *
 * 只看 `enabled` 会把断开的家（拔了 key 但 vendor.enabled 仍 true）留下，用户选中就撞
 * `API key missing`。可用性必须由 hasApiKey 派生，不能由「有没有这一行」派生。
 */
async function getRunnableVendorKeys(): Promise<Set<string>> {
  if (runnableVendorKeysCache) return runnableVendorKeysCache
  if (!runnableVendorKeysPromise) {
    runnableVendorKeysPromise = (async () => {
      try {
        const vendors = await listWorkbenchModelCatalogVendors()
        const rows = Array.isArray(vendors) ? vendors : []
        const runnable = new Set(
          rows
            .filter((v) => Boolean(v?.enabled) && (v?.authType === 'none' || Boolean(v?.hasApiKey)))
            .map((v) => String(v?.key || '').trim().toLowerCase())
            .filter(Boolean),
        )
        // 顺手缓存 key→显示名（节点下拉标注厂商用；自定义中转 key 是 baseUrl 派生串不宜直显）。
        const names = new Map<string, string>()
        for (const v of rows) {
          const key = String(v?.key || '').trim().toLowerCase()
          const name = String(v?.name || '').trim()
          if (key && name) names.set(key, name)
        }
        vendorNamesCache = names
        runnableVendorKeysCache = runnable
        return runnable
      } finally {
        runnableVendorKeysPromise = null
      }
    })()
  }
  return runnableVendorKeysPromise
}

/**
 * **全 App 唯一**一道「这一家现在能不能跑」的闸（2026-09-06 用户拍板）：没接入的供应商，
 * 它的模型**不出现**——不是沉底、不是灰显，是根本不进到任何调用方眼前。闸开在这里而不是各个
 * picker 里，是因为下游不止选择器：agent 可用模型清单、成本预估、「换到 X」指路的前提都是
 * 「列出来的都能跑」，各滤各的就一定有漏掉的那个。
 *
 * 导出是给设计实验室用的：那边喂**整份**目录（含没接入的家）进来，由这道真闸决定屏上剩下什么。
 */
export function keepRunnableVendorOptions(
  options: readonly ModelOption[],
  runnableVendorKeys: ReadonlySet<string>,
): ModelOption[] {
  // 空集 = 「一家都没接入」，不是「随便放行」：这时候选择器该是空的（由上层给出诚实空态）。
  return options.filter((option) => runnableVendorKeys.has(String(option.vendor || '').trim().toLowerCase()))
}

function defaultPublishedMode(kind?: NodeKind): ProfileKind {
  if (kind === 'imageEdit') return 'image_edit'
  if (kind === 'image') return 'text_to_image'
  if (kind === 'video') return 'text_to_video'
  if (kind === 'audio') return 'text_to_audio'
  if (kind === 'model3d') return 'text_to_3d'
  return 'chat'
}

async function getCatalogModelOptions(
  kind?: NodeKind,
  requiredMode = defaultPublishedMode(kind),
): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const cacheKey = `${catalogKind}:${requiredMode}`
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listWorkbenchModelCatalogModels({ kind: catalogKind, enabled: true })
      const runnableVendorKeys = await getRunnableVendorKeys()
      const publishedRows = (Array.isArray(rows) ? rows : []).filter(
        (row) => Boolean(row?.published) && Array.isArray(row.publishedModes) && row.publishedModes.includes(requiredMode),
      )
      // 「能不能跑」只判一次，就在 keepRunnableVendorOptions 里——这里再顺手滤一遍 vendorKey
      // 就是第二份同语义规则，两份迟早漂。
      const normalized = keepRunnableVendorOptions(toCatalogModelOptions(publishedRows), runnableVendorKeys)
      // 回填厂商显示名（getRunnableVendorKeys 已顺手缓存 key→name）。
      const names = vendorNamesCache
      const annotated = names
        ? normalized.map((opt) => {
            const name = opt.vendor ? names.get(opt.vendor.toLowerCase()) : undefined
            return name ? { ...opt, vendorName: name } : opt
          })
        : normalized
      catalogOptionsCache.set(cacheKey, annotated)
      return annotated
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

/**
 * 测试/设计实验室专用：把一份目录直接放进缓存，让**现役那条链**（`useModelOptionsState`
 * → `preloadModelOptions`）在没有桌面桥的环境里也能拿到真模型。
 *
 * 为什么要有它：实验室跑在浏览器里，`listWorkbenchModelCatalogModels` 走的是 IPC 桥，
 * 无桥时 catch 成空 → 底栏参数条一个模型都没有、一个参数都渲不出来。以前的绕法是
 * 由夹具**手喂 props 给 `InlineParameterBar`**，那等于绕开了「节点怎么拿到模型」这一整段
 * ——屏上那条参数条就不再是节点上那一条了。种缓存只替掉**最外面那一次取数**：
 * 从这里往下（选谁当默认、按 `modelKey` 认档案、算出哪些参数、渲染成什么）全部仍是现役代码。
 * 种进来的是已解析的 `ModelOption[]`，所以调用方要自己保证喂的是真身份串（写错一个字，
 * 下游认不出档案，参数就空了——那正是这条链会当场露馅的地方）。
 *
 * health 一并种：无桥时 `getCatalogHealth()` 会抛，`deriveModelCatalogStatus` 于是把状态
 * 判成 `api_unreachable`，参数条上会挂一句「目录连不上」——那是环境的噪音，不是形态。
 */
export function seedModelCatalogForTests(
  health: ModelCatalogHealthDto,
  entries: readonly { kind: NodeKind; requiredMode: ProfileKind; options: readonly ModelOption[] }[],
): void {
  catalogHealthCache = health
  for (const entry of entries) {
    catalogOptionsCache.set(`${resolveCatalogKind(entry.kind)}:${entry.requiredMode}`, [...entry.options])
  }
}

export async function preloadModelOptions(
  kind?: NodeKind,
  requiredMode?: ProfileKind,
): Promise<ModelOption[]> {
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
