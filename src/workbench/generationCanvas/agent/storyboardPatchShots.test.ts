import { describe, expect, it } from 'vitest'

import type { StoryboardPatchShotsInput } from './storyboardPatchShots'
import {
  previewStoryboardPatchShots,
  StoryboardPatchShotsError,
} from './storyboardPatchShots'
import type { StoryboardPlan } from './storyboardPlan'

const basePlan: StoryboardPlan = {
  title: '雨夜追凶',
  anchors: [],
  shots: [
    { index: 1, shotKind: 'image', durationSec: 5, anchorIds: ['hero'], prompt: '' },
    {
      index: 2,
      shotKind: 'video',
      durationSec: 8,
      anchorIds: ['hero'],
      prompt: '跟拍',
      promptSegments: [{ key: 'shotSize', start: 0, end: 2 }],
      params: { aspect_ratio: '16:9', quality: 'high' },
      modelKey: 'old-model',
      modelVendor: 'old-vendor',
      modeId: 'old-mode',
    },
    { index: 3, durationSec: 5, anchorIds: [], prompt: '远景' },
  ],
}

function input(input: Omit<StoryboardPatchShotsInput, 'operation'>): StoryboardPatchShotsInput {
  return { operation: 'patch_shots', ...input }
}

describe('storyboardPatchShots scoped production coverage', () => {
  it('selects every row and preserves existing fields while applying the narrow patch', () => {
    const result = previewStoryboardPatchShots(basePlan, input({
      select: { kind: 'all' },
      patch: { promptAppend: '雨天', shotKind: 'video', durationSec: 10, aspectRatio: '9:16' },
    }))

    expect(result.changedShotIndexes).toEqual([1, 2, 3])
    expect(result.changedFields).toEqual(['prompt', 'shotKind', 'durationSec', 'aspectRatio'])
    expect(result.nextPlan.shots[0]).toMatchObject({ prompt: '雨天', shotKind: 'video', durationSec: 10, anchorIds: ['hero'] })
    expect(result.nextPlan.shots[1]).toMatchObject({
      prompt: '跟拍，雨天',
      shotKind: 'video',
      durationSec: 10,
      anchorIds: ['hero'],
      params: { aspect_ratio: '9:16', quality: 'high' },
    })
    expect(result.nextPlan.shots[2]).toMatchObject({ prompt: '远景，雨天', durationSec: 10 })
    expect(result.nextPlan.shots[1].modelKey).toBe('old-model')
  })

  it('deduplicates selected indexes, replaces prompt, and clears prompt segment metadata', () => {
    const result = previewStoryboardPatchShots(basePlan, input({
      select: { kind: 'indexes', indexes: [3, 1, 3] },
      patch: { prompt: '新的镜头提示' },
    }))

    expect(result.changedShotIndexes).toEqual([1, 3])
    expect(result.changedFields).toEqual(['prompt'])
    expect(result.nextPlan.shots[0]).toMatchObject({ prompt: '新的镜头提示', anchorIds: ['hero'] })
    expect(result.nextPlan.shots[0].promptSegments).toBeUndefined()
    expect(result.nextPlan.shots[1]).toEqual(basePlan.shots[1])
    expect(result.nextPlan.shots[2]).toMatchObject({ prompt: '新的镜头提示' })
  })

  it('changes model identity with vendor and clears the prior mode', () => {
    const result = previewStoryboardPatchShots(basePlan, input({
      select: { kind: 'indexes', indexes: [2] },
      patch: { modelKey: 'new-model', modelVendor: 'new-vendor' },
    }))

    expect(result.changedFields).toEqual(['modelKey', 'modelVendor'])
    expect(result.nextPlan.shots[1]).toMatchObject({ modelKey: 'new-model', modelVendor: 'new-vendor' })
    expect(result.nextPlan.shots[1].modeId).toBeUndefined()
    expect(result.nextPlan.shots[0]).toEqual(basePlan.shots[0])
  })

  it('fails closed for an empty plan, empty index selection, and out-of-range rows', () => {
    expect(() => previewStoryboardPatchShots(
      { ...basePlan, shots: [] },
      input({ select: { kind: 'all' }, patch: { promptAppend: '不可落地' } }),
    )).toThrowError(StoryboardPatchShotsError)
    expect(() => previewStoryboardPatchShots(
      { ...basePlan, shots: [] },
      input({ select: { kind: 'all' }, patch: { promptAppend: '不可落地' } }),
    )).toThrow(/没有可修改的镜头/)

    expect(() => previewStoryboardPatchShots(
      basePlan,
      input({ select: { kind: 'indexes', indexes: [] } as never, patch: { promptAppend: '无选中' } }),
    )).toThrow(/没有可修改的镜头/)

    expect(() => previewStoryboardPatchShots(
      basePlan,
      input({ select: { kind: 'indexes', indexes: [4] }, patch: { promptAppend: '越界' } }),
    )).toThrow(/镜号 4 超出范围/)
  })
})
