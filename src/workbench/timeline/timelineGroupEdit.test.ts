import { describe, it, expect } from 'vitest'
import type { TimelineClip, TimelineState } from './timelineTypes'
import { clampGroupDelta, applyClipStartFrames, removeClipsByIds, removeClipsBySourceNodeIds, type ClipOrigin } from './timelineEdit'

function clip(id: string, start: number, end: number, type: TimelineClip['type'] = 'image'): TimelineClip {
  return {
    id, type, sourceNodeId: `node-${id}`, label: id,
    startFrame: start, endFrame: end, frameCount: end - start,
    offsetStartFrame: 0, offsetEndFrame: 0,
  }
}

function timeline(imageClips: TimelineClip[], videoClips: TimelineClip[] = []): TimelineState {
  return {
    version: 1, fps: 30, scale: 1, playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: imageClips },
      { id: 'videoTrack', type: 'video', label: '媒体轨', clips: videoClips },
    ],
  }
}

const origin = (c: TimelineClip): ClipOrigin => ({ id: c.id, startFrame: c.startFrame, endFrame: c.endFrame })

describe('clampGroupDelta', () => {
  it('无非选中阻挡时，正向 delta 原样通过', () => {
    const a = clip('a', 0, 30)
    const t = timeline([a])
    expect(clampGroupDelta(t, [origin(a)], 50)).toBe(50)
  })

  it('夹住正向位移，使选中不越过右侧非选中 clip', () => {
    const a = clip('a', 0, 30)
    const b = clip('b', 60, 90) // 非选中，在右侧
    const t = timeline([a, b])
    // a 想右移 100，但 b.start=60，a.end=30 → 最多 +30 顶到 b
    expect(clampGroupDelta(t, [origin(a)], 100)).toBe(30)
  })

  it('夹住负向位移，不越过 0 也不压非选中左邻', () => {
    const a = clip('a', 50, 80)
    const t = timeline([a])
    expect(clampGroupDelta(t, [origin(a)], -100)).toBe(-50) // 顶到 0
  })

  it('成组：取所有成员中最紧的边界', () => {
    const a = clip('a', 0, 30)
    const b = clip('b', 40, 70)
    const blocker = clip('x', 80, 100) // 非选中
    const t = timeline([a, b, blocker])
    // 组 {a,b} 右移：b.end=70，blocker.start=80 → b 最多 +10
    expect(clampGroupDelta(t, [origin(a), origin(b)], 100)).toBe(10)
  })
})

describe('applyClipStartFrames', () => {
  it('把多个 clip 设到绝对起点并保持可见时长', () => {
    const a = clip('a', 0, 30)
    const b = clip('b', 40, 100, 'video')
    const t = timeline([a], [b])
    const next = applyClipStartFrames(t, { a: 10, b: 50 })
    const na = next.tracks[0].clips.find((c) => c.id === 'a')!
    const nb = next.tracks[1].clips.find((c) => c.id === 'b')!
    expect([na.startFrame, na.endFrame]).toEqual([10, 40])   // 时长 30 不变
    expect([nb.startFrame, nb.endFrame]).toEqual([50, 110])  // 时长 60 不变
  })

  it('空 positions 原样返回（引用不变）', () => {
    const t = timeline([clip('a', 0, 30)])
    expect(applyClipStartFrames(t, {})).toBe(t)
  })
})

describe('removeClipsByIds', () => {
  it('批量删除多个 clip（跨轨）', () => {
    const t = timeline([clip('a', 0, 30), clip('b', 40, 70)], [clip('c', 0, 50, 'video')])
    const next = removeClipsByIds(t, ['a', 'c'])
    expect(next.tracks[0].clips.map((c) => c.id)).toEqual(['b'])
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual([])
  })

  it('空 ids 原样返回（引用不变）', () => {
    const t = timeline([clip('a', 0, 30)])
    expect(removeClipsByIds(t, [])).toBe(t)
  })
})

describe('removeClipsBySourceNodeIds', () => {
  // clip() 的 sourceNodeId = node-<id>，据此构造删节点对账场景
  it('删画布节点 → 移除时间轴上所有引用该 sourceNodeId 的 clip（跨轨、含同节点多产物）', () => {
    const keep = clip('keep', 0, 30) // sourceNodeId=node-keep
    // 同一节点 node-x 的两段产物，分别落图片轨/媒体轨
    const xImg = { ...clip('x-img', 40, 70), sourceNodeId: 'node-x' }
    const xVid = { ...clip('x-vid', 0, 50, 'video'), sourceNodeId: 'node-x' }
    const t = timeline([keep, xImg], [xVid])
    const next = removeClipsBySourceNodeIds(t, ['node-x'])
    expect(next.tracks[0].clips.map((c) => c.id)).toEqual(['keep'])
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual([])
  })

  it('批量删多个节点', () => {
    const a = { ...clip('a', 0, 30), sourceNodeId: 'node-a' }
    const b = { ...clip('b', 40, 70), sourceNodeId: 'node-b' }
    const c = { ...clip('c', 80, 110), sourceNodeId: 'node-c' }
    const t = timeline([a, b, c])
    const next = removeClipsBySourceNodeIds(t, ['node-a', 'node-c'])
    expect(next.tracks[0].clips.map((cl) => cl.id)).toEqual(['b'])
  })

  it('无匹配节点时原样返回（引用不变，store 据此跳过 persistRevision 自增）', () => {
    const t = timeline([clip('a', 0, 30)])
    expect(removeClipsBySourceNodeIds(t, ['node-missing'])).toBe(t)
  })

  it('空 nodeIds 原样返回（引用不变）', () => {
    const t = timeline([clip('a', 0, 30)])
    expect(removeClipsBySourceNodeIds(t, [])).toBe(t)
  })
})
