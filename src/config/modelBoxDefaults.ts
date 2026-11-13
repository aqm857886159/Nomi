// 模型框的「默认顺序 + 默认收起」——只给**从没整理过模型框**的创作者用。
//
// 依据：LibTV 模型菜单顺序（创作者用量排序）+ 我们自己的判断（Veo 是海外创作者的主力，放在 13–14）。
// 这是一份**候选默认**，不动任何人存下来的东西：
//   · 创作者排过序或隐藏过（`modelOrder` / `hiddenModelIds` 任一非空）→ 这里整个不生效，他存的原样用；
//   · 从没动过 → 按下面的顺序排，收起名单里的行进「更多」（点一下就出来，不是删除、不是隐藏）；
//   · 节点上正在用的模型即使在收起名单里，也照常显示和生成（「更多」只管新开菜单时它排在哪）；
//   · 名单里写了、仓库里没有的名字，什么也不发生（只按行键匹配，没有就没有）。
//
// 行键：`canonicalId`（整个模型一行）或 `canonicalId#变体id`（模型框里变体是自己的一行）。
// 没列进两张表的行（新接入的、别家供应商的）排在列出的后面、默认显示——新东西不会因为没排过就消失。
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'

/** 默认显示，按这个顺序（视频在前、图片在后；菜单一次只放一种，互不干扰）。 */
const DEFAULT_ORDER: readonly string[] = [
  // 视频
  'seedance 2.5',
  'seedance 2.0#standard',
  'wan 3.0',
  '可灵 4.0',
  'minimax h3',
  'seedance 2.0#fast',
  'wan 3.0 prime',
  'seedance 2.0#mini',
  'happyhorse 1.1',
  '可灵 3.0 turbo',
  '可灵 3.0',
  'wan 2.7',
  'veo 3.1#fast',
  'veo 3.1#quality',
  'hailuo 2.3#standard',
  'vidu q3 pro',
  'vidu q4 预览版',
  'hailuo 2.3#fast',
  // 图片
  'gpt image 2.6 flare',
  'gpt image 2.6 sunburst',
  'nano banana 2.1',
  'gemini image 3 pro',
  'seedream 5.0 pro',
  'flux 3',
  'qwen-image 3.0#standard',
  'qwen-image 3.0#pro',
  'gpt image 2.5 flare',
  'seedream 4.5',
  'z-image turbo',
]

/** 默认收起（进「更多」）。 */
const DEFAULT_COLLAPSED: readonly string[] = [
  // 视频
  'vidu q3#standard',
  'vidu q3#mix',
  'vidu q3 turbo',
  'veo 3.1#lite',
  'veo 3.1 fast 官方',
  'veo 3.1 quality 官方',
  'grok imagine 1.5',
  'grok imagine video 1.5 官方',
  'pixverse v6',
  'pixverse v6 max',
  'muse video',
  'flux 3 video',
  'omni-flash-ext',
  'gemini omni 1.2 flash',
  'gemini omni 1.2 flash ext',
  'minimax h3 再生成',
  // 图片
  'gpt image 2.5 sunburst',
  'gpt image 2',
  'nano banana',
  'nano banana 2',
  'nano banana 2.1 ext',
  'nano banana lite',
  'nano banana lite ext',
  'flux 3 klein',
  'grok imagine image 2',
  'grok imagine image 2.0 官方',
  '混元图像 3.5',
  'muse image',
  '万相 2.7 图像',
  '万相 2.7 图像 pro',
  'qwen-image 2.0#standard',
  'qwen-image 2.0#pro',
]

const RANK = new Map(DEFAULT_ORDER.map((key, index) => [key, index]))
const COLLAPSED = new Set(DEFAULT_COLLAPSED)

/** 创作者整理过吗：排过序或隐藏过任一即「整理过」——默认整个不生效，存的原样。 */
export function isModelBoxTouched(preference?: ModelBoxPreferenceSettings | null): boolean {
  return Boolean(preference && (preference.modelOrder.length > 0 || preference.hiddenModelIds.length > 0))
}

/** 一行默认排第几（不在表里 = 排在所有列出的后面）。无变体展开的调用方（分镜）用整模型键，取它名下最靠前的变体位。 */
function defaultRank(key: string): number {
  const exact = RANK.get(key)
  if (exact !== undefined) return exact
  if (key.includes('#')) return Number.MAX_SAFE_INTEGER
  let best = Number.MAX_SAFE_INTEGER
  for (const [listed, rank] of RANK) if (listed.startsWith(`${key}#`) && rank < best) best = rank
  return best
}

/** 一行默认是否收起。整模型键：名下所有变体都在收起名单里才收（有一个变体默认显示，这个模型就显示）。 */
function defaultCollapsed(key: string): boolean {
  if (COLLAPSED.has(key)) return true
  if (key.includes('#')) return false
  const listedVariants = [...COLLAPSED, ...DEFAULT_ORDER].filter((listed) => listed.startsWith(`${key}#`))
  return listedVariants.length > 0 && listedVariants.every((listed) => COLLAPSED.has(listed))
}

/**
 * 没整理过的创作者：行按默认顺序重排（稳定排序，没列的保持原序排在后面），并标出哪些默认收起。
 * 整理过 → 原样返回、一个都不收（他的排序和隐藏已经由 `partitionByModelBoxPreference` 处理完）。
 */
export function applyModelBoxDefaults<T extends { key: string }>(
  rows: readonly T[],
  preference?: ModelBoxPreferenceSettings | null,
): Array<{ row: T; collapsed: boolean }> {
  if (isModelBoxTouched(preference)) return rows.map((row) => ({ row, collapsed: false }))
  return rows
    .map((row, index) => ({ row, index, rank: defaultRank(row.key) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => ({ row, collapsed: defaultCollapsed(row.key) }))
}

/** 测试用：两张表里登记的全部行键。 */
export function registeredModelBoxDefaultKeys(): string[] {
  return [...DEFAULT_ORDER, ...DEFAULT_COLLAPSED]
}
