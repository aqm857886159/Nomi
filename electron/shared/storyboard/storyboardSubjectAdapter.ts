import type { StoryboardAuthorFields } from '../agentCapabilities/generationPlanSchemas'
import { modelKindForTaskKind } from '../capabilityModeManifest'
import type { PlanCandidate } from '../../capabilityCore/executionContract'
import type { PlanAnchor, PlanShot, StoryboardPlan } from './storyboardPlan'
import { planAnchorSchema, planShotSchema } from './storyboardPlanSchema'
import { foldRatioIntoSlot } from './storyboardShotScope'
import { mergeNamedParameters } from '../generationParameterPatch'
import { StoryboardSubjectNotFoundError, storyboardSubjectAt } from './storyboardSubjectIdentity'

/**
 * 一个 Agent 草稿镜头 ↔ 原编辑器契约（`StoryboardPlan`）之间的**纯适配层**。
 *
 * 这里没有存储：一份文稿来源的分镜方案只有一个家——项目记录里的 `storyboardDesign`，
 * 和用户手建的那种完全同一份。本文件只负责把一个已准入的候选翻成编辑器认的主体形状。
 */

function shotKindOf(candidate: PlanCandidate): Pick<PlanShot, 'shotKind'> {
  const kind = modelKindForTaskKind(candidate.mode)
  return kind === 'image' || kind === 'video' ? { shotKind: kind } : {}
}

function candidateFields(candidate: PlanCandidate) {
  return {
    ...(candidate.modelId ? { modelKey: candidate.modelId } : {}),
    ...(candidate.providerId ? { modelVendor: candidate.providerId } : {}),
    ...(candidate.modeId ? { modeId: candidate.modeId } : {}),
    // 比例收进分镜的比例槽（宿主起草时已翻成这个模型的真实键，分镜方案里比例只住 `aspect_ratio` 一个家）。
    ...(Object.keys(candidate.parameters).length ? { params: foldRatioIntoSlot(structuredClone(candidate.parameters),
      { modelKey: candidate.modelId, modelVendor: candidate.providerId, ...(candidate.modeId ? { modeId: candidate.modeId } : {}) }) } : {}),
  }
}

/**
 * Adapt an admitted Agent subject into the existing editor contract exactly once, at author creation.
 * 镜号不在这里定：`index` 先写 0，接进方案时由分镜主体身份的唯一 owner（`appendStoryboardSubjects`）按
 * 「它在镜头里的位置」发——这里曾经收调用方给的位置，而那个位置是锚和镜头混排的下标（行号从 03 起）。
 */
export function storyboardSubjectFromCandidate(input: {shotId: string; role?: 'anchor' | 'shot'; title?: string; candidate: PlanCandidate},
  authored?: StoryboardAuthorFields, referenceUrls: Readonly<Record<string, string>> = {}): PlanAnchor | PlanShot {
  const candidate = input.candidate
  const fields = candidateFields(candidate)
  const referenceBindings: Record<string, Array<{url:string}>> = {}
  for (const reference of candidate.references) {
    const url = referenceUrls[reference.assetId]
    if (!url) throw new Error('storyboard_reference_preview_unavailable')
    ;(referenceBindings[storyboardReferenceSlot(reference)] ??= []).push({url})
  }
  if (authored?.referenceBindings && candidate.references.length) throw new Error('storyboard_author_reference_fields_conflict')
  const common = {...fields,...(candidate.references.length ? {referenceBindings} : {})}
  if (input.role === 'anchor') {
    if (!authored?.kind || !authored.carrier) throw new Error('storyboard_anchor_editorial_required: provide storyboard.kind and storyboard.carrier')
    return planAnchorSchema.parse({...authored,...common,id:input.shotId,kind:authored.kind,carrier:authored.carrier,name:input.title ?? candidate.prompt,description:candidate.prompt})
  }
  if (authored?.kind || authored?.carrier) throw new Error('storyboard_subject_role_mismatch')
  return planShotSchema.parse({durationSec:typeof candidate.parameters.duration === 'number' ? candidate.parameters.duration : 0,anchorIds:[],prompt:candidate.prompt,...shotKindOf(candidate),...authored,...common,shotId:input.shotId,index:0})

}

export function patchStoryboardSubject(plan: StoryboardPlan, shotId: string, patch: Record<string, unknown>, references?: Record<string, Array<{url: string}>>): PlanAnchor | PlanShot {
  // 寻址只认分镜主体身份的唯一 owner：`shot-N` 只在镜头里找，永远不会落到参考卡上。
  const found = storyboardSubjectAt(plan, shotId)
  if (found.kind === 'missing') throw new StoryboardSubjectNotFoundError(shotId, found.shots, found.anchorHoldsShotNumber)
  const subject: PlanAnchor | PlanShot = found.kind === 'anchor' ? found.anchor : found.shot
  const authored=patch.storyboard as StoryboardAuthorFields | undefined
  const duration = (patch.parameters as Record<string, unknown> | undefined)?.duration
  const merged = {...subject,...authored,
    ...(!('description' in subject) && patch.prompt !== undefined && patch.prompt !== subject.prompt
      && authored?.promptSegments === undefined ? {promptSegments:undefined} : {}),
    // Match creation: an explicit author duration overrides the candidate parameter.
    ...(!('description' in subject) && authored?.durationSec === undefined && typeof duration === 'number'
      ? {durationSec:duration} : {}),
    ...(!('description' in subject) && authored?.keyframe ? {keyframe:{...subject.keyframe,...authored.keyframe,
      ...(authored.keyframe.params ? {params:{...subject.keyframe?.params,...authored.keyframe.params}} : {})}} : {}),
    ...(patch.prompt !== undefined ? {['description' in subject ? 'description' : 'prompt']:patch.prompt} : {}),
    ...(patch.modelId !== undefined ? {modelKey:patch.modelId} : {}),
    ...(patch.providerId !== undefined ? {modelVendor:patch.providerId} : {}),
    ...(patch.modeId !== undefined ? {modeId:patch.modeId} : {}),
    // 改一镜 = 只改点名的参数（null 删键），与宿主改草稿同一个函数；比例收进分镜的比例槽。
    ...(patch.parameters !== undefined ? {params:foldRatioIntoSlot(
      mergeNamedParameters(subject.params ?? {}, patch.parameters as Record<string, unknown>),
      {modelKey:patch.modelId !== undefined ? String(patch.modelId) : subject.modelKey,
        modelVendor:patch.providerId !== undefined ? String(patch.providerId) : subject.modelVendor,
        modeId:patch.modeId !== undefined ? String(patch.modeId) : subject.modeId})} : {}),
    ...(references ? {referenceBindings:references} : {}),
  } as PlanAnchor | PlanShot
  if (patch.taskKind !== undefined && !('description' in merged)) merged.shotKind = String(patch.taskKind).includes('video') ? 'video' : 'image'
  return 'description' in subject ? planAnchorSchema.parse(merged) : planShotSchema.parse(merged)
}

/** Map pinned execution reference roles to the original storyboard slot vocabulary. */
export function storyboardReferenceSlot(reference: PlanCandidate['references'][number]): string {
  switch (reference.role) {
    case 'first_frame': case 'last_frame': return reference.role
    case 'character': return 'image_ref'
    case 'audio': return 'audio_ref'
    case 'reference': case undefined:
      return reference.kind === 'video' ? 'video_ref' : reference.kind === 'audio' ? 'audio_ref' : 'image_ref'
    default: throw new Error('storyboard_reference_role_invalid')
  }
}
