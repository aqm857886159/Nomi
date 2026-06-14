import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, normalizeTimeline, resolveActiveTextClipsAtFrame, computeTimelineDuration } from './timelineMath'
import { addTextClip, moveTextClip, removeTextClip, resizeTextClip, updateTextClipText } from './timelineTextEdit'

describe('timeline 文字 clip 编辑', () => {
  it('addTextClip 在 playhead 处加默认 3s 文字 clip', () => {
    const base = createDefaultTimeline()
    const { timeline, id } = addTextClip(base, 'title', 30)
    expect(timeline.textClips).toHaveLength(1)
    const clip = timeline.textClips[0]
    expect(clip.id).toBe(id)
    expect(clip.style).toBe('title')
    expect(clip.startFrame).toBe(30)
    expect(clip.endFrame).toBe(30 + 3 * 30) // 3s @ 30fps
    expect(base.textClips).toHaveLength(0) // 不可变
  })

  it('updateTextClipText 改文字', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 0)
    const next = updateTextClipText(timeline, id, '新文案')
    expect(next.textClips[0].text).toBe('新文案')
    // 无变化返回同引用
    expect(updateTextClipText(next, id, '新文案')).toBe(next)
  })

  it('moveTextClip 保持时长、夹到 >=0', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 60)
    const moved = moveTextClip(timeline, id, 10)
    expect(moved.textClips[0].startFrame).toBe(10)
    expect(moved.textClips[0].endFrame).toBe(10 + 90)
    expect(moveTextClip(timeline, id, -5).textClips[0].startFrame).toBe(0)
  })

  it('resizeTextClip 裁两边、至少 1 帧', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 0) // 0..90
    expect(resizeTextClip(timeline, id, 'right', 45).textClips[0].endFrame).toBe(45)
    expect(resizeTextClip(timeline, id, 'left', 30).textClips[0].startFrame).toBe(30)
    // left 不能越过 end-1
    expect(resizeTextClip(timeline, id, 'left', 999).textClips[0].startFrame).toBe(89)
  })

  it('removeTextClip 删除', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'title', 0)
    expect(removeTextClip(timeline, id).textClips).toHaveLength(0)
    expect(removeTextClip(timeline, 'nope')).toBe(timeline)
  })

  it('resolveActiveTextClipsAtFrame 按区间筛', () => {
    let tl = createDefaultTimeline()
    tl = addTextClip(tl, 'caption', 0).timeline // 0..90
    tl = addTextClip(tl, 'title', 100).timeline // 100..190
    expect(resolveActiveTextClipsAtFrame(tl, 10).map((c) => c.style)).toEqual(['caption'])
    expect(resolveActiveTextClipsAtFrame(tl, 95)).toHaveLength(0)
    expect(resolveActiveTextClipsAtFrame(tl, 150).map((c) => c.style)).toEqual(['title'])
  })

  it('computeTimelineDuration 末尾文字 clip 撑出时长', () => {
    let tl = createDefaultTimeline()
    tl = addTextClip(tl, 'title', 200).timeline // 200..290
    expect(computeTimelineDuration(tl)).toBe(290)
  })

  it('normalizeTimeline 迁移：旧工程无 textClips → []', () => {
    const legacy = { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [] }
    expect(normalizeTimeline(legacy).textClips).toEqual([])
  })

  it('normalizeTimeline 读回并清洗 textClips', () => {
    const persisted = {
      version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [],
      textClips: [
        { id: 'a', text: '甲', style: 'title', startFrame: 50, endFrame: 80 },
        { id: 'b', text: '乙', style: 'caption', startFrame: 0, endFrame: 30 },
        { id: '', text: 'x', style: 'caption', startFrame: 0, endFrame: 10 }, // 无 id 丢弃
      ],
    }
    const out = normalizeTimeline(persisted).textClips
    expect(out.map((c) => c.id)).toEqual(['b', 'a']) // 按 startFrame 排序，无 id 被丢
  })
})
