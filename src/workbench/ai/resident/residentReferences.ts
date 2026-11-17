import type { ProjectAgentReference } from '../../workbenchStore'
import { stableShotId } from '../../../../electron/shared/storyboard/storyboardSubjectIdentity'
import type { PlanShot } from '../../../../electron/shared/storyboard/storyboardPlan'

/** Stable reference emitted by a real storyboard row/result selection. */
export function buildStoryboardReference(
  label: string,
  identity: Readonly<{documentId:string;designId:string;shot:Pick<PlanShot, 'index' | 'shotId'>}>,
): ProjectAgentReference {
  const value = `storyboard:plan:${JSON.stringify([identity.documentId,identity.designId,stableShotId(identity.shot)])}`
  return Object.freeze({ id: value, label, kind: 'canvas' as const, value })
}

export function isStoryboardReference(reference: ProjectAgentReference): boolean {
  return reference.value?.startsWith('storyboard:') === true
}

/**
 * Stable plan selection only; stale chips cannot be reinterpreted in another plan.
 * The plan a chip names is part of its identity — a chip that outlived its plan is refused,
 * never re-pointed at whichever plan happens to be open.
 */
export function storyboardShotIdsForTarget(references:readonly ProjectAgentReference[], target:{documentId:string;designId:string}):string[] | undefined {
  const selected=references.filter(isStoryboardReference)
  if (!selected.length) return undefined
  const ids:string[]=[]
  for (const reference of selected) {
    if (!reference.value?.startsWith('storyboard:plan:')) throw new Error('storyboard_reference_target_stale')
    let tuple:unknown
    try { tuple=JSON.parse(reference.value.slice('storyboard:plan:'.length)) } catch {throw new Error('storyboard_reference_target_stale')}
    if (!Array.isArray(tuple) || tuple.length!==3 || tuple[0]!==target.documentId || tuple[1]!==target.designId || typeof tuple[2]!=='string' || !tuple[2]) throw new Error('storyboard_reference_target_stale')
    if (!ids.includes(tuple[2])) ids.push(tuple[2])
  }
  return ids
}
