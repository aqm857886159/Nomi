// 「这一次按哪种方式发」的唯一 owner（生成方式按输入现算，设计卡 docs/plan/2026-11-12-mode-from-inputs.md「11-12 改向」）。
//
// 方式不是存着的真相，是**这次实际放进来的东西**的函数：没放图就是文生，放了图就按放得下全部的那种发。节点上存着的
// modeId 只是偏好（人手在底栏方式菜单里选的，或老项目存的）：放得下全部输入时照用，放不下就不算数。
// 底栏方式格显示的、生成钮、任务种类、参数、参考行落格都读同一个结果——显示的 = 这次真发的。
//
// 纯函数、同步、不认供应商名：主进程和渲染层都问它（渲染层只经 archetypeMeta.effectiveArchetypeMode 一个包装）。
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from './types'
import { SLOT_ACCEPTS, type ReferenceAssetKind } from './anchorPolicy'
import { modeTransportFor } from '../videoCapabilities/modeTransport'

/** 一件输入：它愿意落的槽种类（按偏好排序，画布边的角色 / 上传图都折成这个）× 素材种类。 */
export type ModeInput = { slots: readonly ArchetypeReferenceSlotKind[]; asset: ReferenceAssetKind }

/** 节点上存着的方式：人手在方式菜单里选的（human），或来历不明的（老项目 / 机器写的，unknown）。两种在这里同一个规则：放得下全部输入才用。 */
export type ModePreference = { modeId: string; chosenBy: 'human' | 'unknown' }

export type ModeForInputsOptions = {
  /** 首尾帧版式里首帧格被特意空着（节点上传列表的开关）：上传图不落首帧格。 */
  firstFrameEmpty?: boolean
  /**
   * 主进程候选说明白的那一种任务（桶，比如 `image_to_video`）+ 供应商：只在这一桶的方式里按输入挑
   * （桶由 `modeTransportFor` 三级判：供应商特化 > 方式 > 档案）。画布不传——画布的方式不分桶。
   * 只收事实，不收方式对象或谓词：调用方递不进一个替自己放行的判据（2026-11-17 名字与方式各一个家）。
   * 桶里一个方式都没有时调用方先拒（`modesInTask` 为空），这里不兜底。
   */
  task?: Readonly<{ kind: string; vendor: string | null }>
}

const canonicalModeWord = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase().replace(/-/g, '_') : ''

/** 这个档案在这一桶（任务 + 供应商）里的方式。桶的判据只问 `modeTransportFor`。 */
export function modesInTask(archetype: ModelArchetype, task: Readonly<{ kind: string; vendor: string | null }>): ArchetypeMode[] {
  const wanted = canonicalModeWord(task.kind)
  return archetype.modes.filter((mode) => canonicalModeWord(modeTransportFor(mode, archetype, task.vendor)) === wanted)
}

/**
 * 说明白的方式（落盘候选的 `modeId`、改计划写的方式 id）在这个档案里是哪一个：**只查表，不重选**（铁律「说了 = 放上去的」）。
 * 大小写与 `-` / `_` 宽容（老草稿与模型都这样写过）。查不到 = undefined，由调用方按 `mode_not_in_model` 拒。
 * 和 `preference` 不是一回事：偏好放不下输入就不算数，说明白的方式不看输入。
 */
export function statedMode(archetype: Pick<ModelArchetype, 'modes'>, modeId: string): ArchetypeMode | undefined {
  const wanted = canonicalModeWord(modeId)
  return wanted ? archetype.modes.find((mode) => canonicalModeWord(mode.id) === wanted) : undefined
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
 * 单个方式本身是人选的任务（图层分离：输入和改图一样是一张图，要的结果完全不同）：按输入挑方式时绝不自动落到它；
 * 人手选了它，多放一张图也不换走——照它发，放不下的那张淡显「不会发」（taken 少于输入数）。
 */
function modeIsTaskChoice(mode: ArchetypeMode): boolean {
  return isLayerSplitMode(mode)
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

/**
 * 首尾帧「对调」点了之后这个方式还发不发得出去（⇄ 能不能点）。判据只看档案的槽必填声明：对调后首帧格装的是原来尾帧格的东西、
 * 尾帧格装的是原来首帧格的东西，每个必填格（min ≥ 1）都得有东西。没有首帧 / 尾帧格的方式没有对调可言。
 * 例：首帧必填、尾帧可不放，只放了首帧 → 对调后首帧空 → 不可点；首帧可不放的档案只放一张 → 可点。
 */
export function frameSwapKeepsSendable(mode: ArchetypeMode, filled: { first: boolean; last: boolean }): boolean {
  const first = mode.slots.find((slot) => slot.kind === 'first_frame')
  const last = mode.slots.find((slot) => slot.kind === 'last_frame')
  if (!first || !last) return false
  return (filled.last || first.min === 0) && (filled.first || last.min === 0)
}

/** 这个方式会把几段没明说是首帧的参考视频拿去当接力首帧（菜单行按「用不上」报数）。 */
export function modeRelayedCount(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions = {}): number {
  return fitInputs(mode, inputs, options).relayed
}

/** 这个方式最多收下几件（菜单行报数用）；必需格不满足时也照实数。 */
export function modeTakenCount(mode: ArchetypeMode, inputs: readonly ModeInput[], options: ModeForInputsOptions = {}): number {
  return fitInputs(mode, inputs, options).taken
}

/** 这个方式里每个槽被这次输入填进了多少件（与 `modeForInputs` 共用同一次 `fitInputs`，不另算一份）。 */
export function slotCountsForMode(
  mode: ArchetypeMode,
  inputs: readonly ModeInput[],
  options: ModeForInputsOptions = {},
): Partial<Record<ArchetypeReferenceSlotKind, number>> {
  const fit = fitInputs(mode, inputs, options)
  const counts: Partial<Record<ArchetypeReferenceSlotKind, number>> = {}
  mode.slots.forEach((slot, index) => {
    const filled = fit.filled[index] ?? 0
    if (filled > 0) counts[slot.kind] = (counts[slot.kind] ?? 0) + filled
  })
  return counts
}

/**
 * 这一次按哪种方式发（设计卡「11-12 改向」九种状态）。inputs：这次实际放进来的东西（画布边带角色 + 节点上传列表），
 * 不看上游有没有出图——连着还没生成完的上游也算输入（先跑上游备齐参考，方式按边算）。
 * ① 没放输入 → 文生（偏好不起作用）；② 有输入 → 偏好（人手选的或老项目存的）放得下全部就用它；
 * ③ 放不下 → 换成放得下全部的那种（参考类优先）；④ 没有哪种放得下全部 → 留在收得最多的那种，多出的不会发（taken < 输入数）。
 * 「减少不跳回」不在这里：偏好放不下时由画布边界忘掉它（canvasModeChoiceForget），之后按 ③ 的默认现算。
 */
export function modeForInputs(
  whole: ModelArchetype,
  inputs: readonly ModeInput[],
  preference: ModePreference | null,
  options: ModeForInputsOptions = {},
): ModeForInputsResult {
  // 说明白了任务桶（主进程候选）：只在这一桶的方式里挑；其余判据一字不变。画布不传，`archetype` 就是整个档案。
  const archetype = options.task ? { ...whole, modes: modesInTask(whole, options.task) } : whole
  if (options.task && !archetype.modes.length) throw new Error(`modeForInputs: ${whole.id} has no mode for task ${options.task?.kind}; refuse before asking`)
  const preferred = preference ? archetype.modes.find((mode) => mode.id === preference.modeId) : undefined
  const fallback = defaultModeOf(archetype)

  // 声音：方式是人选的任务（不是图怎么摆），照旧用存着的方式（声音方式栏不在这一刀）。
  if (modesAreTaskChoices(archetype)) {
    const mode = preferred ?? fallback
    const fit = fitInputs(mode, inputs, options)
    return { mode, status: fit.required ? 'ok' : 'needsInput', taken: fit.taken }
  }

  // 选定的任务方式（图层分离；只有人手选 / 入口派生会存它，来历同一个规则）：有输入就照它发，放不下的淡显「不会发」；
  // 一件都没放就要先放输入（不退成文生——人要的是拆图，不是生一张新图）。
  if (preferred && modeIsTaskChoice(preferred)) {
    const fit = fitInputs(preferred, inputs, options)
    return { mode: preferred, status: fit.required ? 'ok' : 'needsInput', taken: fit.taken }
  }

  // ① 没放任何东西 → 文字生成（偏好只在几个文字方式之间挑）。档案没有文字生成：挑一个不要必需格的，否则要先放输入。
  if (inputs.length === 0) {
    const textMode = textModeOf(archetype, preferred)
    if (textMode) return { mode: textMode, status: 'ok', taken: 0 }
    const runnable = (mode: ArchetypeMode) => !modeIsTaskChoice(mode) && mode.slots.every((slot) => slot.min === 0)
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
    if (fit.taken === 0 || !fit.required || modeIsTaskChoice(mode)) continue
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

// ── 图层分离（一张图 → 底图 + 若干透明图层）这件能力的通用名字与判定（设计卡 docs/plan/2026-11-26-layer-split.md）。
// 住在这里，是因为「它是人选的任务、按输入挑方式时绝不自动落到它」本来就归这个文件（modeIsTaskChoice）。
// 能力住在档案方式上（`ArchetypeMode.layerSplit`），不认供应商：哪家的线缆真发得出，只看它的 create body 读不读
// `LAYER_SPLIT_WIRE_KEY` 这个通用参数键（`layerSplitWireReady`）。发送口与入口问同一句话——UI 说能拆、发出去却是一次普通改图，
// 这种「花了钱只拿回一张图」的事从结构上做不出来。问的是已经从入口拿到、按档收窄过的档案 / 方式，不读表。

/** 图层分离方式的 id（各档案同名：换模型时人选的「拆图层」这件事跟着走）。 */
export const LAYER_SPLIT_MODE_ID = 'layers'
/** 方式固定参数里的开关键：线缆 body 读它 = 这家发得出图层分离。 */
export const LAYER_SPLIT_WIRE_KEY = 'layer_decomposition'
/** 拆成几层（含底图，是上限）。 */
export const LAYER_COUNT_KEY = 'layer_count'
/** 清晰度档（auto / 1K / 1.5K / 2K）。和普通改图的比例 `size` 分开存，免得比例值串进分层请求。 */
export const LAYER_SIZE_KEY = 'layer_size'
/** 识别文字（文字层带出识别到的字）。 */
export const TEXT_RECOGNITION_KEY = 'text_recognition'
/** 层数达到这个数就提醒「层数多就贵」（只提醒，不拦）。 */
export const LAYER_COUNT_COST_REMINDER_AT = 50

/** 这个方式是不是图层分离。 */
export function isLayerSplitMode(mode: Pick<ArchetypeMode, 'layerSplit'> | null | undefined): boolean {
  return Boolean(mode?.layerSplit)
}

/** 档案里的图层分离方式；没有 → undefined。 */
export function layerSplitModeOf(archetype: Pick<ModelArchetype, 'modes'> | null | undefined): ArchetypeMode | undefined {
  return archetype?.modes.find((mode) => isLayerSplitMode(mode))
}

/** 这条线缆（create op 读到的参数键）发不发得出图层分离。 */
export function layerSplitWireReady(wireParamKeys: readonly string[] | null | undefined): boolean {
  return Boolean(wireParamKeys?.includes(LAYER_SPLIT_WIRE_KEY))
}

/**
 * 这次要拆几层（含底图）。层数格可调的方式读存值、落在声明的范围里；层数写死的方式（只有上限）给上限。
 * 读不出数 → 方式声明的默认 / 上限。
 */
export function requestedLayerCount(mode: Pick<ArchetypeMode, 'layerSplit' | 'params'>, stored: Readonly<Record<string, unknown>>): number | null {
  const split = mode.layerSplit
  if (!split) return null
  const control = mode.params.find((candidate) => candidate.key === LAYER_COUNT_KEY)
  if (!control) return split.maxLayers
  const raw = Number(stored[LAYER_COUNT_KEY] ?? control.defaultValue)
  const fallback = Number(control.defaultValue ?? split.maxLayers)
  const value = Number.isFinite(raw) ? Math.round(raw) : fallback
  const min = typeof control.min === 'number' ? control.min : 2
  const max = typeof control.max === 'number' ? control.max : split.maxLayers
  return Math.min(max, Math.max(min, value))
}
