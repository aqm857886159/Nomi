import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, normalizeTimeline, resolveActiveTextClipsAtFrame, computeTimelineDuration } from './timelineMath'
import { addTextClip, moveTextClip, removeTextClip, resizeTextClip, updateTextClipText, updateTextClipTransform, updateTextClipFont } from './timelineTextEdit'
import { resolveTextBox } from './textLayout'
import { resolveFontStack, normalizeTextFontId } from './textFonts'

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

  it('新建 clip id 不与「落盘旧 clip」相撞，编辑互不串改（回归：id 自增归零撞 id）', () => {
    // 真机复现：旧会话存的字幕 clip 反序列化进来，新建一条字幕。两者 id 必须不同，
    // 否则 updateTextClipText 会同时改两条。这里连续新建多条，断言全唯一。
    let tl = createDefaultTimeline()
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const r = addTextClip(tl, 'caption', i * 100)
      tl = r.timeline
      ids.push(r.id)
    }
    expect(new Set(ids).size).toBe(ids.length) // 全唯一
    // 改第一条不应波及其它
    const edited = updateTextClipText(tl, ids[0], '只改第一条')
    const hits = edited.textClips.filter((c) => c.text === '只改第一条')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(ids[0])
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

  it('updateTextClipTransform 写 position(夹画面内)/scale(夹合法区)', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 0)
    const moved = updateTextClipTransform(timeline, id, { position: { x: 1.4, y: -0.2 }, scale: 99 })
    expect(moved.textClips[0].position).toEqual({ x: 1, y: 0 })
    expect(moved.textClips[0].scale).toBe(5) // SCALE_MAX
    // 无 patch 返回同引用
    expect(updateTextClipTransform(timeline, id, {})).toBe(timeline)
  })

  it('resolveTextBox 默认用 style 预设中心，position 覆盖，scale 放大字号', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 0)
    const clip = timeline.textClips[0]
    const base = resolveTextBox(clip, 1000, 1000)
    expect(base.centerX).toBe(500)        // 预设 x=0.5
    expect(base.centerY).toBe(860)        // caption 预设 y=0.86
    const moved = resolveTextBox({ ...clip, position: { x: 0.2, y: 0.3 }, scale: 2 }, 1000, 1000)
    expect(moved.centerX).toBe(200)
    expect(moved.centerY).toBe(300)
    expect(moved.fontSizePx).toBe(base.fontSizePx * 2) // scale 翻倍字号翻倍
  })

  it('updateTextClipFont 换字体 + resolveTextBox 反映字体栈', () => {
    const { timeline, id } = addTextClip(createDefaultTimeline(), 'caption', 0)
    const defaultStack = resolveTextBox(timeline.textClips[0], 1000, 1000).fontFamily
    const next = updateTextClipFont(timeline, id, 'songti')
    expect(next.textClips[0].fontFamily).toBe('songti')
    const songtiStack = resolveTextBox(next.textClips[0], 1000, 1000).fontFamily
    expect(songtiStack).toContain('Songti')
    expect(songtiStack).not.toBe(defaultStack)
    expect(updateTextClipFont(next, id, 'songti')).toBe(next) // 同值无变化返回同引用
  })

  it('字体 id 兜底：未知 id → 默认栈', () => {
    expect(normalizeTextFontId('songti')).toBe('songti')
    expect(normalizeTextFontId('不存在')).toBeUndefined()
    expect(resolveFontStack(undefined)).toBe(resolveFontStack('default'))
    expect(resolveFontStack('乱写')).toBe(resolveFontStack('default'))
  })

  it('normalizeTimeline 迁移 fontFamily', () => {
    const persisted = { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [],
      textClips: [{ id: 'a', text: 'x', style: 'caption', startFrame: 0, endFrame: 30, fontFamily: 'kaiti' }] }
    expect(normalizeTimeline(persisted).textClips[0].fontFamily).toBe('kaiti')
  })

  it('normalizeTimeline 迁移 position/scale（旧 clip 无 → 缺省）', () => {
    const persisted = {
      version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [],
      textClips: [
        { id: 'a', text: '甲', style: 'title', startFrame: 0, endFrame: 30, position: { x: 0.2, y: 0.8 }, scale: 1.5 },
        { id: 'b', text: '乙', style: 'caption', startFrame: 0, endFrame: 30 }, // 无变换
      ],
    }
    const out = normalizeTimeline(persisted).textClips
    expect(out.find((c) => c.id === 'a')?.position).toEqual({ x: 0.2, y: 0.8 })
    expect(out.find((c) => c.id === 'a')?.scale).toBe(1.5)
    expect(out.find((c) => c.id === 'b')?.position).toBeUndefined()
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
