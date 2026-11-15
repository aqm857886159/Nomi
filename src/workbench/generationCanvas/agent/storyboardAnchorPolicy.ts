import { pickStoryboardDefaultModel, type AgentModelEntry } from './availableModels'
import { appendBinding, bindingsOf } from '../../creation/storyboard/shotRow/shotReferenceSlots'
import { slotAsArray } from '../nodes/controls/archetypeMeta'
import { resolveModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { pickImplicitVendorMatch } from '../../../config/modelIdentity'
import { anchorsConsumedBy } from '../../../../electron/shared/modelArchetypes/anchorPolicy'
import type { ArchetypeMode } from '../../../../electron/shared/modelArchetypes/types'
import type { PlanShot, StoryboardPlan } from './storyboardPlan'
import { isVisualAnchor } from './storyboardPromptCompiler'
import i18n from '../../../i18n'

/**
 * 「这一行上摆着、当前模式却用不上」的参考图（2026-09-30）。
 *
 * 名字沿用 IgnoredAnchor / 'anchor-ignored' 是因为状态词表与门岗登记按这个 id 认；含义已经变了：
 * 它**只**看这一行参考列里真的摆着的绑定（referenceBindings），不再看 anchorIds——引用锚不再产生任何作用。
 * 只有行上真有参考图、而模式没有对应的槽才算「用不上」，并且逐张点名（用户要知道是哪一张不会发）。
 */
export type IgnoredAnchor = { anchorId: string; name: string; reason: string }
export type AnchorModelFitIssue = {
  kind: 'anchor-not-consumable'
  shotIndex: number
  ignoredAnchors: IgnoredAnchor[]
  correction: string
}

export function ignoredShotAnchors(_plan: StoryboardPlan, shot: PlanShot, mode: ArchetypeMode | null | undefined): IgnoredAnchor[] {
  if (!mode) return []
  const declared = new Set(mode.slots.map((slot) => slot.kind as string))
  return Object.keys(shot.referenceBindings ?? {}).flatMap((slotKey) => declared.has(slotKey) ? [] : bindingsOf(shot.referenceBindings, slotKey).map((binding) => ({
    anchorId: binding.anchorId ?? binding.url,
    name: binding.name?.trim() || i18n.t('storyboardEditor.unnamed'),
    reason: i18n.t('storyboardEditor.anchorPolicy.ignoredReason', { mode: mode.id }),
  })))
}

/** Advisory only: a user's explicit t2v choice is accepted unchanged. */
export function validateAnchorModelFit(plan: StoryboardPlan): AnchorModelFitIssue[] {
  return plan.shots.flatMap(shot => {
    const archetype = resolveModelArchetype({ modelKey: shot.modelKey ?? '', vendorKey: shot.modelVendor }, { variant: { variantId: undefined, modelId: shot.modelKey } })
    if (!archetype) return []
    const mode = archetype.modes.find(candidate => candidate.id === (shot.modeId ?? archetype.defaultModeId))
    const ignoredAnchors = ignoredShotAnchors(plan, shot, mode)
    if (!ignoredAnchors.length) return []
    const alternative = archetype.modes.find(candidate => !anchorsConsumedBy(candidate).includes('none'))
    return [{
      kind: 'anchor-not-consumable' as const,
      shotIndex: shot.index,
      ignoredAnchors,
      correction: i18n.t(alternative ? 'storyboardEditor.anchorPolicy.switchMode' : 'storyboardEditor.anchorPolicy.removeAnchors', {
        index: shot.index, mode: mode?.id, alternative: alternative?.id, anchors: ignoredAnchors.map(anchor => anchor.name).join('、'),
      }),
    }]
  })
}

function realCharacterReferences(plan: StoryboardPlan, shot: PlanShot) {
  return plan.anchors.filter(anchor => shot.anchorIds.includes(anchor.id)
    && anchor.kind === 'character' && isVisualAnchor(anchor) && anchor.referenceUrl?.trim()
    && (!anchor.referenceKind || anchor.referenceKind === 'image'))
}

/** AI draft admission only. Stored plans and explicit row edits never call this. */
export function normalizeStoryboardAnchorDefaults(plan: StoryboardPlan, entries: readonly AgentModelEntry[], orderedVendorKeys: readonly string[] = []): StoryboardPlan {
  const shots = plan.shots.map(shot => {
    // The image+video workflow already routes character anchors through its keyframe;
    // replacing the video's first frame with a character sheet would break that chain.
    if (shot.keyframe?.enabled) return shot
    const anchors = realCharacterReferences(plan, shot)
    if (!anchors.length) return shot
    const kind = shot.shotKind ?? (shot.durationSec > 0 ? 'video' : 'image')
    // 选了模型：按 (modelKey, modelVendor) 取那一家；只记了模型名（旧数据/Agent 没给 vendor）按
    // pickImplicitVendorMatch——与模型框回显、执行落地同一把尺。下面会把解析出的 vendor 写回镜头，
    // 所以这里绝不能是「列表里第一个同名的」：那等于替用户静默挑了一家并落盘（2026-09-21 同类扫描）。
    // 没选模型：vendor 只属于 modelKey 的另一半，孤立的 modelVendor 不限制默认模型挑哪家。
    const sameModel = shot.modelKey
      ? entries.filter(candidate => candidate.kind === kind && candidate.modelId === shot.modelKey && (!shot.modelVendor || candidate.vendor === shot.modelVendor))
      : []
    const entry = shot.modelKey
      ? pickImplicitVendorMatch(sameModel, candidate => candidate.vendor, orderedVendorKeys)
      : pickStoryboardDefaultModel(entries, kind, orderedVendorKeys)
    if (!entry) throw new Error(i18n.t('storyboardEditor.anchorPolicy.catalogMissing', { index: shot.index }))
    const archetype = resolveModelArchetype({ modelKey: entry.modelId, modelAlias: entry.modelAlias,
      vendorKey: entry.vendor, meta: { archetypeId: entry.archetypeId } }, { variant: { variantId: undefined, modelId: entry.modelId } })
    const modes = archetype?.modes.filter(mode => entry.modes.some(candidate => candidate.modeId === mode.id)) ?? []
    const referenceModes = modes.filter(mode => mode.slots.some(slot => slot.kind === 'image_ref' || slot.kind === 'first_frame'))
    if (!referenceModes.length) return { ...shot, modelKey: entry.modelId, ...(entry.vendor ? { modelVendor: entry.vendor } : {}), modeId: shot.modeId ?? entry.defaultModeId }
    // The model may put an anchor in an edge-named/unknown bucket. Only an
    // exact anchor-id + URL proof allows rebinding it; authored declared slots
    // and unrelated unknown inputs retain their original semantics.
    const declaredKinds = new Set(modes.flatMap(mode => mode.slots.map(slot => slot.kind as string)))
    const admittedBindings = Object.fromEntries(Object.entries(shot.referenceBindings ?? {}).filter(([key, values]) =>
      declaredKinds.has(key) || !values.length || !values.every(binding => anchors.some(anchor =>
        binding.anchorId === anchor.id && binding.url === anchor.referenceUrl))))
    // Preserve a usable selection, then prefer references over a forced opening pose.
    const ordered = [...referenceModes].sort((a, b) => {
      const rank = (mode: ArchetypeMode) => mode.id === shot.modeId ? 0 : mode.slots.some(slot => slot.kind === 'image_ref') ? 1 : 2
      return rank(a) - rank(b)
    })
    for (const mode of ordered) {
      // Retaining a field in JSON is not enough: the selected mode must still
      // project every authored nonempty slot into the request.
      if (Object.keys(admittedBindings).some(key => bindingsOf(admittedBindings, key).length > 0
        && !mode.slots.some(slot => slot.kind === key))) continue
      const slot = mode.slots.find(slot => slot.kind === 'image_ref') ?? mode.slots.find(slot => slot.kind === 'first_frame')!
      let bindings = admittedBindings
      let fits = true
      for (const anchor of anchors) {
        const current = bindingsOf(bindings, slot.kind)
        if (current.some(binding => binding.url === anchor.referenceUrl)) {
          bindings = { ...bindings, [slot.kind]: current.map(binding => binding.url === anchor.referenceUrl
            ? { ...binding, anchorId: anchor.id } : binding) }
          continue
        }
        // appendBinding replaces scalar slots for manual UI edits. AI defaults must
        // instead preserve an already authored opening frame and try another mode.
        if (!slotAsArray(slot) && current.length) { fits = false; break }
        const result = appendBinding(bindings, slot, { url: anchor.referenceUrl!, name: anchor.name, anchorId: anchor.id,
          ...(anchor.referenceSourceNodeId ? { sourceNodeId: anchor.referenceSourceNodeId } : {}) }, 'image')
        if (result.status !== 'added') { fits = false; break }
        bindings = result.next
      }
      // A first+last-only mode cannot be made runnable by copying the same face
      // into both endpoints. Required non-target slots must already be present.
      if (!fits || mode.slots.some(required => {
        const count = bindingsOf(bindings, required.kind).length
        return count < required.min || (required.max !== undefined && count > required.max)
      })) continue
      if (mode.maxTotalReferences !== undefined && mode.slots.reduce((sum, slot) => sum + bindingsOf(bindings, slot.kind).length, 0) > mode.maxTotalReferences) continue
      return { ...shot, modelKey: entry.modelId, ...(entry.vendor ? { modelVendor: entry.vendor } : {}), modeId: mode.id, referenceBindings: bindings }
    }
    throw new Error(i18n.t('storyboardEditor.anchorPolicy.capacityExceeded', { index: shot.index }))
  })
  return { ...plan, shots }
}

export function hasRealCharacterReferences(plan: StoryboardPlan): boolean {
  return plan.shots.some(shot => !shot.keyframe?.enabled && realCharacterReferences(plan, shot).length > 0)
}
