import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import type { PlanShot, StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { resolveShotParams, setShotAspectOverride } from '../../generationCanvas/agent/storyboardShotScope'
import { storyboardBulkModelGroups, storyboardShotKind, type StoryboardBulkModelGroup, type StoryboardShotKind } from './storyboardBulkModelScope'
import { effectiveShotDurationSec } from '../../generationCanvas/agent/storyboardPlan'
import {
  controlInitialValue,
  isParameterControl,
  type DynamicModelControl,
  type DynamicParameterControl,
} from '../../generationCanvas/nodes/controls/parameterControlModel'
import {
  composerEntryIndex,
  storyboardComposerChange,
  storyboardComposerControls,
  storyboardComposerMeta,
} from './shotRow/storyboardComposerModel'

/**
 * 批量 / 多选作用域上的**公共参数集**（纯函数，无 React）。
 *
 * 为什么存在（2026-10-05 用户：「跨镜头的参数选择不完整」；审计 U9 / B7）：「全部镜头」条与多选浮条以前只有
 * 四个写死的控件，比例还是一份固定表——十个镜要改清晰度只能一镜一镜进「⋯」。可「同时改」只在**所选镜都能接住
 * 这个参数**时才成立：Veo 没有时长，Kling 没有清晰度，Seedance 的 `adaptive` 比例别家根本不认。
 * 所以作用域上的参数 = 所选镜**各自模型档案声明的参数**取交集（控件按键对齐，候选项按值取交集，数值范围取重叠）。
 * 不在交集里的整项不出现，并带着「谁没有它」交给界面说明，而不是让用户点了一个「有的镜接不住」的选项。
 *
 * 每一镜的控件走与行底栏 / 落画布**同一个函数**（`storyboardComposerControls`）：这里不自己认档案，
 * 所以界面上能选的 = 逐镜能选的 ∩，不会出现「批量说行、落地一个镜被拒」。
 */

export type BulkParamExclusion = Readonly<{
  key: string
  label: string
  /** `not-all-models`：有的镜的模型没有这个参数；`no-common-values`：都有，但候选项 / 范围没有重叠。 */
  reason: 'not-all-models' | 'no-common-values'
  /** 没有这个参数的模型名（只在 `not-all-models` 时有；去重）。 */
  models: readonly string[]
}>

export type BulkParamScope = Readonly<{
  /** 公共控件；候选项 / 范围已取交集。 */
  controls: readonly DynamicParameterControl[]
  /** 公共控件里**所选镜取值一致**的键 → 值。不一致的键缺席（= 「混合」）。 */
  uniformValues: Readonly<Record<string, string>>
  mixedKeys: readonly string[]
  excluded: readonly BulkParamExclusion[]
  /** 认不出参数契约的镜数（默认模型 / 目录里没有）：只要有一镜，公共集就是空的。 */
  unresolved: number
}>

type Scalar = string | number | boolean
type Domain =
  | { kind: 'set'; values: readonly Scalar[] }
  | { kind: 'range'; min: number; max: number; step?: number }
  | { kind: 'bool' }

function domainOf(control: DynamicParameterControl): Domain | null {
  if (control.type === 'boolean') return { kind: 'bool' }
  if (control.type === 'select' || (control.type === 'number' && control.options.length > 0)) {
    return { kind: 'set', values: control.options.map((option) => option.value) }
  }
  if (control.type === 'number' && typeof control.min === 'number' && typeof control.max === 'number') {
    return { kind: 'range', min: control.min, max: control.max, ...(control.step ? { step: control.step } : {}) }
  }
  return null
}

function intersectDomain(a: Domain, b: Domain): Domain | null {
  if (a.kind === 'bool') return b.kind === 'bool' ? a : null
  if (b.kind === 'bool') return null
  if (a.kind === 'set' && b.kind === 'set') {
    const values = a.values.filter((value) => b.values.includes(value))
    return values.length > 0 ? { kind: 'set', values } : null
  }
  if (a.kind === 'range' && b.kind === 'range') {
    const min = Math.max(a.min, b.min)
    const max = Math.min(a.max, b.max)
    if (min > max) return null
    const step = a.step ?? b.step
    return { kind: 'range', min, max, ...(step ? { step } : {}) }
  }
  // 离散候选 ∩ 连续范围：只留范围内的数值候选（Kling 的 3/5/10 ∩ Seedance 的 4–30 = 5/10）。
  const set = (a.kind === 'set' ? a : b) as Extract<Domain, { kind: 'set' }>
  const range = (a.kind === 'range' ? a : b) as Extract<Domain, { kind: 'range' }>
  const values = set.values.filter((value) => {
    // 候选值有的档案写成数字、有的写成数字串（Kling 的 "3" / "5" / "10"），按数值比。
    const numeric = typeof value === 'boolean' ? Number.NaN : Number(value)
    return Number.isFinite(numeric) && numeric >= range.min && numeric <= range.max
  })
  return values.length > 0 ? { kind: 'set', values } : null
}

/** 把交集后的候选项落回一个控件：候选项对象（标签、价签）沿用有离散候选的那一镜的。 */
function controlFromDomain(base: DynamicParameterControl, withOptions: DynamicParameterControl, domain: Domain): DynamicParameterControl {
  if (domain.kind === 'bool') return { ...base, type: 'boolean', options: [] }
  if (domain.kind === 'range') {
    return { ...base, type: 'number', options: [], min: domain.min, max: domain.max, ...(domain.step ? { step: domain.step } : {}) }
  }
  const labelled = withOptions.options.length > 0 ? withOptions.options : base.options
  const { min: _min, max: _max, step: _step, ...rest } = base
  return {
    ...rest,
    type: 'select',
    options: domain.values.map((value) => labelled.find((option) => option.value === value) ?? { value, label: String(value) }),
  }
}

function batchableControls(controls: readonly DynamicModelControl[]): DynamicParameterControl[] {
  // 媒体参考槽（image-url）与自由文本（种子、反向提示词）是逐镜的内容，不是可以「一起改」的参数。
  return controls.filter(isParameterControl).filter((control) => control.type !== 'image-url' && control.type !== 'text')
}

export function deriveBulkParamScope(input: {
  plan: StoryboardPlan
  shots: readonly PlanShot[]
  modelOptions: readonly ModelOption[]
  kind: 'image' | 'video'
  /** 这一镜生效的画幅（行覆盖 ?? 整片默认）；与行底栏同一口径。 */
  aspectOf: (shot: PlanShot) => string
}): BulkParamScope {
  const { plan, shots, modelOptions, kind, aspectOf } = input
  const perShot = shots.map((shot) => {
    const option = findModelOptionByIdentifier(modelOptions, shot.modelKey, shot.modelVendor)
    const aspect = aspectOf(shot)
    const meta = {
      ...storyboardComposerMeta({
        ...(shot.modelKey ? { modelKey: shot.modelKey } : {}),
        ...(shot.modelVendor ? { modelVendor: shot.modelVendor } : {}),
        ...(shot.modeId ? { modeId: shot.modeId } : {}),
        params: { ...resolveShotParams(plan, shot), ...(aspect ? { aspect_ratio: aspect } : {}) },
      }, composerEntryIndex(option)),
      ...(kind === 'video' ? { duration: effectiveShotDurationSec(shot) } : {}),
    }
    return {
      modelLabel: option?.label ?? shot.modelKey ?? '',
      controls: option ? batchableControls(storyboardComposerControls(option, meta, kind)) : [],
      meta,
      resolved: Boolean(option),
    }
  })
  const unresolved = perShot.filter((entry) => !entry.resolved).length
  const labelOf = new Map<string, string>()
  for (const entry of perShot) for (const control of entry.controls) if (!labelOf.has(control.key)) labelOf.set(control.key, control.label)

  const common: DynamicParameterControl[] = []
  const noCommonValues = new Set<string>()
  if (perShot.length > 0 && unresolved === 0) {
    for (const first of perShot[0].controls) {
      let domain = domainOf(first)
      let withOptions = first
      let everywhere = true
      for (const entry of perShot.slice(1)) {
        const peer = entry.controls.find((control) => control.key === first.key)
        if (!peer) { everywhere = false; break }
        const peerDomain = domainOf(peer)
        domain = domain && peerDomain ? intersectDomain(domain, peerDomain) : null
        if (peer.options.length > 0 && withOptions.options.length === 0) withOptions = peer
        if (!domain) break
      }
      if (!everywhere) continue
      if (!domain) { noCommonValues.add(first.key); continue }
      common.push(controlFromDomain(first, withOptions, domain))
    }
  }

  const commonKeys = new Set(common.map((control) => control.key))
  const excluded: BulkParamExclusion[] = [...labelOf].flatMap(([key, label]): BulkParamExclusion[] => {
    if (commonKeys.has(key)) return []
    if (noCommonValues.has(key)) return [{ key, label, reason: 'no-common-values' as const, models: [] }]
    const missing = perShot.filter((entry) => !entry.controls.some((control) => control.key === key)).map((entry) => entry.modelLabel)
    return [{ key, label, reason: 'not-all-models' as const, models: [...new Set(missing)] }]
  })

  const uniformValues: Record<string, string> = {}
  const mixedKeys: string[] = []
  for (const control of common) {
    const values = perShot.map((entry) => {
      const own = entry.controls.find((candidate) => candidate.key === control.key) ?? control
      return controlInitialValue(own, entry.meta)
    })
    if (values.every((value) => value === values[0])) uniformValues[control.key] = values[0]
    else mixedKeys.push(control.key)
  }
  return { controls: common, uniformValues, mixedKeys, excluded, unresolved }
}

/**
 * 面板里改了一个公共控件 → 写进选中镜里**镜种相符**的那些（不符的原样不动，同 `applyBulkModelToShots`）。
 * 「写到哪儿」与行底栏同一把尺（`storyboardComposerChange`）：比例进行级覆盖、时长进 `durationSec`、其余进 `params`。
 */
export function applyBulkParamToShots(input: {
  plan: StoryboardPlan
  isSelected: (shot: PlanShot) => boolean
  kind: StoryboardShotKind
  control: Parameters<typeof storyboardComposerChange>[0]
  raw: string
  /** 作用域上的公共控件（用来认哪一个是比例控件）。 */
  controls: readonly DynamicModelControl[]
}): StoryboardPlan {
  const { isSelected, kind, control, raw, controls } = input
  const change = storyboardComposerChange(control, raw, controls)
  let plan = input.plan
  plan.shots.forEach((shot, position) => {
    if (!isSelected(shot) || storyboardShotKind(shot) !== kind) return
    if (change.kind === 'aspect') {
      plan = setShotAspectOverride(plan, position, change.value)
      return
    }
    const next = change.kind === 'duration'
      ? { ...shot, durationSec: change.value }
      : { ...shot, params: { ...resolveShotParams(plan, shot), [change.key]: change.value } }
    plan = { ...plan, shots: plan.shots.map((candidate, index) => (index === position ? next : candidate)) }
  })
  return plan
}

/** 浮条 / 批量条上的一档（一个镜种一档）：模型清单 + 公共参数集 + 「所选镜都用的那个模型」。 */
export type StoryboardBulkParamGroup = StoryboardBulkModelGroup & Readonly<{
  scope: BulkParamScope
  selectedModel: ModelOption | null
}>

export function storyboardBulkParamGroups(input: {
  plan: StoryboardPlan
  shots: readonly PlanShot[]
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
  aspectOf: (shot: PlanShot) => string
}): readonly StoryboardBulkParamGroup[] {
  return storyboardBulkModelGroups(input).map((group) => {
    const shots = input.shots.filter((shot) => storyboardShotKind(shot) === group.kind)
    const first = shots[0]
    const sameModel = first !== undefined && shots.every((shot) => shot.modelKey === first.modelKey && shot.modelVendor === first.modelVendor)
    return {
      ...group,
      scope: deriveBulkParamScope({ plan: input.plan, shots, modelOptions: group.options, kind: group.kind, aspectOf: input.aspectOf }),
      selectedModel: sameModel && first.modelKey ? findModelOptionByIdentifier(group.options, first.modelKey, first.modelVendor) : null,
    }
  })
}

/**
 * 「整片默认画幅」可选哪些：**项目级**设置，不走「公共集」那条整项消失的规则——有画幅控件的镜按各自模型
 * 的候选项取交集；没有画幅控件的镜（只吃参考图的首帧路等）不参与，它们落地时本来就不带画幅
 * （批量条上那句「N 镜不带画幅」如实说出来）。以前这里是一份写死的固定表，与模型无关。
 */
export function projectAspectOptions(input: {
  plan: StoryboardPlan
  shots: readonly PlanShot[]
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
  aspectOf: (shot: PlanShot) => string
}): readonly string[] | null {
  let common: string[] | null = null
  for (const shot of input.shots) {
    const kind = storyboardShotKind(shot)
    const alone = deriveBulkParamScope({
      shots: [shot],
      plan: input.plan,
      modelOptions: kind === 'image' ? input.imageModelOptions : input.videoModelOptions,
      kind,
      aspectOf: input.aspectOf,
    })
    const control = alone.controls.find((candidate) => candidate.key === 'aspect_ratio')
    if (!control) continue
    const values = control.options.map((option) => String(option.value))
    common = common ? common.filter((value) => values.includes(value)) : values
  }
  return common
}
