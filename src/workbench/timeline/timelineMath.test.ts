import { describe, it, expect } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTrack } from './timelineTypes'
import {
  normalizeTimeline,
  createDefaultTimeline,
  computeTimelineDuration,
  resolveActiveClipsAtFrame,
  hasClipOverlap,
  findAppendFrame,
} from './timelineMath'

// 构造一个合法 TimelineClip（喂给纯数学函数；这些函数收 trusted state）
function clip(
  id: string,
  start: number,
  end: number,
  type: TimelineClip['type'] = 'image',
): TimelineClip {
  return {
    id, type, sourceNodeId: `node-${id}`, label: id,
    startFrame: start, endFrame: end, frameCount: end - start,
    offsetStartFrame: 0, offsetEndFrame: 0,
  }
}

function track(type: TimelineTrack['type'], clips: TimelineClip[]): TimelineTrack {
  return type === 'image'
    ? { id: 'imageTrack', type: 'image', label: '图片轨', clips }
    : { id: 'videoTrack', type: 'video', label: '媒体轨', clips }
}

function timelineState(imageClips: TimelineClip[], videoClips: TimelineClip[] = []): TimelineState {
  return {
    version: 1, fps: 30, scale: 1, playheadFrame: 0,
    tracks: [track('image', imageClips), track('video', videoClips)],
  }
}

// normalizeTimeline 收 unknown，测试直接喂「未受信原始对象」
function videoTrackClips(timeline: TimelineState): TimelineClip[] {
  return timeline.tracks.find((t) => t.type === 'video')!.clips
}

describe('normalizeTimeline — video/audio 裁剪不变量（回归）', () => {
  // video/audio 的 frameCount 是素材全长，可见窗口 = endFrame - startFrame 可小于它。
  // 旧 normalizeClip 用 Math.max(endFrame, startFrame + frameCount) 会把可见 endFrame
  // 撑回素材全长，导致裁剪/分割过的 clip 在存→读后膨胀、压住相邻 clip。
  it('裁剪过的 video clip 经 normalize 后 endFrame 不被 frameCount 撑大', () => {
    const input = {
      tracks: [
        {
          id: 'videoTrack', type: 'video',
          clips: [
            { id: 'c1', sourceNodeId: 'n1', type: 'video', startFrame: 10, endFrame: 40, frameCount: 100, offsetStartFrame: 20, offsetEndFrame: 50 },
          ],
        },
      ],
    }
    const c1 = videoTrackClips(normalizeTimeline(input)).find((c) => c.id === 'c1')!
    expect(c1.endFrame).toBe(40)        // 旧代码会算成 110
    expect(c1.frameCount).toBe(100)     // 素材全长原样保留
    expect(c1.offsetStartFrame).toBe(20)
    expect(c1.offsetEndFrame).toBe(50)
  })

  it('image clip（frameCount == 可见窗口）endFrame 不变', () => {
    const input = { tracks: [{ id: 'imageTrack', type: 'image', clips: [
      { id: 'i1', sourceNodeId: 'n', type: 'image', startFrame: 0, endFrame: 90, frameCount: 90 },
    ] }] }
    const i1 = normalizeTimeline(input).tracks.find((t) => t.type === 'image')!.clips[0]
    expect(i1.endFrame).toBe(90)
    expect(i1.frameCount).toBe(90)
  })

  it('未裁剪 video（frameCount == 可见窗口）endFrame 不变', () => {
    const input = { tracks: [{ id: 'videoTrack', type: 'video', clips: [
      { id: 'v1', sourceNodeId: 'n', type: 'video', startFrame: 0, endFrame: 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0 },
    ] }] }
    const v1 = videoTrackClips(normalizeTimeline(input))[0]
    expect(v1.endFrame).toBe(60)
    expect(v1.frameCount).toBe(60)
  })
})

describe('normalizeTimeline — 归一化与清洗', () => {
  it('非对象输入回退到默认时间轴', () => {
    expect(normalizeTimeline(null)).toEqual(createDefaultTimeline())
    expect(normalizeTimeline('garbage')).toEqual(createDefaultTimeline())
    expect(normalizeTimeline(42)).toEqual(createDefaultTimeline())
  })

  it('重复 id 的文字 clip 加载时重铸成唯一 id（自愈已损坏工程）', () => {
    const input = { textClips: [
      { id: 'text-1-abc', style: 'caption', text: '甲', startFrame: 0, endFrame: 90 },
      { id: 'text-1-abc', style: 'caption', text: '乙', startFrame: 100, endFrame: 190 },
    ] }
    const out = normalizeTimeline(input)
    expect(out.textClips).toHaveLength(2)
    const ids = out.textClips.map((c) => c.id)
    expect(new Set(ids).size).toBe(2) // 不再重复
    // 两条文本各自保留，不被合并/串改
    expect(out.textClips.map((c) => c.text).sort()).toEqual(['乙', '甲'])
  })

  it('丢弃缺少 id 或 sourceNodeId 的 clip', () => {
    const input = { tracks: [{ id: 'videoTrack', type: 'video', clips: [
      { sourceNodeId: 'n', type: 'video', startFrame: 0, endFrame: 10 },     // 缺 id
      { id: 'no-src', type: 'video', startFrame: 0, endFrame: 10 },          // 缺 sourceNodeId
      { id: 'ok', sourceNodeId: 'n', type: 'video', startFrame: 0, endFrame: 10 },
    ] }] }
    expect(videoTrackClips(normalizeTimeline(input)).map((c) => c.id)).toEqual(['ok'])
  })

  it('startFrame 负数归零、浮点向下取整', () => {
    const input = { tracks: [{ id: 'videoTrack', type: 'video', clips: [
      { id: 'neg', sourceNodeId: 'n', type: 'video', startFrame: -5, endFrame: 10 },
      { id: 'frac', sourceNodeId: 'n', type: 'video', startFrame: 4.9, endFrame: 30 },
    ] }] }
    const byId = Object.fromEntries(videoTrackClips(normalizeTimeline(input)).map((c) => [c.id, c]))
    expect(byId.neg.startFrame).toBe(0)
    expect(byId.frac.startFrame).toBe(4)
  })

  it('同轨 clip 按 startFrame 升序排列', () => {
    const input = { tracks: [{ id: 'videoTrack', type: 'video', clips: [
      { id: 'b', sourceNodeId: 'n', type: 'video', startFrame: 50, endFrame: 60 },
      { id: 'a', sourceNodeId: 'n', type: 'video', startFrame: 10, endFrame: 20 },
    ] }] }
    expect(videoTrackClips(normalizeTimeline(input)).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('类型与轨道不匹配的 clip 被过滤', () => {
    const input = { tracks: [{ id: 'videoTrack', type: 'video', clips: [
      { id: 'img', sourceNodeId: 'n', type: 'image', startFrame: 0, endFrame: 10 },
    ] }] }
    expect(videoTrackClips(normalizeTimeline(input))).toEqual([])
  })
})

describe('normalizeTimeline — fps derive（不再钉死 30）', () => {
  it('携带合法 fps 时按输入 derive，不被抹成 30', () => {
    expect(normalizeTimeline({ fps: 24, tracks: [] }).fps).toBe(24)
    expect(normalizeTimeline({ fps: 60, tracks: [] }).fps).toBe(60)
    expect(normalizeTimeline({ fps: 23.976, tracks: [] }).fps).toBe(23.976)
  })

  it('缺省/非法/非正 fps 回退默认 30', () => {
    expect(normalizeTimeline({ tracks: [] }).fps).toBe(30)
    expect(normalizeTimeline({ fps: 0, tracks: [] }).fps).toBe(30)
    expect(normalizeTimeline({ fps: -5, tracks: [] }).fps).toBe(30)
    expect(normalizeTimeline({ fps: Number.NaN, tracks: [] }).fps).toBe(30)
    expect(normalizeTimeline({ fps: 'garbage', tracks: [] }).fps).toBe(30)
  })

  it('字符串数字 fps 被接受（持久化兜底）', () => {
    expect(normalizeTimeline({ fps: '25', tracks: [] }).fps).toBe(25)
  })

  it('默认时间轴 fps 为 30', () => {
    expect(createDefaultTimeline().fps).toBe(30)
  })
})

describe('computeTimelineDuration', () => {
  it('取所有轨道 clip 的最大 endFrame', () => {
    const t = timelineState([clip('i', 0, 90)], [clip('v', 0, 40, 'video')])
    expect(computeTimelineDuration(t)).toBe(90)
  })

  it('空时间轴时长为 0', () => {
    expect(computeTimelineDuration(createDefaultTimeline())).toBe(0)
  })

  it('末尾文字 clip（标题卡/字幕）撑出时长，取轨道与文字的最大 endFrame', () => {
    // 媒体轨最长 60，但片尾标题卡到 120 → 总时长应 120（而非 60）。
    const base = timelineState([clip('i', 0, 60)])
    const withTailTitle: TimelineState = {
      ...base,
      textClips: [{ id: 'tail', text: '完', style: 'title', startFrame: 90, endFrame: 120 }],
    }
    expect(computeTimelineDuration(withTailTitle)).toBe(120)
  })

  it('文字 clip 比媒体短时，时长仍取媒体轨最大值', () => {
    const base = timelineState([clip('i', 0, 150)])
    const withShortCaption: TimelineState = {
      ...base,
      textClips: [{ id: 'cap', text: 'hi', style: 'caption', startFrame: 0, endFrame: 30 }],
    }
    expect(computeTimelineDuration(withShortCaption)).toBe(150)
  })
})

describe('resolveActiveClipsAtFrame', () => {
  it('半开区间 [start, end)：命中 start 与 end-1，不命中 end', () => {
    const t = timelineState([clip('a', 0, 90)])
    expect(resolveActiveClipsAtFrame(t, 0).map((c) => c.id)).toEqual(['a'])
    expect(resolveActiveClipsAtFrame(t, 89).map((c) => c.id)).toEqual(['a'])
    expect(resolveActiveClipsAtFrame(t, 90)).toEqual([])
  })
})

describe('hasClipOverlap', () => {
  it('相邻 edge 不算重叠，真重叠算，忽略同 id', () => {
    const t = track('image', [clip('a', 0, 90)])
    expect(hasClipOverlap(t, clip('b', 90, 120))).toBe(false) // 相邻边界
    expect(hasClipOverlap(t, clip('b', 89, 100))).toBe(true)  // 重叠 1 帧
    expect(hasClipOverlap(t, clip('a', 0, 90))).toBe(false)   // 同 id 跳过自身
  })
})

describe('findAppendFrame', () => {
  it('空轨返回 0，否则返回最大 endFrame', () => {
    expect(findAppendFrame(track('image', []))).toBe(0)
    expect(findAppendFrame(track('image', [clip('a', 0, 30), clip('b', 40, 70)]))).toBe(70)
  })
})
