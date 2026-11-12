// 「这一次按哪种方式发」的唯一 owner（生成方式按输入现算，设计卡 docs/plan/2026-11-12-mode-from-inputs.md「11-12 改向」）。
//
// 方式不是存着的真相，是**这次实际放进来的东西**的函数：没放图就是文生，放了图就按放得下全部的那种发。节点上存着的
// modeId 只是偏好（人手在底栏方式菜单里选的，或老项目存的）：放得下全部输入时照用，放不下就不算数。
// 底栏方式格显示的、生成钮、任务种类、参数、参考行落格都读同一个结果——显示的 = 这次真发的。
//
// 纯函数、同步、不认供应商名：主进程和渲染层都问它（渲染层只经 archetypeMeta.effectiveArchetypeMode 一个包装）。
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from './types'
import { SLOT_ACCEPTS, type ReferenceAssetKind } from './anchorPolicy'

/** 一件输入：它愿意落的槽种类（按偏好排序，画布边的角色 / 上传图都折成这个）× 素材种类。 */
export type ModeInput = { slots: readonly ArchetypeReferenceSlotKind[]; asset: ReferenceAssetKind }

/** 节点上存着的方式：人手在方式菜单里选的（human），或来历不明的（老项目 / 机器写的，unknown）。两种在这里同一个规则：放得下全部输入才用。 */
export type ModePreference = { modeId: string; chosenBy: 'human' | 'unknown' }

export type ModeForInputsOptions = {
  /** 首尾帧版式里首帧格被特意空着（节点上传列表的开关）：上传图不落首帧格。 */
  firstFrameEmpty?: boolean
}

export type ModeForInputsResult = {
  /** 这次按哪种方式发（方式格显示它，参考行按它摆）。 */
  mode: ArchetypeMode
  /**
   * ok：可以发；needsInput：档案没有文字生成、也没放能用的输入（设计卡 ★4 情况 a）；
   * inputsNotAccepted：放了输入，但这个档案没有任何方式收得下（mode 是文字方式，输入不会被发出去）。
   */
  status: 'ok' | 'needsInput' | 'inputsNotAccepted'
  /** mode 收下了几件输入；少于输入数 = 模型自己放不下，多出的淡显「不会发」。 */
  taken: number
}

const ARRAY_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(['image_ref', 'video_ref', 'audio_ref'])
const REFERENCE_WORKFLOW_INTENTS = new Set(['reference', 'character', 'multimodal'])

/** relayed：没明说是首帧、却被拿去当接力首帧的视频件数（视频进首帧格 = 取它的尾帧当本镜首帧，是一种转换，不是「放下了」）。 */
type Fit = { taken: number; required: boolean; rankSum: number; relayed: number; filledKinds: Set<ArchetypeReferenceSlotKind>; filled: number[] }

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
  let relayed = 0
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
      if (kind === 'first_frame' && input.asset === 'video' && input.slots[0] !== 'first_frame') relayed += 1
      budget -= 1
      break
    }
  }
  const required = mode.slots.every((slot, index) => filled[index]! >= slot.min)
  return { taken, required, rankSum, relayed, filledKinds, filled }
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
 * 这一个方式能不能收下这次**全部**输入（菜单里能不能点它）：每件都落得进格子、必需格都满足。
 * 没有输入时只有文字类 / 没有必需格的方式收得下。
 */
export function modeTakesAllInputs(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions = {}): boolean {
  if (!inputs.length) return mode.slots.every((slot) => slot.min === 0)
  const fit = fitInputs(mode, inputs, options)
  return fit.required && fit.taken === inputs.length
}

/** 这个方式会把几段没明说是首帧的参考视频拿去当接力首帧（菜单行按「用不上」报数）。 */
export function modeRelayedCount(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions = {}): number {
  return fitInputs(mode, inputs, options).relayed
}

/** 这个方式最多收下几件（菜单行报数用）；必需格不满足时也照实数。 */
export function modeTakenCount(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions = {}): number {
  return fitInputs(mode, inputs, options).taken
}

/**
 * 这一次按哪种方式发（设计卡「11-12 改向」九种状态）。inputs：这次实际放进来的东西（画布边带角色 + 节点上传列表），
 * 不看上游有没有出图——连着还没生成完的上游也算输入（先跑上游备齐参考，方式按边算）。
 * ① 没放输入 → 文生（偏好不起作用）；② 有输入 → 偏好（人手选的或老项目存的）放得下全部就用它；
 * ③ 放不下 → 换成放得下全部的那种（参考类优先）；④ 没有哪种放得下全部 → 留在收得最多的那种，多出的不会发（taken < 输入数）。
 * 「减少不跳回」不在这里：偏好放不下时由画布边界忘掉它（canvasModeChoiceForget），之后按 ③ 的默认现算。
 */
export function modeForInputs(
  archetype: ModelArchetype,
  inputs: readonly ModeInput[],
  preference: ModePreference | null,
  options: ModeForInputsOptions = {},
): ModeForInputsResult {
  const preferred = preference ? archetype.modes.find((mode) => mode.id === preference.modeId) : undefined
  const fallback = defaultModeOf(archetype)

  // 声音：方式是人选的任务（不是图怎么摆），照旧用存着的方式（声音方式栏不在这一刀）。
  if (modesAreTaskChoices(archetype)) {
    const mode = preferred ?? fallback
    const fit = fitInputs(mode, inputs, options)
    return { mode, status: fit.required ? 'ok' : 'needsInput', taken: fit.taken }
  }

  // ① 没放任何东西 → 文字生成（偏好只在几个文字方式之间挑）。档案没有文字生成：挑一个不要必需格的，否则要先放输入。
  if (inputs.length === 0) {
    const textMode = textModeOf(archetype, preferred)
    if (textMode) return { mode: textMode, status: 'ok', taken: 0 }
    const runnable = (mode: ArchetypeMode) => mode.slots.every((slot) => slot.min === 0)
    const empty = preferred && runnable(preferred) ? preferred : archetype.modes.find(runnable)
    if (empty) return { mode: empty, status: 'ok', taken: 0 }
    return { mode: preferred ?? fallback, status: 'needsInput', taken: 0 }
  }

  const fits = new Map(archetype.modes.map((mode) => [mode.id, fitInputs(mode, inputs, options)] as const))
  const takesAll = (fit: Fit) => fit.required && fit.taken === inputs.length

  // ② 偏好放得下全部 → 用它。例外：偏好只能把参考视频拿去当接力首帧、而另有方式原样收下它时，不算放得下——
  // 首帧偏好的节点连进 / @ 一段参考视频，是要它当参考视频，不是悄悄只取尾帧。要接力就连明说首帧的边（照旧接力）。
  // 人手选的和来历不明的同一个规则；菜单那一行灰掉、报「用不上」（modeRelayedCount）。
  const preferredFit = preferred ? fits.get(preferred.id)! : undefined
  const relayOnly = Boolean(preferredFit?.relayed) && [...fits.values()].some((fit) => takesAll(fit) && fit.relayed === 0)
  if (preferred && preferredFit && takesAll(preferredFit) && !relayOnly) return { mode: preferred, status: 'ok', taken: inputs.length }

  // ③ / ④ 按输入挑：先要放得下全部；没有就收下最多者胜。同样多时按格子对不对口（输入自己的角色：首帧边就是首帧），
  // 再按参考类 > 图参考 > 首帧类，再偏好本身，最后按档案声明顺序。
  let best: { mode: ArchetypeMode; fit: Fit } | null = null
  for (const mode of archetype.modes) {
    const fit = fits.get(mode.id)!
    if (fit.taken === 0 || !fit.required) continue
    if (!best) { best = { mode, fit }; continue }
    const order = [
      Number(takesAll(fit)) - Number(takesAll(best.fit)),
      fit.taken - best.fit.taken,
      best.fit.rankSum - fit.rankSum,
      workflowClass(best.mode) - workflowClass(mode),
      Number(mode === preferred) - Number(best.mode === preferred),
    ].find((value) => value !== 0) ?? 0
    if (order > 0) best = { mode, fit }
  }
  if (best) return { mode: best.mode, status: 'ok', taken: best.fit.taken }

  // 一个方式都收不下这些输入：有文字生成就按文字发（输入发不出去，如实标出）；否则要先放能用的输入。
  const textMode = textModeOf(archetype, preferred)
  if (textMode) return { mode: textMode, status: 'inputsNotAccepted', taken: 0 }
  return { mode: preferred ?? fallback, status: 'needsInput', taken: 0 }
}
