// 模型身份（canonical model id）+ 去重聚合 —— 治本「画布弹窗一大堆模型」的领域层（单一真相）。
//
// 根因（见 docs/plan/2026-06-23-model-picker-identity-dedup.md）：同一个底层模型被每个供应商
// 各列一份（火山/apimart/kie 对 Seedream 各用不同 modelKey），弹窗只按 modelKey 字符串去重、
// 认不出是同一个 → 平铺重复。这里给模型立「版本级 canonical 身份」，同模型只呈现一次、
// 收集所有能调它的供应商（providers[]），把「选哪家」交给上层（自动选最优 + 可锁）。
//
// 去重键优先级（版本级，非 archetype 家族级——archetype 会错误合并 Seedream 5.0/4.5/4.0）：
//   1) 显式 meta.canonicalModelId（curated 给跨供应商同模型打的稳定 id，唯一真相）
//   2) 规范化 labelZh（去能力后缀/空格/大小写；火山「Seedream 4.5」与 apimart「Seedream 4.5」→ 合并）
//   3) 兜底 value/modelKey（认不出的中转模型——不合并，各自独立，符合预期）
import type { ModelOption } from './models'

export interface ModelProviderRef {
  vendor?: string
  modelKey?: string
  modelAlias?: string | null
  option: ModelOption
}

export interface DedupedModel {
  /** 版本级 canonical 身份；全 App 同一模型唯一。 */
  canonicalId: string
  /** 展示名（取首个供应商的 label）。 */
  label: string
  /** 是否有内置档案身份（archetype）——认得的进主列表，认不出的沉「其他」。 */
  recognized: boolean
  /** 所有精确调用身份（去重相同 vendor+modelKey）；同一家可有多个明确变体。 */
  providers: ModelProviderRef[]
}

export type CatalogLifecycle = 'flagship' | 'value' | 'legacy' | 'companion'

const CATALOG_LIFECYCLE_RANK: Record<CatalogLifecycle, number> = {
  flagship: 0,
  value: 1,
  companion: 2,
  legacy: 3,
}

function explicitCatalogLifecycle(option: ModelOption): CatalogLifecycle | null {
  const value = readMeta(option).catalogLifecycle
  return value === 'flagship' || value === 'value' || value === 'legacy' || value === 'companion' ? value : null
}

/** A merged model uses its strongest explicit curated route. Unknown/custom names are never classified heuristically. */
export function modelCatalogLifecycle(model: DedupedModel): CatalogLifecycle | null {
  let lifecycle: CatalogLifecycle | null = null
  for (const provider of model.providers) {
    const candidate = explicitCatalogLifecycle(provider.option)
    if (candidate && (!lifecycle || CATALOG_LIFECYCLE_RANK[candidate] < CATALOG_LIFECYCLE_RANK[lifecycle])) {
      lifecycle = candidate
    }
  }
  return lifecycle
}

export function sortModelsByCatalogLifecycle(models: readonly DedupedModel[]): DedupedModel[] {
  return models
    .map((model, index) => ({ model, index, lifecycle: modelCatalogLifecycle(model) }))
    .sort((left, right) => {
      // Unclassified user models stay with companion routes. Stable index keeps their own order intact.
      const leftRank = left.lifecycle ? CATALOG_LIFECYCLE_RANK[left.lifecycle] : CATALOG_LIFECYCLE_RANK.companion
      const rightRank = right.lifecycle ? CATALOG_LIFECYCLE_RANK[right.lifecycle] : CATALOG_LIFECYCLE_RANK.companion
      return leftRank - rightRank || left.index - right.index
    })
    .map(({ model }) => model)
}

// 能力后缀：kie 把 GPT Image 2 拆成「· 文生图」「· 图生图」两行——去掉后缀让它们与
// apimart 的「GPT Image 2」合并成一个模型。
const CAPABILITY_SUFFIX_RE = /\s*[·•・]\s*(文生图|图生图|改图|文生视频|图生视频|首尾帧|参考图?|编辑).*$/u

function readMeta(option: ModelOption): Record<string, unknown> {
  return option?.meta && typeof option.meta === 'object' ? (option.meta as Record<string, unknown>) : {}
}

export function normalizeModelLabel(label: string): string {
  return label
    .replace(CAPABILITY_SUFFIX_RE, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function deriveCanonicalModelId(option: ModelOption): string {
  const meta = readMeta(option)
  const explicit = typeof meta.canonicalModelId === 'string' ? meta.canonicalModelId.trim() : ''
  if (explicit) return explicit
  const label = typeof option?.label === 'string' ? option.label : ''
  const norm = normalizeModelLabel(label)
  if (norm) return norm
  return (option?.value || option?.modelKey || '').trim()
}

export function isRecognizedModel(option: ModelOption): boolean {
  const meta = readMeta(option)
  return typeof meta.archetypeId === 'string' && meta.archetypeId.trim().length > 0
}

// 供应商分级（自动选最优：官方 > 内置中转 > 用户自接/未知）。是默认挑选的稳定排序键，
// 不是硬限制——用户可在弹窗点开锁定任意一家。分级错了也只影响默认项，零生成风险。
const OFFICIAL_VENDOR_KEYS = new Set([
  'volcengine', 'modelscope', 'openai', 'anthropic', 'claude', 'gemini', 'google',
  'deepseek', 'dashscope', 'zhipu', 'moonshot', 'kimi', 'siliconflow', 'groq', 'openrouter',
])
const BUILTIN_RELAY_VENDOR_KEYS = new Set(['apimart', 'kie', 'newapi'])

export function vendorTier(vendorKey?: string): number {
  const k = (vendorKey || '').toLowerCase()
  if (OFFICIAL_VENDOR_KEYS.has(k)) return 0
  if (BUILTIN_RELAY_VENDOR_KEYS.has(k)) return 1
  return 2
}

/** 按 canonical 身份聚合：同模型只一条，收集所有供应商；保持首次出现顺序。 */
export function dedupeModelOptions(options: ModelOption[]): DedupedModel[] {
  if (!Array.isArray(options)) return []
  const byId = new Map<string, DedupedModel>()
  const order: string[] = []
  for (const option of options) {
    if (!option) continue
    const canonicalId = deriveCanonicalModelId(option)
    if (!canonicalId) continue
    const ref: ModelProviderRef = {
      vendor: option.vendor,
      modelKey: option.modelKey,
      modelAlias: option.modelAlias ?? null,
      option,
    }
    const existing = byId.get(canonicalId)
    if (existing) {
      const dup = existing.providers.some((p) => p.vendor === ref.vendor && p.modelKey === ref.modelKey)
      if (!dup) existing.providers.push(ref)
      existing.recognized = existing.recognized || isRecognizedModel(option)
      continue
    }
    byId.set(canonicalId, {
      canonicalId,
      // 展示名去能力后缀（kie 把 GPT Image 2 拆「· 文生图/· 图生图」两行，合并成一条后
      // 不该带着首家的后缀当组名）；无后缀的 label 原样。
      label: option.variant?.familyLabel || (option.label || canonicalId).replace(CAPABILITY_SUFFIX_RE, '').trim() || canonicalId,
      recognized: isRecognizedModel(option),
      providers: [ref],
    })
    order.push(canonicalId)
  }
  return sortModelsByCatalogLifecycle(order.map((id) => byId.get(id) as DedupedModel))
}

/**
 * 「同一个模型，先走哪家」的**唯一**排序规则——每个模型选择器、自动选家、批量摊平都用这一份。
 *
 * 四级判据，从强到弱：
 *   1. **能不能跑**：没配 key 的家永远沉底（`configured === false` 才算没配；缺省视为能跑，
 *      与全仓 `configured !== false` 同口径。用 `Boolean(configured)` 会把「没标注」误判成没配）。
 *   2. **用户的优先供应商顺序**（设置 → AI 策略）。用户明说过的话，就按他说的来。
 *   3. **供应商分级** `vendorTier`：官方 > 内置中转 > 用户自接/未知。用户没说过话时的默认，
 *      也是 2026-06-23 起「自动选最优」一直用的那把尺——**这一级不能省**：省掉它就退化成按厂商名
 *      字母序，同一个模型的默认家会从火山方舟静默漂到 apimart，而没有任何人做过这个决定。
 *   4. 厂商显示名字母序 → catalog 原序（纯为稳定，不携带任何偏好语义）。
 */
export function sortModelProviders<T extends ModelProviderRef>(providers: readonly T[], orderedVendorKeys: readonly string[] = []): T[] {
  const rank = new Map(orderedVendorKeys.map((key, index) => [key.toLowerCase(), index]))
  const rankOf = (provider: ModelProviderRef): number => rank.get((provider.vendor || '').toLowerCase()) ?? Number.MAX_SAFE_INTEGER
  return providers.map((provider, index) => ({ provider, index })).sort((a, b) => {
    const configured = Number(b.provider.option.configured !== false) - Number(a.provider.option.configured !== false)
    if (configured) return configured
    const pref = rankOf(a.provider) - rankOf(b.provider)
    if (pref) return pref
    const tier = vendorTier(a.provider.vendor) - vendorTier(b.provider.vendor)
    if (tier) return tier
    return (a.provider.option.vendorName || a.provider.vendor || '').localeCompare(b.provider.option.vendorName || b.provider.vendor || '', undefined, { sensitivity: 'base' }) || a.index - b.index
  }).map(({ provider }) => provider)
}

export function sortDedupedModelsByVendorPreference(models: readonly DedupedModel[], orderedVendorKeys: readonly string[] = []): DedupedModel[] {
  return models.map((model) => {
    const providers = sortModelProviders(model.providers, orderedVendorKeys)
    return { ...model, providers }
  }).sort((a, b) => {
    const aConfigured = Number(a.providers.some((provider) => provider.option.configured !== false))
    const bConfigured = Number(b.providers.some((provider) => provider.option.configured !== false))
    return bConfigured - aConfigured
  }).map((model) => model)
}
