import { pickStoryboardDefaultModel, type AgentModelEntry } from './availableModels'
import { appendBinding, bindingsOf } from '../../creation/storyboard/shotRow/shotReferenceSlots'
import { slotAsArray } from '../nodes/controls/archetypeMeta'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { anchorsConsumedBy } from '../../../config/modelArchetypes/anchorPolicy'
import type { ArchetypeMode } from '../../../config/modelArchetypes/types'
import type { PlanShot, StoryboardPlan } from './storyboardPlan'
import { isVisualAnchor } from './storyboardPromptCompiler'
import i18n from '../../../i18n'

export type IgnoredAnchor = { anchorId: string; name: string; reason: string }
export type AnchorModelFitIssue = {
  kind: 'anchor-not-consumable'
  shotIndex: number
  ignoredAnchors: IgnoredAnchor[]
  correction: string
}

export function ignoredShotAnchors(plan: StoryboardPlan, shot: PlanShot, mode: ArchetypeMode | null | undefined): IgnoredAnchor[] {
  if (!mode || !anchorsConsumedBy(mode).includes('none')) return []
  return plan.anchors.filter(anchor => shot.anchorIds.includes(anchor.id) && isVisualAnchor(anchor)).map(anchor => ({
    anchorId: anchor.id,
    name: anchor.name,
    reason: i18n.t('storyboardEditor.anchorPolicy.ignoredReason', { mode: mode.id }),
  }))
}

/** Advisory only: a user's explicit t2v choice is accepted unchanged. */
export function validateAnchorModelFit(plan: StoryboardPlan): AnchorModelFitIssue[] {
  return plan.shots.flatMap(shot => {
    const archetype = resolveArchetypeForModel({ modelKey: shot.modelKey ?? '', vendorKey: shot.modelVendor })
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
export function normalizeStoryboardAnchorDefaults(plan: StoryboardPlan, entries: readonly AgentModelEntry[]): StoryboardPlan {
  const shots = plan.shots.map(shot => {
    // The image+video workflow already routes character anchors through its keyframe;
    // replacing the video's first frame with a character sheet would break that chain.
    if (shot.keyframe?.enabled) return shot
    const anchors = realCharacterReferences(plan, shot)
    if (!anchors.length) return shot
    const kind = shot.shotKind ?? (shot.durationSec > 0 ? 'video' : 'image')
    const candidates = entries.filter(candidate => !shot.modelVendor || candidate.vendor === shot.modelVendor)
    const entry = shot.modelKey
      ? candidates.find(candidate => candidate.kind === kind && candidate.modelKey === shot.modelKey)
      : pickStoryboardDefaultModel(candidates, kind)
    if (!entry) throw new Error(i18n.t('storyboardEditor.anchorPolicy.catalogMissing', { index: shot.index }))
    const archetype = resolveArchetypeForModel({ modelKey: entry.modelKey, modelAlias: entry.modelAlias,
      vendorKey: entry.vendor, meta: { archetypeId: entry.archetypeId } })
    const modes = archetype?.modes.filter(mode => entry.modes.some(candidate => candidate.modeId === mode.id)) ?? []
    const referenceModes = modes.filter(mode => mode.slots.some(slot => slot.kind === 'image_ref' || slot.kind === 'first_frame'))
    if (!referenceModes.length) return { ...shot, modelKey: entry.modelKey, ...(entry.vendor ? { modelVendor: entry.vendor } : {}), modeId: shot.modeId ?? entry.defaultModeId }
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
      return { ...shot, modelKey: entry.modelKey, ...(entry.vendor ? { modelVendor: entry.vendor } : {}), modeId: mode.id, referenceBindings: bindings }
    }
    throw new Error(i18n.t('storyboardEditor.anchorPolicy.capacityExceeded', { index: shot.index }))
  })
  return { ...plan, shots }
}

export function hasRealCharacterReferences(plan: StoryboardPlan): boolean {
  return plan.shots.some(shot => !shot.keyframe?.enabled && realCharacterReferences(plan, shot).length > 0)
}
