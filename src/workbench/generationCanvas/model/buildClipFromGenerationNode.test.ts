import { describe, it, expect } from 'vitest'
import { buildClipFromGenerationNode, applyRegeneratedResultToClip } from './buildClipFromGenerationNode'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import type { TimelineClip } from '../../timeline/timelineTypes'

function makeNode(result: Partial<GenerationNodeResult> | null): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: '开场镜头',
    position: { x: 0, y: 0 },
    status: 'idle',
    result: result
      ? { id: 'r1', type: 'image', createdAt: 1, ...result }
      : undefined,
  }
}

describe('buildClipFromGenerationNode URL 口径（providerUrl 优先）', () => {
  it('只有 providerUrl（url/thumbnail 都空）也能成 clip——这是修复前会被静默丢的坑', () => {
    const clip = buildClipFromGenerationNode(makeNode({ providerUrl: 'https://cdn.example.com/a.png' }))
    expect(clip).not.toBeNull()
    expect(clip?.url).toBe('https://cdn.example.com/a.png')
  })

  it('providerUrl 优先于 url', () => {
    const clip = buildClipFromGenerationNode(
      makeNode({ providerUrl: 'https://cdn.example.com/a.png', url: 'nomi-local://a.png' }),
    )
    expect(clip?.url).toBe('https://cdn.example.com/a.png')
  })

  it('无 providerUrl 时退回 url', () => {
    const clip = buildClipFromGenerationNode(makeNode({ url: 'nomi-local://a.png' }))
    expect(clip?.url).toBe('nomi-local://a.png')
  })

  it('三者皆空 → null（无可用产物不允许成 clip）', () => {
    expect(buildClipFromGenerationNode(makeNode({}))).toBeNull()
    expect(buildClipFromGenerationNode(makeNode(null))).toBeNull()
  })
})

describe('buildClipFromGenerationNode 视频时长真相序（修「拖入视频一律 5 秒」）', () => {
  function videoNode(over: { result?: Partial<GenerationNodeResult>; meta?: Record<string, unknown> }): GenerationCanvasNode {
    return {
      id: 'node-v',
      kind: 'video',
      title: '一个视频',
      position: { x: 0, y: 0 },
      status: 'idle',
      result: { id: 'rv', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1, ...over.result },
      ...(over.meta ? { meta: over.meta } : {}),
    }
  }

  it('无 result.durationSeconds 但有 meta.videoDuration → 用真实时长（不再钉死 5 秒）', () => {
    const clip = buildClipFromGenerationNode(videoNode({ meta: { videoDuration: 12 } }), { fps: 30 })
    expect(clip?.frameCount).toBe(360) // 12s * 30fps
  })

  it('result.durationSeconds 优先于 meta.videoDuration', () => {
    const clip = buildClipFromGenerationNode(videoNode({ result: { durationSeconds: 8 }, meta: { videoDuration: 12 } }), { fps: 30 })
    expect(clip?.frameCount).toBe(240) // 8s * 30fps
  })

  it('两者皆无 → 回退默认 5 秒', () => {
    const clip = buildClipFromGenerationNode(videoNode({}), { fps: 30 })
    expect(clip?.frameCount).toBe(150) // 5s * 30fps
  })
})

function videoClip(over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    type: 'video',
    sourceNodeId: 'node-1',
    label: '镜头',
    startFrame: 10,
    endFrame: 160,
    frameCount: 150,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    ...over,
  }
}
function result(over: Partial<GenerationNodeResult>): GenerationNodeResult {
  return { id: 'r2', type: 'video', createdAt: 2, ...over }
}

describe('applyRegeneratedResultToClip 回填（位置不变 + trim 越界夹取）', () => {
  it('image clip 只换 URL，时长/位置/offset 不动', () => {
    const clip = videoClip({ type: 'image', frameCount: 90, endFrame: 100, startFrame: 10 })
    const next = applyRegeneratedResultToClip(clip, result({ type: 'image', providerUrl: 'https://cdn/x.png' }), 30)
    expect(next.url).toBe('https://cdn/x.png')
    expect(next.frameCount).toBe(90)
    expect(next.startFrame).toBe(10)
    expect(next.endFrame).toBe(100)
  })

  it('video 变短：frameCount 缩、endFrame 重算、startFrame 不变', () => {
    const next = applyRegeneratedResultToClip(videoClip(), result({ providerUrl: 'https://cdn/v.mp4', durationSeconds: 3 }), 30)
    expect(next.frameCount).toBe(90)
    expect(next.startFrame).toBe(10)
    expect(next.endFrame).toBe(100) // 10 + 90
  })

  it('video 变长：endFrame 跟着长，startFrame 不变', () => {
    const next = applyRegeneratedResultToClip(videoClip(), result({ providerUrl: 'https://cdn/v.mp4', durationSeconds: 8 }), 30)
    expect(next.frameCount).toBe(240)
    expect(next.endFrame).toBe(250) // 10 + 240
  })

  it('video 越界：旧 offset 大于新时长 → 夹到至少可见 1 帧', () => {
    const clip = videoClip({ offsetStartFrame: 30, offsetEndFrame: 30, endFrame: 100 }) // 旧可见 90
    const next = applyRegeneratedResultToClip(clip, result({ providerUrl: 'https://cdn/v.mp4', durationSeconds: 2 }), 30) // 新 60 帧
    expect(next.frameCount).toBe(60)
    expect(next.offsetStartFrame).toBe(30)
    expect(next.offsetEndFrame).toBe(29) // min(30, 60-30-1)
    expect(next.endFrame - next.startFrame).toBeGreaterThanOrEqual(1)
    expect(next.startFrame).toBe(10)
  })

  it('无可用产物 → 原样返回', () => {
    const clip = videoClip()
    expect(applyRegeneratedResultToClip(clip, result({}), 30)).toBe(clip)
  })
})
