import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { PlanShot, StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { applyBulkModelToShots, storyboardBulkModelGroups, storyboardShotKind } from './storyboardBulkModelScope'

const IMAGE_MODELS: ModelOption[] = [
  { value: 'apimart::gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2' },
]
const VIDEO_MODELS: ModelOption[] = [
  { value: 'apimart::MiniMax-H3', label: 'MiniMax H3', vendor: 'apimart', modelKey: 'MiniMax-H3' },
  { value: 'kie::veo3', label: 'Veo 3', vendor: 'kie', modelKey: 'veo3' },
]

function shot(index: number, shotKind?: 'image' | 'video'): PlanShot {
  return { index, shotId: `shot-${index}`, durationSec: 5, anchorIds: [], prompt: `p${index}`, ...(shotKind ? { shotKind } : {}) }
}

function plan(shots: PlanShot[]): StoryboardPlan {
  return { title: 'fixture', anchors: [], shots }
}

describe('storyboardShotKind', () => {
  it('旧草稿没有 shotKind 时按 video——与行级下拉、deriveStoryboardRowRuntimes 同一句', () => {
    expect(storyboardShotKind(shot(1))).toBe('video')
    expect(storyboardShotKind(shot(2, 'image'))).toBe('image')
    expect(storyboardShotKind(shot(3, 'video'))).toBe('video')
  })
})

describe('storyboardBulkModelGroups', () => {
  it('全是图片镜时只给图片模型——视频模型一个都不出现（2026-09-11 反馈的混列表回归）', () => {
    const groups = storyboardBulkModelGroups({
      shots: [shot(1, 'image'), shot(2, 'image')],
      imageModelOptions: IMAGE_MODELS,
      videoModelOptions: VIDEO_MODELS,
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('image')
    expect(groups[0].count).toBe(2)
    expect(groups[0].options).toEqual(IMAGE_MODELS)
    expect(groups.flatMap((group) => group.options.map((option) => option.value))).not.toContain('kie::veo3')
  })

  it('全是视频镜时只给视频模型', () => {
    const groups = storyboardBulkModelGroups({
      shots: [shot(1), shot(2, 'video')],
      imageModelOptions: IMAGE_MODELS,
      videoModelOptions: VIDEO_MODELS,
    })
    expect(groups.map((group) => group.kind)).toEqual(['video'])
    expect(groups[0].count).toBe(2)
    expect(groups[0].options).toEqual(VIDEO_MODELS)
  })

  it('混选出两档、image 在前，各自计数是真实镜数（下拉的 leadingLabel 靠它写「图片 ×N」）', () => {
    const groups = storyboardBulkModelGroups({
      shots: [shot(1, 'video'), shot(2, 'image'), shot(3, 'video'), shot(4, 'image'), shot(5, 'image')],
      imageModelOptions: IMAGE_MODELS,
      videoModelOptions: VIDEO_MODELS,
    })
    expect(groups.map((group) => [group.kind, group.count])).toEqual([['image', 3], ['video', 2]])
  })

  it('某一档一个模型都没接入就不出那一档——不给一个点开是空的下拉', () => {
    const groups = storyboardBulkModelGroups({
      shots: [shot(1, 'image'), shot(2, 'video')],
      imageModelOptions: [],
      videoModelOptions: VIDEO_MODELS,
    })
    expect(groups.map((group) => group.kind)).toEqual(['video'])
  })

  it('没选中任何镜就没有任何档', () => {
    expect(storyboardBulkModelGroups({ shots: [], imageModelOptions: IMAGE_MODELS, videoModelOptions: VIDEO_MODELS })).toEqual([])
  })
})

describe('applyBulkModelToShots', () => {
  const source = plan([shot(1, 'image'), shot(2, 'video'), shot(3, 'image')])
  const selectAll = (): boolean => true

  it('镜种不合的选中镜原样不动——不给它安一个跑不了的模型（禁静默转进）', () => {
    const next = applyBulkModelToShots({ plan: source, isSelected: selectAll, kind: 'image', modelKey: 'gpt-image-2', vendor: 'apimart' })
    expect(next.shots.map((s) => s.modelKey)).toEqual(['gpt-image-2', undefined, 'gpt-image-2'])
    expect(next.shots[1]).toBe(source.shots[1])
  })

  it('写的是 (vendor, modelKey) 两半身份，模式与参数跟着模型清空', () => {
    const dirty = plan([{ ...shot(1, 'video'), modelKey: 'old', modelVendor: 'kie', modeId: 'mode-a', params: { aspect_ratio: '9:16' } }])
    const next = applyBulkModelToShots({ plan: dirty, isSelected: selectAll, kind: 'video', modelKey: 'MiniMax-H3', vendor: 'apimart' })
    expect(next.shots[0]).toMatchObject({ modelKey: 'MiniMax-H3', modelVendor: 'apimart' })
    expect(next.shots[0].modeId).toBeUndefined()
    expect(next.shots[0].params).toBeUndefined()
  })

  it('没选中的镜不动，哪怕镜种相符', () => {
    const next = applyBulkModelToShots({
      plan: source,
      isSelected: (s) => s.index === 1,
      kind: 'image',
      modelKey: 'gpt-image-2',
      vendor: 'apimart',
    })
    expect(next.shots.map((s) => s.modelKey)).toEqual(['gpt-image-2', undefined, undefined])
  })

  it('空 modelKey 不改任何东西（原 plan 原样返回）', () => {
    expect(applyBulkModelToShots({ plan: source, isSelected: selectAll, kind: 'image', modelKey: '' })).toBe(source)
  })
})
