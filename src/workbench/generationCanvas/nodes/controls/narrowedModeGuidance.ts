// 「这个模式被这条渠道藏掉了 —— 谁还能做」——**指路判据**。
//
// 为什么要有它：`archetypeModeIsVisible` 只回答「藏不藏」，回答完就把模式从界面上摘掉了，用户看到的是
// 「这个模型没这功能」。全目录实测（95 个多模式模型）里收窄命中 11 个模型、藏掉 11 个模式条目，**11 条
// 在别家供应商都能用，0 条是全目录谁都做不了**。所以缺的不是一段解释，是**一次跳转**：告诉用户哪家能做，
// 并把他一键送过去。
//
// 判据**一律复用** `archetypeModeIsVisible`——「别家能不能做」与「这家藏不藏」必须是同一把尺子量出来的。
// 若在这里另写一份「别家应该可以吧」的乐观判断，就会出现「提示说换到 KIE 能用、换过去发现照样没有」，
// 那比静默隐藏更糟。本模块只做「换一条渠道再问一遍同一个判据」，不新增任何可达性规则。
import React from 'react'
import { modeTransportFor, type ArchetypeMode, type ModelArchetype } from '../../../../config/modelArchetypes'
import type { ModelOption } from '../../../../config/models'
import { archetypeModeIsVisible, type ModeChannelBody } from './channelModeReach'
import { readModeChannelBody } from './useChannelCreateBody'
import { resolveArchetypeForOption } from '../nodeModelArchetype'

/** 一个候选渠道：把 (vendor, model) 连同它的显示名一起带上，提示里要直接说人话。 */
export type ModeGuidanceCandidate = {
  /** 目录里的 model value（handleModelChange 的第一个参数）。 */
  value: string
  /** 供应商 key（handleModelChange 的第二个参数）。 */
  vendor: string
  /** 供应商显示名（catalog vendor.name；缺省时回落 vendor key）。 */
  vendorName: string
}

/**
 * 指路结论。`kind` 三态与样张的 B / E 一一对应：
 * - `switch`：别家能做且**已接入** → 出一行提示 + 「换到 X」按钮（样张 B / D）。
 * - `none`：已接入的模型里没有一个能做 → 只说实话，**不给换家按钮**（样张 E）。
 * - `null`（函数返回 null）：没有被藏的模式，或判据不可信 → 什么都不说。
 */
export type NarrowedModeGuidance =
  | { kind: 'switch'; hiddenModeTerms: string[]; target: ModeGuidanceCandidate }
  | { kind: 'none'; hiddenModeTerms: string[] }

/** 节点级关闭标记：写进 node.meta，随项目快照一起持久化。 */
export const NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY = 'narrowedModeGuidanceDismissed'

export function isNarrowedModeGuidanceDismissed(meta?: Record<string, unknown>): boolean {
  return meta?.[NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY] === true
}

/**
 * 「档案声明了、但这条渠道发不出」的模式。
 *
 * 只收 `archetypeModeIsVisible === false` 的那些——`undefined`（查不到 body）走 fail-open，模式**根本没被藏**，
 * 自然也不该提示。把 `undefined` 和 `null` 合并是这一族最容易犯的错：那会让「老 preload / 自建中转查不到」
 * 的用户看到一行「你这条线发不出 XXX」的假指控，而他的模式其实好好地在那儿。
 */
export function hiddenModesForChannel(
  archetype: ModelArchetype,
  bodyForMode: (mode: ArchetypeMode) => ModeChannelBody,
): ArchetypeMode[] {
  return archetype.modes.filter((mode) => !archetypeModeIsVisible(mode, bodyForMode(mode)))
}

/**
 * **指路的唯一入口**：这些被藏的模式，在**已接入的别家**上有没有一家能全做出来。
 *
 * 判据 = 对每个候选渠道，拿它自己的 body 重跑一遍 `archetypeModeIsVisible`。要求**全部**被藏的模式在该
 * 候选上都可见——只能做一半的家不配当「换到 X」的落点：用户换过去发现还是缺，等于我们又骗了他一次。
 *
 * `candidates` 由调用方从 `modelOptions` 里筛出「同一档案身份、不同 (vendor, model)」的行。**实测确认过
 * `modelOptions` 只含已接入（enabled 且有 key / 免鉴权）的供应商**（src/config/modelCatalogCache.ts 的
 * getEnabledVendorKeys → getCatalogModelOptions 硬过滤），所以这里的候选天然都是「切过去立刻能用」的，
 * 不需要也**拿不到**凭证状态。样张 C（「别家有但那家还没接入」）因此在渲染层没有数据源可依据，**不做**，
 * 也绝不用猜的去谎称——见本次交付报告与根因合同。
 *
 * 返回 `null` = 没有被藏的模式 = 不出提示（绝大多数模型走这条，零噪音）。
 */
export function resolveNarrowedModeGuidance(params: {
  archetype: ModelArchetype
  bodyForMode: (mode: ArchetypeMode) => ModeChannelBody
  candidates: readonly ModeGuidanceCandidate[]
  /** 候选渠道上该模式的 body（调用方注入，便于纯函数测试与真机 IPC 两用）。 */
  bodyForCandidate: (candidate: ModeGuidanceCandidate, mode: ArchetypeMode) => ModeChannelBody
}): NarrowedModeGuidance | null {
  const { archetype, bodyForMode, candidates, bodyForCandidate } = params
  const hidden = hiddenModesForChannel(archetype, bodyForMode)
  if (hidden.length === 0) return null
  const hiddenModeTerms = hidden.map((mode) => mode.vendorTerm)
  // 「全做得出」才算数：能做一半的家不给按钮，否则换过去还是缺，等于再骗一次。
  const target = candidates.find((candidate) =>
    hidden.every((mode) => archetypeModeIsVisible(mode, bodyForCandidate(candidate, mode))),
  )
  return target ? { kind: 'switch', hiddenModeTerms, target } : { kind: 'none', hiddenModeTerms }
}

/**
 * 节点侧的消费入口：把「当前档案 + 当前渠道的各模式 body + 已接入目录」算成指路结论。
 *
 * 放在这里而不是留在 NodeParameterControls：判据、候选查询与它们的注释是同一件事，散在组件里
 * 既撑大巨壳文件（R9/R12），也让下一个人以为「候选怎么来的」是组件的私事。组件只消费结论。
 *
 * 候选渠道的 body 走与本节点**同一个入口** `readModeChannelBody` + 同一个 taskKind 解析
 * （`modeTransportFor` 带候选 vendor 特化）——问错桶会把「别家其实能做」误判成不能。
 */
export function useNarrowedModeGuidance(params: {
  archetype: ModelArchetype | null
  selectedModelOption: ModelOption | null
  modelOptions: readonly ModelOption[]
  modeBodies: Record<string, ModeChannelBody>
  nodeMeta?: Record<string, unknown>
}): NarrowedModeGuidance | null {
  const { archetype, selectedModelOption, modelOptions, modeBodies, nodeMeta } = params
  return React.useMemo(() => {
    if (!archetype || !selectedModelOption || isNarrowedModeGuidanceDismissed(nodeMeta)) return null
    const candidates = candidatesForArchetype({
      options: modelOptions,
      archetypeId: archetype.id,
      archetypeIdOf: (option) => resolveArchetypeForOption(option)?.id,
      currentVendor: selectedModelOption.vendor,
      currentValue: selectedModelOption.value,
    })
    return resolveNarrowedModeGuidance({
      archetype,
      bodyForMode: (mode) => modeBodies[mode.id],
      candidates,
      bodyForCandidate: (candidate, mode) =>
        readModeChannelBody(
          candidate.vendor,
          candidate.value,
          modeTransportFor(mode, archetype, candidate.vendor) ?? '',
          mode.id,
        ),
    })
  }, [archetype, selectedModelOption, modelOptions, modeBodies, nodeMeta])
}

/**
 * 参考区**是否整块空返回**。
 *
 * 单独抽出来是因为样张 D 那条最坏情形恰恰藏在这个判据里：只剩 ≤1 个模式时模式栏本就不显示
 * （`showModeBar === false`），若参考区又没有任何槽，整块直接 return null——**指路提示会跟着一起消失，
 * 最需要说话的场合反而哑了**。所以 `hasModeGuidance` 必须是这个判据的一项，且这条得有测试钉住。
 */
export function referencesSectionIsEmpty(params: {
  hasImageUrlSlots: boolean
  hasArraySlots: boolean
  hasSourceVideoSlot: boolean
  showModeBar: boolean
  showNoPromptNote: boolean
  hasModeGuidance: boolean
}): boolean {
  return (
    !params.hasImageUrlSlots &&
    !params.hasArraySlots &&
    !params.hasSourceVideoSlot &&
    !params.showModeBar &&
    !params.showNoPromptNote &&
    !params.hasModeGuidance
  )
}

/**
 * 从 `modelOptions` 里挑出「同一档案身份、但不是当前这条」的候选渠道。
 *
 * 身份判据用调用方传进来的 `archetypeIdOf`（渲染层是 `resolveArchetypeForOption`）——档案 id 相同 =
 * 同一个模型身份，走哪家都是这套模式，这正是「换一家就能用」成立的前提。
 * 同一 (vendor, value) 去重，且排除当前选中的那条。
 */
export function candidatesForArchetype(params: {
  options: readonly ModelOption[]
  archetypeId: string
  archetypeIdOf: (option: ModelOption) => string | undefined
  currentVendor: string | undefined
  currentValue: string | undefined
}): ModeGuidanceCandidate[] {
  const { options, archetypeId, archetypeIdOf, currentVendor, currentValue } = params
  const seen = new Set<string>()
  const out: ModeGuidanceCandidate[] = []
  for (const option of options) {
    const vendor = String(option.vendor || '').trim()
    const value = String(option.value || '').trim()
    if (!vendor || !value) continue
    if (vendor === currentVendor && value === currentValue) continue
    if (archetypeIdOf(option) !== archetypeId) continue
    const dedupeKey = `${vendor}\u0000${value}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({ value, vendor, vendorName: String(option.vendorName || '').trim() || vendor })
  }
  return out
}
