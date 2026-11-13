import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { effectiveShotAspect, resolveShotParams } from '../../generationCanvas/agent/storyboardShotScope'
import { composerEntryIndex, storyboardComposerControls, storyboardComposerMeta } from './shotRow/storyboardComposerModel'
import { isParameterControl } from '../../generationCanvas/nodes/controls/parameterControlModel'

/** Project aspect candidates remain the intersection of the participating model catalogs. */
export function projectAspectOptions(plan: StoryboardPlan, imageModelOptions: readonly ModelOption[], videoModelOptions: readonly ModelOption[]): readonly string[] | null {
  let common: string[] | null = null
  for (const shot of plan.shots) {
    const kind = shot.shotKind === 'image' ? 'image' : 'video'
    const option = findModelOptionByIdentifier(kind === 'image' ? imageModelOptions : videoModelOptions, shot.modelKey, shot.modelVendor)
    const meta = storyboardComposerMeta({ ...shot, params: { ...resolveShotParams(plan, shot), ...(effectiveShotAspect(plan, shot) ? { aspect_ratio: effectiveShotAspect(plan, shot) } : {}) } }, composerEntryIndex(option))
    const control = storyboardComposerControls(option, meta, kind).filter(isParameterControl).find(candidate => candidate.key === 'aspect_ratio')
    if (!control) continue
    const values = control.options.map(candidate => String(candidate.value))
    common = common ? common.filter(value => values.includes(value)) : values
  }
  return common
}

/** 同一份下拉值供整片画幅和持久化属性门使用；空串明确表示按模型默认。 */
export function storyboardBulkAspectOptions(derived: readonly string[] | null, current: string): Array<{ value: string; label: string }> {
  return [
    { value: '', label: '' },
    ...[...new Set([...(derived ?? []), ...(current ? [current] : [])])].filter(Boolean).map(value => ({ value, label: value })),
  ]
}
