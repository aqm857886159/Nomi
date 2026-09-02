import { describe, expect, it } from 'vitest'
import { promptRangeToDocRanges } from '../../../assets/promptEditorSkeleton'
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

  it('提示词范围映射到编辑器位置时保留内联 @ 原子节点的占位宽度', () => {
    const runs = [
      { promptStart: 0, promptEnd: 2, docStart: 1, docEnd: 3, atom: false },
      { promptStart: 2, promptEnd: 20, docStart: 3, docEnd: 4, atom: true },
      { promptStart: 20, promptEnd: 24, docStart: 4, docEnd: 8, atom: false },
    ]
    expect(promptRangeToDocRanges({ key: 'shotSize', start: 20, end: 24 }, runs)).toEqual([{ from: 4, to: 8 }])
    expect(promptRangeToDocRanges({ key: 'whole', start: 0, end: 24 }, runs)).toEqual([
      { from: 1, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 8 },
    ])
  })
})
