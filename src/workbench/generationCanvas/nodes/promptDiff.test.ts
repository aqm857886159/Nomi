import { describe, expect, it } from 'vitest'
import { diffPromptWords } from './promptDiff'

describe('diffPromptWords', () => {
  it('纯新增:原文整段保留,尾部追加标 added', () => {
    const segs = diffPromptWords('一只猫', '一只猫，电影感布光')
    expect(segs.filter((s) => !s.added).map((s) => s.text).join('')).toContain('一只猫')
    expect(segs.some((s) => s.added && s.text.includes('电影感布光'))).toBe(true)
  })

  it('完全相同:无 added 段', () => {
    const segs = diffPromptWords('a cat on a mat', 'a cat on a mat')
    expect(segs.every((s) => !s.added)).toBe(true)
  })

  it('中间插入:只标新增的中段', () => {
    const segs = diffPromptWords('猫坐在垫子上', '猫安静地坐在柔软的垫子上')
    const added = segs.filter((s) => s.added).map((s) => s.text).join('')
    expect(added).toContain('安静')
    expect(segs.filter((s) => !s.added).map((s) => s.text).join('')).toContain('坐在')
  })

  it('拼回优化后文本无损(added+keep 顺序拼接=optimized)', () => {
    const optimized = 'a fluffy cat on a warm mat'
    const segs = diffPromptWords('a cat on a mat', optimized)
    expect(segs.map((s) => s.text).join('')).toBe(optimized)
  })

  it('空原文:全部标 added', () => {
    const segs = diffPromptWords('', 'brand new prompt')
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.every((s) => s.added)).toBe(true)
  })
})
