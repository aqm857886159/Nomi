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

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
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
      const names = await getVendorNames()
      // 「能不能用」判一次（主进程给的 availability）；这里额外要的只是**模式级**匹配：
      // 同一个模型可能文生图发布了、改图那条没发布，节点问的是「这个模式能用吗」。
      const usableRows = keepUsableModelRows(Array.isArray(rows) ? rows : []).filter(
        (row) => Array.isArray(row.publishedModes) && row.publishedModes.includes(requiredMode),
      )
      const normalized = toCatalogModelOptions(usableRows)
      const annotated = normalized.map((opt) => {
        const name = opt.vendor ? names.get(opt.vendor.toLowerCase()) : undefined
        return name ? { ...opt, vendorName: name } : opt
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
