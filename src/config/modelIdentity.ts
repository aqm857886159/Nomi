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
  /** 所有能调用此模型的供应商（去重相同 vendor+modelKey）。length>1 = 多家可用。 */
  providers: ModelProviderRef[]
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

export interface ResolveBestProviderOptions {
  /** 用户锁定的供应商：在则优先用它（可用时）。 */
  lockedVendorKey?: string | null
  /** 仅在这些可用供应商里选（缺省=不过滤，picker 的 options 已是可用集）。 */
  usableVendorKeys?: Set<string> | null
}

/** 自动选最优供应商：锁定家优先 → 官方 > 内置中转 > 其余；同级保持 catalog 顺序（稳定）。 */
export function resolveBestProvider(model: DedupedModel, opts: ResolveBestProviderOptions = {}): ModelProviderRef | null {
  const providers = model.providers.filter(
    (p) => !opts.usableVendorKeys || (p.vendor != null && opts.usableVendorKeys.has(p.vendor)),
  )
  if (providers.length === 0) return null
  if (opts.lockedVendorKey) {
    const locked = providers.find((p) => p.vendor === opts.lockedVendorKey)
    if (locked) return locked
  }
  return providers.reduce((best, p) => (vendorTier(p.vendor) < vendorTier(best.vendor) ? p : best), providers[0])
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
      label: option.label || canonicalId,
      recognized: isRecognizedModel(option),
      providers: [ref],
    })
    order.push(canonicalId)
  }
  return order.map((id) => byId.get(id) as DedupedModel)
}
