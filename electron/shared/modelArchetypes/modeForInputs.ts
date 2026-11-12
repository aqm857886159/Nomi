// 「这一次按哪种方式发」的唯一 owner（生成方式按输入现算，设计卡 docs/plan/2026-11-12-mode-from-inputs.md）。
//
// 方式不是存着的真相，是**这次实际放进来的东西**的函数：没放图就是文字生成，放了图就按图发；节点上存着的
// modeId 只是「图怎么摆」的偏好。人手点过分段的偏好（chosenBy: 'human'）是意图：照用；它有必填格没填时
// 不许悄悄换成文字生成发出去（incompleteHumanLayout，不发）。来历不明的（老项目、机器写的）只有在它能把这次
// 所有输入都收下时才用，否则按输入现算、悄悄走。
//
// 纯函数、同步、不认供应商名：主进程和渲染层都问它（渲染层只经 archetypeMeta.effectiveArchetypeMode 一个包装）。
// 一次返回两样：mode = 这次发什么（发送、生成钮、任务种类、参数都读它）；layout = 图怎么摆（分段高亮、参考行格子、
// 拖放落格、新连线语义读它）。两者只在两种情形不同：偏好来历不明且 mode 一张输入都没收下；人手版式只有可选格且
// 什么都没放（照偏好摆空格、按文字发）。
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from './types'
import { SLOT_ACCEPTS, type ReferenceAssetKind } from './anchorPolicy'

/** 一件输入：它愿意落的槽种类（按偏好排序，画布边的角色 / 上传图都折成这个）× 素材种类。 */
export type ModeInput = { slots: readonly ArchetypeReferenceSlotKind[]; asset: ReferenceAssetKind }

/** 节点上存着的方式：人手点分段写的（human），或来历不明的（老项目 / 机器写的，unknown）。 */
export type ModePreference = { modeId: string; chosenBy: 'human' | 'unknown' }

export type ModeForInputsOptions = {
  /** 首尾帧版式里首帧格被特意空着（节点上传列表的开关）：上传图不落首帧格。 */
  firstFrameEmpty?: boolean
}

export type ModeForInputsResult = {
  /** 这次按哪种方式发。 */
  mode: ArchetypeMode
  /** 图怎么摆（参考行、分段高亮）。只在 mode 一张输入都没收下时可能 ≠ mode。 */
  layout: ArchetypeMode
  /**
   * ok：可以发；needsInput：档案没有文字生成、也没放能用的输入（设计卡 ★4 情况 a）；
   * inputsNotAccepted：放了输入，但这个档案没有任何方式收得下（mode 是文字方式，输入不会被发出去）；
   * incompleteHumanLayout：人手选的版式有必填格没填（missing 是缺的格子）——不发；mode = layout = 人手版式
   * （没有可发的方式，界面照今天：生成钮灰、沿用现有原因）。
   */
  status: 'ok' | 'needsInput' | 'inputsNotAccepted' | 'incompleteHumanLayout'
  /** incompleteHumanLayout 时缺的必填格。 */
  missing?: ArchetypeReferenceSlotKind[]
  /** 首尾帧版式下首帧空着、按文字发：firstFrameEmpty = 两格都空；onlyLastFrame = 只放了尾帧。 */
  notice?: 'firstFrameEmpty' | 'onlyLastFrame'
  /** mode 收下了几件输入（其余淡显「未用到」）。 */
  taken: number
}

const ARRAY_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(['image_ref', 'video_ref', 'audio_ref'])
const REFERENCE_WORKFLOW_INTENTS = new Set(['reference', 'character', 'multimodal'])

type Fit = { taken: number; required: boolean; rankSum: number; filledKinds: Set<ArchetypeReferenceSlotKind>; filled: number[] }

function slotCapacity(slot: ArchetypeMode['slots'][number]): number {
  return slot.max ?? (ARRAY_SLOT_KINDS.has(slot.kind) ? Number.POSITIVE_INFINITY : 1)
}

function hasSlot(mode: ArchetypeMode, kind: ArchetypeReferenceSlotKind): boolean {
  return mode.slots.some((slot) => slot.kind === kind)
}

/**
 * 把输入按偏好依次落进这个方式的格子：先落角色明确的（候选槽少的），再落通用的；守每格上限和方式的总数上限。
 * 首帧特意空着时，首尾帧方式的首帧格只收明说是首帧的输入。
 */
function fitInputs(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions): Fit {
  const filled = mode.slots.map(() => 0)
  const keepFirstEmpty = Boolean(options.firstFrameEmpty) && hasSlot(mode, 'last_frame')
  let budget = mode.maxTotalReferences ?? Number.POSITIVE_INFINITY
  let taken = 0
  let rankSum = 0
  const filledKinds = new Set<ArchetypeReferenceSlotKind>()
  const ordered = inputs.map((input, index) => ({ input, index })).sort((a, b) => a.input.slots.length - b.input.slots.length || a.index - b.index)
  for (const { input } of ordered) {
    if (budget <= 0) break
    for (const [rank, kind] of input.slots.entries()) {
      if (!SLOT_ACCEPTS[kind].includes(input.asset)) continue
      if (kind === 'first_frame' && keepFirstEmpty && input.slots[0] !== 'first_frame') continue
      const slotIndex = mode.slots.findIndex((slot, index) => slot.kind === kind && filled[index]! < slotCapacity(slot))
      if (slotIndex < 0) continue
      filled[slotIndex]! += 1
      filledKinds.add(kind)
      taken += 1
      rankSum += rank
      budget -= 1
      break
    }
  }
  const required = mode.slots.every((slot, index) => filled[index]! >= slot.min)
  return { taken, required, rankSum, filledKinds, filled }
}

/** 参考类优先，其次图参考，最后首帧类（与原先连线挑方式的排法同一个）。 */
function workflowClass(mode: ArchetypeMode): number {
  if (REFERENCE_WORKFLOW_INTENTS.has(String(mode.intent))) return 0
  if (hasSlot(mode, 'image_ref') && !['single', 'firstlast'].includes(String(mode.intent))) return 1
  if (hasSlot(mode, 'first_frame')) return 2
  return 3
}

function textModeOf(archetype: ModelArchetype, preferred: ArchetypeMode | undefined): ArchetypeMode | undefined {
  const texts = archetype.modes.filter((mode) => mode.intent === 'text')
  if (!texts.length) return undefined
  if (preferred && preferred.intent === 'text') return preferred
  return texts.find((mode) => mode.id === archetype.defaultModeId) ?? texts[0]
}

function defaultModeOf(archetype: ModelArchetype): ArchetypeMode {
  return archetype.modes.find((mode) => mode.id === archetype.defaultModeId) ?? archetype.modes[0]!
}

/** 偏好里的方式「本来就是人选的任务」而不是图的摆法：声音档案（续写 / 翻唱 / 转写 / 音效 / 语音，输入一样、任务不同）。 */
function modesAreTaskChoices(archetype: ModelArchetype): boolean {
  return archetype.kind === 'audio'
}

/**
 * 这一次按哪种方式发。inputs：这次实际放进来的东西（画布边带角色 + 节点上传列表），不看上游有没有出图——
 * 连着还没生成完的上游也算输入（先跑上游备齐参考，方式按边算）。
 */
export function modeForInputs(
  archetype: ModelArchetype,
  inputs: readonly ModeInput[],
  preference: ModePreference | null,
  options: ModeForInputsOptions = {},
): ModeForInputsResult {
  const preferred = preference ? archetype.modes.find((mode) => mode.id === preference.modeId) : undefined
  const fallback = defaultModeOf(archetype)

  // 声音：方式是人选的任务（不是图怎么摆），这一刀照旧用存着的方式（声音方式栏在后面一刀定）。
  if (modesAreTaskChoices(archetype)) {
    const mode = preferred ?? fallback
    const fit = fitInputs(mode, inputs, options)
    return { mode, layout: mode, status: fit.required ? 'ok' : 'needsInput', taken: fit.taken }
  }

  const layoutWhenEmpty = preferred ?? fallback
  const textMode = textModeOf(archetype, preferred)
  const human = preference?.chosenBy === 'human' && preferred ? preferred : undefined
  const incomplete = (mode: ArchetypeMode, fit: Fit): ModeForInputsResult => ({
    mode, layout: mode, status: 'incompleteHumanLayout', taken: fit.taken,
    missing: mode.slots.filter((slot, index) => fit.filled[index]! < slot.min).map((slot) => slot.kind),
  })

  // ① 没放任何东西 → 文字生成；偏好只决定空格子怎么摆。
  if (inputs.length === 0) {
    // 人手版式有必填格（首尾帧、首帧、改图）：是意图，不悄悄按文字发。
    if (human && human.slots.some((slot) => slot.min > 0)) return incomplete(human, fitInputs(human, inputs, options))
    const notice = preferred && hasSlot(preferred, 'first_frame') && hasSlot(preferred, 'last_frame') && textMode ? 'firstFrameEmpty' as const : undefined
    if (textMode) return { mode: textMode, layout: preferred && preferred.slots.length ? preferred : textMode, status: 'ok', taken: 0, ...(notice ? { notice } : {}) }
    const runnable = (mode: ArchetypeMode) => mode.slots.every((slot) => slot.min === 0)
    const empty = preferred && runnable(preferred) ? preferred : archetype.modes.find(runnable)
    if (empty) return { mode: empty, layout: empty, status: 'ok', taken: 0 }
    return { mode: layoutWhenEmpty, layout: layoutWhenEmpty, status: 'needsInput', taken: 0 }
  }

  const fits = new Map(archetype.modes.map((mode) => [mode.id, fitInputs(mode, inputs, options)] as const))
  const preferredFit = preferred ? fits.get(preferred.id)! : undefined

  // ③ 首尾帧版式、首帧特意空着、只放了尾帧：档案声明首帧可空就照发首尾帧；人手选的不发（缺首帧）；
  // 来历不明的按文字发（尾帧用不上，标「未用到」）。
  if (preferred && preferredFit && options.firstFrameEmpty && hasSlot(preferred, 'first_frame') && hasSlot(preferred, 'last_frame')
    && preferredFit.filledKinds.has('last_frame') && !preferredFit.filledKinds.has('first_frame')) {
    if (preferredFit.required) return { mode: preferred, layout: preferred, status: 'ok', taken: preferredFit.taken }
    if (human) return incomplete(human, preferredFit)
    if (textMode) return { mode: textMode, layout: preferred, status: 'ok', notice: 'onlyLastFrame', taken: 0 }
  }

  // ② 有输入：偏好收得下就用（人手的允许多出来的淡显「未用到」；来历不明的要一件都不剩）。
  if (preferred && preferredFit && preferredFit.taken > 0 && preferredFit.required
    && (preference!.chosenBy === 'human' || preferredFit.taken === inputs.length)) {
    return { mode: preferred, layout: preferred, status: 'ok', taken: preferredFit.taken }
  }

  // 否则按输入挑：收下最多者胜；同样多时，和偏好落在同一种格子里的优先（手选首尾帧只放一张 → 按首帧发），
  // 再按参考类 > 图参考 > 首帧类，再按格子对不对口，最后按档案声明顺序。
  const agrees = (fit: Fit) => Boolean(preferredFit && preferredFit.filledKinds.size > 0 && [...preferredFit.filledKinds].every((kind) => fit.filledKinds.has(kind)))
  let best: { mode: ArchetypeMode; fit: Fit } | null = null
  for (const mode of archetype.modes) {
    const fit = fits.get(mode.id)!
    if (fit.taken === 0 || !fit.required) continue
    if (!best) { best = { mode, fit }; continue }
    const order = [
      fit.taken - best.fit.taken,
      Number(agrees(fit)) - Number(agrees(best.fit)),
      workflowClass(best.mode) - workflowClass(mode),
      best.fit.rankSum - fit.rankSum,
    ].find((value) => value !== 0) ?? 0
    if (order > 0) best = { mode, fit }
  }
  // 人手版式有必填格没填：只有「人手放的东西按同样的格子原样收下」的方式可以接（首尾帧只放了首帧 → 按首帧发）；
  // 否则不发，不悄悄换成别的（尤其是文字生成）。
  if (human && preferredFit && !preferredFit.required) {
    let keeper: { mode: ArchetypeMode; fit: Fit } | null = null
    for (const mode of archetype.modes) {
      const fit = fits.get(mode.id)!
      if (!fit.required || preferredFit.taken === 0 || fit.taken < preferredFit.taken || !agrees(fit)) continue
      if (!keeper || fit.taken > keeper.fit.taken || (fit.taken === keeper.fit.taken && workflowClass(mode) < workflowClass(keeper.mode))) keeper = { mode, fit }
    }
    if (!keeper) return incomplete(human, preferredFit)
    return { mode: keeper.mode, layout: keeper.mode, status: 'ok', taken: keeper.fit.taken }
  }
  if (best) return { mode: best.mode, layout: best.mode, status: 'ok', taken: best.fit.taken }

  // 一个方式都收不下这些输入：有文字生成就按文字发（输入发不出去，如实标出）；否则要先放能用的输入。
  if (textMode) return { mode: textMode, layout: textMode, status: 'inputsNotAccepted', taken: 0 }
  return { mode: layoutWhenEmpty, layout: layoutWhenEmpty, status: 'needsInput', taken: preferredFit?.taken ?? 0 }
}
