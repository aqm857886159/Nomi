import { expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { projectAspectOptions, storyboardBulkAspectOptions } from './storyboardBulkAspectOptions'

it('film aspect retains the catalog intersection, current value, and model-default option', () => {
  const models: ModelOption[] = [
    { value: 'seedance-2-5', modelKey: 'bytedance/seedance-2-5', vendor: 'kie', label: 'Video A', kind: 'video' },
    { value: 'veo-3-1', modelKey: 'veo-3.1', vendor: 'kie', label: 'Video B', kind: 'video' },
  ]
  const plan: StoryboardPlan = { title: 'Film', anchors: [], aspectRatio: '4:3', shots: models.map((model, index) => ({ index: index + 1, shotKind: 'video', durationSec: 5, prompt: 'Shot', anchorIds: [], modelKey: model.modelKey, modelVendor: model.vendor })) }
  const derived = projectAspectOptions(plan, [], models)
  expect(derived).toEqual(['16:9', '9:16'])
  expect(storyboardBulkAspectOptions(derived, '4:3').map(option => option.value)).toEqual(['', '16:9', '9:16', '4:3'])
  expect(plan.aspectRatio).toBe('4:3')
  expect(plan.shots.every(shot => shot.params === undefined)).toBe(true)
})
