import {
  getWorkbenchModelCatalogHealth,
  listWorkbenchModelCatalogMappings,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type ModelCatalogHealthDto,
  type ModelCatalogModelDto,
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
export type ModelQueryMode = ProfileKind | 'any-published'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

const catalogOptionsCache = new Map<string, ModelOption[]>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
/**
 * 目录行按**目录桶**（image / video / audio / model3d / text）存一份：同一个桶的各个模式（文生图 / 改图……）
 * 都从这一份里在内存里筛，第一次遇到一个新模式不再去问主进程（以前每个「桶:模式」各打一次 IPC）。
 */
const catalogRowsCache = new Map<string, readonly ModelCatalogModelDto[]>()
const catalogRowsPromise = new Map<string, Promise<readonly ModelCatalogModelDto[]>>()
/**
 * 渠道 mapping 全表：`undefined` = 问过了但桥答不出来（无桥 / 老 preload / 读失败 → 调用方一律 fail-open 不收窄）；
 * 还没载过时 `channelMappingsLoaded === false`。
 */
let channelMappingsCache: readonly unknown[] | undefined
let channelMappingsLoaded = false
let channelMappingsPromise: Promise<readonly unknown[] | undefined> | null = null
/** 缓存里有东西载入了 / 作废了 → 通知订阅者（`useSyncExternalStore`）重读。 */
const catalogCacheListeners = new Set<() => void>()
let catalogHealthCache: ModelCatalogHealthDto | null = null
let catalogHealthPromise: Promise<ModelCatalogHealthDto> | null = null
let vendorNamesCache: Map<string, string> | null = null
let vendorNamesPromise: Promise<Map<string, string>> | null = null

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

function notifyCatalogCacheChanged(): void {
  for (const listener of [...catalogCacheListeners]) listener()
}

/** 订阅「目录缓存里有东西载入了 / 作废了」。给 `useSyncExternalStore` 用。 */
export function subscribeCatalogCache(listener: () => void): () => void {
  catalogCacheListeners.add(listener)
  return () => { catalogCacheListeners.delete(listener) }
}

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
  catalogRowsCache.clear()
  catalogRowsPromise.clear()
  channelMappingsCache = undefined
  channelMappingsLoaded = false
  channelMappingsPromise = null
  catalogHealthCache = null
  catalogHealthPromise = null
  vendorNamesCache = null
  vendorNamesPromise = null
}

export async function getCatalogHealth(): Promise<ModelCatalogHealthDto> {
  if (catalogHealthCache) return catalogHealthCache
  if (!catalogHealthPromise) {
    catalogHealthPromise = (async () => {
      try {
        const health = await getWorkbenchModelCatalogHealth()
        catalogHealthCache = health
        notifyCatalogCacheChanged()
        return health
      } finally {
        catalogHealthPromise = null
      }
    })()
  }
  return catalogHealthPromise
}

/** 健康度在内存里就同步给；没载过 → null（不触发请求）。 */
export function peekCatalogHealth(): ModelCatalogHealthDto | null {
  return catalogHealthCache
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  notifyCatalogCacheChanged()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

/**
 * 供应商 key → 显示名（节点下拉标注厂商用；自定义中转的 key 是 baseUrl 派生串不宜直显）。
 *
 * 这里**只取名字**。「这一家现在能不能跑」曾经也在这一层判（`enabled && (authType==='none' || hasApiKey)`），
 * 那是全仓第三份同语义判据——设置页是第一份、助手下拉是第二份，三份在 2026-09-12 的真实验收里
 * 当场给出了两个答案（P0-10）。判据已收回主进程 `electron/shared/modelAvailability.ts`，
 * 随每一行模型以 `availability` 下发。
 */
async function getVendorNames(): Promise<Map<string, string>> {
  if (vendorNamesCache) return vendorNamesCache
  if (!vendorNamesPromise) {
    vendorNamesPromise = (async () => {
      try {
        const vendors = await listWorkbenchModelCatalogVendors()
        const names = new Map<string, string>()
        for (const vendor of Array.isArray(vendors) ? vendors : []) {
          const key = String(vendor?.key || '').trim().toLowerCase()
          const name = String(vendor?.name || '').trim()
          if (key && name) names.set(key, name)
        }
        vendorNamesCache = names
        return names
      } finally {
        vendorNamesPromise = null
      }
    })()
  }
  return vendorNamesPromise
}

/**
 * **全 App 唯一**一道「这个模型现在能不能用」的闸（2026-09-06 用户拍板放在这一层，
 * 2026-09-12 把判据本身收回主进程）：没接入的供应商、没走完认证的模型、钥匙解不开的家，
 * 它的模型**不出现**——不是沉底、不是灰显，是根本不进到任何调用方眼前。
 *
 * 闸开在这里而不是各个 picker 里，是因为下游不止选择器：agent 可用模型清单、成本预估、
 * 「换到 X」指路的前提都是「列出来的都能跑」，各滤各的就一定有漏掉的那个。
 *
 * 导出是给设计实验室用的：那边喂**整份**目录（含没接入的家）进来，由这道真闸决定屏上剩下什么。
 */
export function keepUsableModelRows<T extends { availability?: { usable: boolean } }>(
  rows: readonly T[],
): T[] {
  // 缺 `availability` = 这一行没经过主进程投影（夹具/旧缓存），按 fail-closed 当作不可用。
  return rows.filter((row) => row.availability?.usable === true)
}

function defaultPublishedMode(kind?: NodeKind): ProfileKind {
  if (kind === 'imageEdit') return 'image_edit'
  if (kind === 'image') return 'text_to_image'
  if (kind === 'video') return 'text_to_video'
  if (kind === 'audio') return 'text_to_audio'
  if (kind === 'model3d') return 'text_to_3d'
  return 'chat'
}

async function getCatalogRows(catalogKind: ModelCatalogModelDto['kind']): Promise<readonly ModelCatalogModelDto[]> {
  const cached = catalogRowsCache.get(catalogKind)
  if (cached) return cached
  const inflight = catalogRowsPromise.get(catalogKind)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listWorkbenchModelCatalogModels({ kind: catalogKind, enabled: true })
      const list = Array.isArray(rows) ? rows : []
      catalogRowsCache.set(catalogKind, list)
      return list
    } finally {
      catalogRowsPromise.delete(catalogKind)
    }
  })()
  catalogRowsPromise.set(catalogKind, promise)
  return promise
}

/** 从一个桶的目录行里筛出「这个模式现在能用」的选项。纯函数：同样的行 + 名字 = 同样的结果。 */
function optionsFromRows(
  rows: readonly ModelCatalogModelDto[],
  names: Map<string, string>,
  requiredMode: ModelQueryMode,
): ModelOption[] {
  // 「能不能用」判一次（主进程给的 availability）；这里额外要的只是**模式级**匹配：
  // 同一个模型可能文生图发布了、改图那条没发布，节点问的是「这个模式能用吗」。
  const usableRows = keepUsableModelRows(rows).filter(
    (row) => Array.isArray(row.publishedModes) && (requiredMode === 'any-published'
      ? row.publishedModes.length > 0 : row.publishedModes.includes(requiredMode)),
  )
  return toCatalogModelOptions(usableRows).map((opt) => {
    const name = opt.vendor ? names.get(opt.vendor.toLowerCase()) : undefined
    return name ? { ...opt, vendorName: name } : opt
  })
}

function catalogOptionsKey(kind: NodeKind | undefined, requiredMode: ModelQueryMode) {
  const catalogKind = resolveCatalogKind(kind)
  return { catalogKind, cacheKey: `${catalogKind}:${requiredMode}` }
}

async function getCatalogModelOptions(
  kind?: NodeKind,
  requiredMode: ModelQueryMode = defaultPublishedMode(kind),
): Promise<ModelOption[]> {
  const { catalogKind, cacheKey } = catalogOptionsKey(kind, requiredMode)
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await getCatalogRows(catalogKind)
      const names = await getVendorNames()
      const annotated = optionsFromRows(rows, names, requiredMode)
      catalogOptionsCache.set(cacheKey, annotated)
      return annotated
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

type ChannelMappingsSnapshot = Readonly<{ loaded: boolean; list: readonly unknown[] | undefined }>
const NOT_LOADED_MAPPINGS: ChannelMappingsSnapshot = Object.freeze({ loaded: false, list: undefined })
let channelMappingsSnapshot: ChannelMappingsSnapshot = NOT_LOADED_MAPPINGS

/**
 * 渠道 mapping 全表：内存里有就同步给；`loaded === false` = 还没载过（调用方按「查不到」fail-open）。
 * 同步、零 IO、同一份数据同一个引用——挂载路径只许读这个。
 */
export function peekChannelMappings(): ChannelMappingsSnapshot {
  return channelMappingsLoaded ? channelMappingsSnapshot : NOT_LOADED_MAPPINGS
}

/** 载一次渠道 mapping 全表（异步 IPC）。同一时刻只有一趟在路上；目录变更由 notifyModelOptionsRefresh 作废。 */
export function loadChannelMappings(): Promise<readonly unknown[] | undefined> {
  if (channelMappingsLoaded) return Promise.resolve(channelMappingsCache)
  if (channelMappingsPromise) return channelMappingsPromise
  const promise: Promise<readonly unknown[] | undefined> = listWorkbenchModelCatalogMappings()
    .catch(() => undefined)
    .then((list) => {
      if (channelMappingsPromise !== promise) return list // 路上被作废了：这份结果不落缓存
      channelMappingsCache = list
      channelMappingsLoaded = true
      channelMappingsSnapshot = Object.freeze({ loaded: true, list })
      channelMappingsPromise = null
      notifyCatalogCacheChanged()
      return list
    })
  channelMappingsPromise = promise
  return promise
}

/** 生成节点会问到的目录桶。启动后把它们和健康度、供应商名、渠道 mapping 一起载进内存。 */
const RESIDENT_CATALOG_KINDS: readonly NodeKind[] = ['image', 'video', 'audio', 'model3d', 'text']

/**
 * 应用启动后（以及每次目录作废后）在后台把目录载进内存：之后点卡挂生成框只读内存，0 次 IO。
 * 失败不抛：没载上的那一块等第一次用到时再载（各自的 load 本来就是「没有就载」）。
 */
export async function warmModelCatalog(): Promise<void> {
  await Promise.allSettled([
    getCatalogHealth(),
    getVendorNames(),
    loadChannelMappings(),
    ...RESIDENT_CATALOG_KINDS.map((kind) => getCatalogRows(resolveCatalogKind(kind))),
  ])
  notifyCatalogCacheChanged()
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

/**
 * 同步取一次「现在就能跑」的清单：命中缓存立刻给值，没命中给 null（不触发请求）。
 *
 * 为什么要有：清单原来只能异步拿。节点被选中时 composer 是重新挂载的，第一帧必然空 →
 * 界面先画「无模型·配置模型」再跳真实芯片（用户 2026-10-11 走查第 4 条）。有了同步首值，
 * 这条闪烁在缓存命中时直接消失；没命中才回到异步那一跳。
 */
export function peekCatalogModelOptions(kind?: NodeKind, requiredMode?: ModelQueryMode): ModelOption[] | null {
  const mode = requiredMode ?? defaultPublishedMode(kind)
  const { catalogKind, cacheKey } = catalogOptionsKey(kind, mode)
  let cached = catalogOptionsCache.get(cacheKey)
  // 这个模式还没人问过、但它那个桶的行和供应商名已经在内存里：当场在内存里筛出来记下（不打 IPC）。
  if (!cached) {
    const rows = catalogRowsCache.get(catalogKind)
    if (!rows || !vendorNamesCache) return null
    cached = optionsFromRows(rows, vendorNamesCache, mode)
    catalogOptionsCache.set(cacheKey, cached)
  }
  return visibleOptionsFor(cached, kind)
}

/** 同一份缓存 + 同一个 kind → 同一个数组引用（`useSyncExternalStore` / 选择器要的稳定快照）。 */
const visibleOptionsCache = new WeakMap<ModelOption[], Map<string, ModelOption[]>>()
function visibleOptionsFor(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  let byKind = visibleOptionsCache.get(options)
  if (!byKind) { byKind = new Map(); visibleOptionsCache.set(options, byKind) }
  const key = kind ?? ''
  let visible = byKind.get(key)
  if (!visible) { visible = filterHiddenOptionsByKind(options, kind); byKind.set(key, visible) }
  return visible
}

export async function preloadModelOptions(
  kind?: NodeKind,
  requiredMode?: ModelQueryMode,
): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind, requiredMode)
  return visibleOptionsFor(catalogOptions, kind)
}

export async function resolveExecutableImageModel(params: {
  kind: 'image' | 'imageEdit'
  value: string | null | undefined
  vendor?: string | null | undefined
}): Promise<ResolvedExecutableImageModel> {
  const options = await preloadModelOptions(params.kind)
  return resolveExecutableImageModelFromOptions(options, params)
}
