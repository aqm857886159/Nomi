import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect } from '../../../design'
import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { overriddenAspectCount, planDefaultAspect, setPlanDefaultAspect, unsupportedFilmDefaultKeys } from '../../generationCanvas/agent/storyboardShotScope'
import { useVendorPreferenceOrder } from '../../common/useVendorPreference'
import { resolveShotArchetypeMode } from './shotRow/shotRowModel'
import { projectAspectOptions, storyboardBulkAspectOptions } from './storyboardBulkAspectOptions'

export default function StoryboardFilmAspect({ plan, imageModelOptions, videoModelOptions, onChange }: {
  plan: StoryboardPlan
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  onChange: (plan: StoryboardPlan) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const orderedVendorKeys = useVendorPreferenceOrder()
  const aspect = planDefaultAspect(plan)
  const overrides = overriddenAspectCount(plan)
  const unsupported = useMemo(() => plan.shots.filter(shot => {
    if (!shot.modelKey) return false
    const option = findModelOptionByIdentifier(shot.shotKind === 'image' ? imageModelOptions : videoModelOptions, shot.modelKey, shot.modelVendor, orderedVendorKeys)
    const resolved = resolveShotArchetypeMode(option, shot.modeId)
    return resolved ? unsupportedFilmDefaultKeys(plan, shot, resolved.mode.params).length > 0 : false
  }).length, [plan, imageModelOptions, videoModelOptions, orderedVendorKeys])
  const options = useMemo(() => storyboardBulkAspectOptions(projectAspectOptions(plan, imageModelOptions, videoModelOptions), aspect).map(option => option.value === '' ? { ...option, label: t('storyboardEditor.aspectScope.modelDefault') } : option), [plan, imageModelOptions, videoModelOptions, aspect, t])
  if (plan.shots.length === 0) return null
  return <>
    <span data-storyboard-aspect-default={aspect || 'model-default'}>
      <NomiSelect ariaLabel={t('storyboardEditor.aspectScope.film')} leadingLabel={t('storyboardEditor.aspectScope.film')} size="xs" value={aspect} options={options} onChange={value => onChange(setPlanDefaultAspect(plan, value))} />
    </span>
    {overrides > 0 ? <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.aspectScope.bulkHint', { count: overrides })}</span> : null}
    {unsupported > 0 ? <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.aspectScope.unsupportedHint', { count: unsupported })}</span> : null}
  </>
}
