import { describe, expect, it } from 'vitest'
import { storyboardProfileForKey } from '../../../generationCanvas/agent/storyboardProfiles'
import { replacePromptSkeletonRange, validPromptSkeletonSegments } from './promptSkeletonRangeUtils'

const profile = storyboardProfileForKey('genre.short-drama')

describe('PromptSkeletonSegments', () => {
  it('只渲染仍落在 prompt 内且属于 profile 的 range，标注丢失回到纯文本', () => {
    expect(validPromptSkeletonSegments('远景，雨夜', profile, [
      { key: 'shotSize', start: 0, end: 2 },
      { key: 'missing', start: 0, end: 2 },
      { key: 'emotion', start: 50, end: 55 },
    ])).toMatchObject([{ key: 'shotSize', value: '远景' }])
    expect(validPromptSkeletonSegments('远景，雨夜', profile, undefined)).toEqual([])
  })

  it('点预设直接替换文本，并把后续 range 平移；没有第二份 prompt 真相', () => {
    const result = replacePromptSkeletonRange(
      '远景，雨夜，紧张',
      [{ key: 'shotSize', start: 0, end: 2 }, { key: 'emotion', start: 6, end: 8 }],
      { key: 'shotSize', start: 0, end: 2 },
      '特写',
    )
    expect(result.prompt).toBe('特写，雨夜，紧张')
    expect(result.ranges).toEqual([{ key: 'shotSize', start: 0, end: 2 }, { key: 'emotion', start: 6, end: 8 }])
  })
})
