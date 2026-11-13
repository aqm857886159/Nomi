// 模型框的「默认顺序 + 默认收起」——只给**从没整理过模型框**的创作者用。
//
// 依据：LibTV 模型菜单顺序（创作者用量排序）+ 我们自己的判断（Veo 是海外创作者的主力，放在 13–14）。
// 这是一份**候选默认**，不动任何人存下来的东西：
//   · 创作者排过序或隐藏过（`modelOrder` / `hiddenModelIds` 任一非空）→ 这里整个不生效，他存的原样用；
//   · 从没动过 → 按下面的顺序排，收起名单里的行进「更多」（点一下就出来，不是删除、不是隐藏）；
//   · 节点上正在用的模型即使在收起名单里，也照常显示和生成（「更多」只管新开菜单时它排在哪）；
//   · 名单里写了、仓库里没有的名字，什么也不发生（只按行键匹配，没有就没有）。
//
// 行的标识：APIMart 目录行的 `modelKey`（线上型号名，纯英文，改显示名不会变）；变体行是 `modelKey#变体id`
// （变体 id 是档案里的英文 id）。同一个模型在别家供应商里 modelKey 不同，靠目录的跨家身份表
// （`CANONICAL_MODEL_IDS`）认成同一行，没有该表覆盖的别家行不吃默认（和没列出的新模型一样排后面、默认显示）。
// 名单里写了、目录里没有的标识：测试直接红（`modelBoxDefaults.test.ts`），不再悄悄跳过。
// 没列进两张表的行（新接入的、别家供应商的）排在列出的后面、默认显示——新东西不会因为没排过就消失。
import { CANONICAL_MODEL_IDS } from '../../electron/shared/canonicalModelIds'
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'
import type { DedupedModel } from './modelIdentity'

/** 默认显示，按这个顺序（视频在前、图片在后；菜单一次只放一种，互不干扰）。 */
const DEFAULT_ORDER: readonly string[] = [
  // 视频
  'doubao-seedance-2.5',
  'doubao-seedance-2.0#standard',
  'wan3.0-video',
  'kling-v4',
  'MiniMax-H3',
  'doubao-seedance-2.0#fast',
  'wan3.0-video-prime',
  'doubao-seedance-2.0#mini',
  'happyhorse-1.1',
  'kling-3.0-turbo',
  'kling-v3',
  'wan2.7',
  'veo3.1-fast#fast',
  'veo3.1-fast#quality',
  'MiniMax-Hailuo-2.3#standard',
  'viduq3-pro',
  'viduq4-preview',
  'MiniMax-Hailuo-2.3#fast',
  // 图片
  'gpt-image-2.6-flare',
  'gpt-image-2.6-sunburst',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image-preview',
  'doubao-seedream-5-0-pro',
  'flux-3-image',
  'qwen-image-3.0#standard',
  'qwen-image-3.0#pro',
  'gpt-image-2.5-flare',
  'doubao-seedream-4.5',
  'z-image-turbo',
]

/** 默认收起（进「更多」）。 */
const DEFAULT_COLLAPSED: readonly string[] = [
  // 视频
  'viduq3#standard',
  'viduq3#mix',
  'viduq3-turbo',
  'veo3.1-fast#lite',
  'veo3.1-fast-official',
  'veo3.1-quality-official',
  'grok-imagine-1.5-video-apimart',
  'grok-imagine-video-1.5',
  'pixverse-v6',
  'pixverse-v6-max',
  'muse-video-ext',
  'flux-3-video',
  'Omni-Flash-Ext',
  'gemini-omni-1.2-flash',
  'gemini-omni-1.2-flash-ext',
  'MiniMax-H3-Regeneration',
  // 图片
  'gpt-image-2.5-sunburst',
  'gpt-image-2',
  'gemini-2.5-flash-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-nano-banana-2.1-ext',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-lite-image-ext',
  'flux-3-image-klein',
  'grok-imagine-2.0-ext',
  'grok-imagine-image-2.0',
  'hy-image-v3.5-preview',
  'muse-image-ext',
  'wan2.7-image',
  'wan2.7-image-pro',
  'qwen-image-2.0#standard',
  'qwen-image-2.0#pro',
]

const RANK = new Map(DEFAULT_ORDER.map((key, index) => [key, index]))
const COLLAPSED = new Set(DEFAULT_COLLAPSED)

/** 跨家身份表倒过来：一个 modelKey → 同一个模型在各家的 modelKey（含自己）。 */
const SIBLING_KEYS: ReadonlyMap<string, readonly string[]> = (() => {
  const byCanonical = new Map<string, string[]>()
  for (const [modelKey, canonical] of Object.entries(CANONICAL_MODEL_IDS)) byCanonical.set(canonical, [...(byCanonical.get(canonical) ?? []), modelKey])
  return new Map(Object.entries(CANONICAL_MODEL_IDS).map(([modelKey, canonical]) => [modelKey, byCanonical.get(canonical) ?? [modelKey]]))
})()

/** 一个模型（整行）能被认作的全部稳定标识：各家 modelKey + 同一模型在别家的 modelKey。 */
function modelStableKeys(model: Pick<DedupedModel, 'providers'>): string[] {
  const keys = new Set<string>()
  for (const provider of model.providers) {
    const modelKey = (provider.modelKey || provider.option.modelKey || '').trim()
    if (!modelKey) continue
    for (const sibling of SIBLING_KEYS.get(modelKey) ?? [modelKey]) keys.add(sibling)
  }
  return [...keys]
}

type DefaultsRow = { model: Pick<DedupedModel, 'providers'>; variant?: { id: string } }

/** 创作者整理过吗：排过序或隐藏过任一即「整理过」——默认整个不生效，存的原样。 */
export function isModelBoxTouched(preference?: ModelBoxPreferenceSettings | null): boolean {
  return Boolean(preference && (preference.modelOrder.length > 0 || preference.hiddenModelIds.length > 0))
}

/**
 * 一行默认排第几（不在表里 = 排在所有列出的后面）。变体行用 `标识#变体id` 精确找；
 * 无变体展开的调用方（分镜、设置页）是整模型行，取它名下最靠前的位置。
 */
function defaultRank(row: DefaultsRow): number {
  let best = Number.MAX_SAFE_INTEGER
  for (const stable of modelStableKeys(row.model)) {
    if (row.variant) {
      const exact = RANK.get(`${stable}#${row.variant.id}`)
      if (exact !== undefined && exact < best) best = exact
      continue
    }
    for (const [listed, rank] of RANK) if ((listed === stable || listed.startsWith(`${stable}#`)) && rank < best) best = rank
  }
  return best
}

/** 一行默认是否收起。整模型行：名下所有列出的位置都在收起名单里才收（有一个默认显示，这个模型就显示）。 */
function defaultCollapsed(row: DefaultsRow): boolean {
  const listed: string[] = []
  for (const stable of modelStableKeys(row.model)) {
    if (row.variant) listed.push(`${stable}#${row.variant.id}`)
    else listed.push(...[...COLLAPSED, ...RANK.keys()].filter((key) => key === stable || key.startsWith(`${stable}#`)))
  }
  const present = listed.filter((key) => COLLAPSED.has(key) || RANK.has(key))
  return present.length > 0 && present.every((key) => COLLAPSED.has(key))
}

/**
 * 没整理过的创作者：行按默认顺序重排（稳定排序，没列的保持原序排在后面），并标出哪些默认收起。
 * 整理过 → 原样返回、一个都不收（他的排序和隐藏已经由 `partitionByModelBoxPreference` 处理完）。
 * 菜单和设置页「模型顺序」都读这一个函数，所以没整理过的人两处看到同一个顺序。
 */
export function applyModelBoxDefaults<T extends DefaultsRow>(
  rows: readonly T[],
  preference?: ModelBoxPreferenceSettings | null,
): Array<{ row: T; collapsed: boolean }> {
  if (isModelBoxTouched(preference)) return rows.map((row) => ({ row, collapsed: false }))
  return rows
    .map((row, index) => ({ row, index, rank: defaultRank(row) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => ({ row, collapsed: defaultCollapsed(row) }))
}

/** 测试用：两张表里登记的全部标识。 */
export function registeredModelBoxDefaultKeys(): string[] {
  return [...DEFAULT_ORDER, ...DEFAULT_COLLAPSED]
}
