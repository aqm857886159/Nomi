import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { applyBulkParamToShots, deriveBulkParamScope } from './storyboardBulkParamScope'

/** 模型清单用真实档案认得的 modelKey：参数由真档案派生，不是这里手写的。 */
const VIDEO: ModelOption[] = [
  { value: 'seedance-2-5', label: 'Seedance 2.5', vendor: 'kie', vendorName: 'kie', modelKey: 'bytedance/seedance-2-5' },
  { value: 'veo-3-1', label: 'Veo 3.1', vendor: 'kie', vendorName: 'kie', modelKey: 'veo-3.1' },
  { value: 'kling-3.0/video', label: 'Kling 3.0', vendor: 'kie', vendorName: 'kie', modelKey: 'kling-3.0/video' },
  { value: 'minimax-hailuo-3', label: 'Hailuo 3', vendor: 'apimart', vendorName: 'APIMart', modelKey: 'minimax-hailuo-3' },
]

function shot(index: number, modelKey: string, vendor: string, over: Partial<PlanShot> = {}): PlanShot {
  return { index, durationSec: 5, anchorIds: [], prompt: 'p', shotKind: 'video', modelKey, modelVendor: vendor, ...over } as PlanShot
}
const scope = (shots: PlanShot[]) => deriveBulkParamScope({ shots, modelOptions: VIDEO, kind: 'video', aspectOf: () => '16:9' })
const keys = (controls: readonly { key: string }[]) => controls.map((control) => control.key)

describe('deriveBulkParamScope（公共参数集 = 所选镜各模型档案的交集）', () => {
  it('同一个模型：就是它自己的全部参数', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie'), shot(2, 'bytedance/seedance-2-5', 'kie')])
    expect(keys(result.controls)).toEqual(expect.arrayContaining(['resolution', 'aspect_ratio', 'duration', 'generate_audio']))
    expect(result.excluded).toEqual([])
  })

  it('Seedance + Kling：比例取候选交集、时长取 Kling 的离散值与 Seedance 范围的重叠，清晰度整项不出现', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie'), shot(2, 'kling-3.0/video', 'kie')])
    const aspect = result.controls.find((control) => control.key === 'aspect_ratio')
    expect(aspect?.options.map((option) => option.value)).toEqual(['16:9', '9:16', '1:1'])
    const duration = result.controls.find((control) => control.key === 'duration')
    expect(duration?.type).toBe('select')
    expect(duration?.options.map((option) => String(option.value))).toEqual(['5', '10'])
    expect(keys(result.controls)).not.toContain('resolution')
    const resolution = result.excluded.find((entry) => entry.key === 'resolution')
    expect(resolution).toMatchObject({ reason: 'not-all-models', models: ['Kling 3.0'] })
  })

  it('跨三个模型（含没有时长的 Veo）：只剩比例，且说得出每一项是谁没有', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie'), shot(2, 'veo-3.1', 'kie'), shot(3, 'kling-3.0/video', 'kie')])
    expect(keys(result.controls)).toEqual(['aspect_ratio'])
    expect(result.controls[0].options.map((option) => option.value)).toEqual(['16:9', '9:16'])
    expect(result.excluded.find((entry) => entry.key === 'duration')?.models).toEqual(['Veo 3.1'])
  })

  it('有一镜的模型没有任何可调参数：公共集为空，全部项都有说法', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie'), shot(2, 'minimax-hailuo-3', 'apimart')])
    expect(result.controls).toEqual([])
    expect(result.excluded.length).toBeGreaterThan(0)
    expect(result.excluded.every((entry) => entry.models.includes('Hailuo 3'))).toBe(true)
  })

  it('认不出模型（默认模型）的镜：公共集为空，并记数', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie'), shot(2, '', '')])
    expect(result.controls).toEqual([])
    expect(result.unresolved).toBe(1)
  })

  it('取值一致的键给出值，不一致的记为「混合」', () => {
    const result = scope([shot(1, 'bytedance/seedance-2-5', 'kie', { durationSec: 5, modeId: 'omni' }), shot(2, 'bytedance/seedance-2-5', 'kie', { durationSec: 8, modeId: 'omni' })])
    expect(result.mixedKeys).toContain('duration')
    expect(result.uniformValues.duration).toBeUndefined()
    expect(result.uniformValues.aspect_ratio).toBe('16:9')
  })
})

describe('applyBulkParamToShots（写到哪儿 = 行底栏同一把尺，只动选中且镜种相符的镜）', () => {
  const plan = (): StoryboardPlan => ({
    title: 't',
    anchors: [],
    shots: [
      shot(1, 'bytedance/seedance-2-5', 'kie', { modeId: 'omni' }),
      shot(2, 'bytedance/seedance-2-5', 'kie', { modeId: 'omni' }),
      shot(3, 'bytedance/seedance-2-5', 'kie', { modeId: 'omni' }),
    ],
  })
  const controls = deriveBulkParamScope({ shots: plan().shots, modelOptions: VIDEO, kind: 'video', aspectOf: () => '16:9' }).controls
  const pick = (key: string) => controls.find((control) => control.key === key)!
  const selectedFirstTwo = (candidate: PlanShot): boolean => candidate.index <= 2

  it('比例 → 行级画幅覆盖；未选中的镜不动', () => {
    const next = applyBulkParamToShots({ plan: plan(), isSelected: selectedFirstTwo, kind: 'video', control: pick('aspect_ratio'), raw: '9:16', controls })
    expect(next.shots.map((entry) => entry.params?.aspect_ratio)).toEqual(['9:16', '9:16', undefined])
  })

  it('其余参数 → params；时长 → durationSec', () => {
    const resolution = applyBulkParamToShots({ plan: plan(), isSelected: selectedFirstTwo, kind: 'video', control: pick('resolution'), raw: '480p', controls })
    expect(resolution.shots.map((entry) => entry.params?.resolution)).toEqual(['480p', '480p', undefined])
    const duration = applyBulkParamToShots({ plan: plan(), isSelected: selectedFirstTwo, kind: 'video', control: pick('duration'), raw: '12', controls })
    expect(duration.shots.map((entry) => entry.durationSec)).toEqual([12, 12, 5])
  })

  it('镜种不符的镜原样不动', () => {
    const next = applyBulkParamToShots({ plan: plan(), isSelected: () => true, kind: 'image', control: pick('resolution'), raw: '480p', controls })
    expect(next.shots.every((entry) => entry.params?.resolution === undefined)).toBe(true)
  })
})
