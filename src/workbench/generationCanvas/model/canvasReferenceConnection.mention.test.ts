// @ 的落槽规则（resolveMentionReference）：@ 只有「参考」一种意思，永远不建首帧 / 尾帧边。
// 模式 id 从内置档案里现找（有首帧、无参考视频的「图生视频」类 / 有参考视频的「全能参考」类），不写死字符串。
import { describe, expect, it } from 'vitest'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { resolveMentionReference } from './canvasReferenceConnection'
import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'

function videoNode(id: string, modeId = ''): GenerationCanvasNode {
  return {
    id, kind: 'video', title: id, prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    meta: { archetype: { id: 'seedance-2', modeId } },
  } as GenerationCanvasNode
}
function sourceWithResult(id: string, kind: 'video' | 'image'): GenerationCanvasNode {
  return {
    id, kind, title: id, prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    result: { id: `r-${id}`, type: kind, url: `nomi-local://asset/p/${id}.${kind === 'video' ? 'mp4' : 'png'}`, createdAt: 0 },
  } as GenerationCanvasNode
}
const archetype = archetypeForNode(videoNode('probe'))!
const frameOnlyMode = archetype.modes.find((mode) =>
  mode.slots.some((slot) => slot.kind === 'first_frame') && !mode.slots.some((slot) => slot.kind === 'video_ref'))!
const videoRefMode = archetype.modes.find((mode) => mode.slots.some((slot) => slot.kind === 'video_ref'))!

describe('resolveMentionReference', () => {
  it('the archetype under test has both a frame-only mode and a video-reference mode', () => {
    expect(frameOnlyMode).toBeTruthy()
    expect(videoRefMode).toBeTruthy()
  })

  it('@ a video in a frame-only mode switches to a mode with a video reference slot and never builds a frame edge', () => {
    const target = videoNode('t', frameOnlyMode.id)
    const route = resolveMentionReference(target, [target], [], 'video')
    expect(route.ok).toBe(true)
    if (!route.ok) return
    expect(route.edgeMode).toBe('reference')
    const switched = archetype.modes.find((mode) => mode.id === route.switchToModeId)
    expect(switched?.slots.some((slot) => slot.kind === 'video_ref')).toBe(true)
  })

  it('does not switch modes when the node already has first / last frame inputs', () => {
    const target = videoNode('t', frameOnlyMode.id)
    const frame = sourceWithResult('f', 'image')
    const edges = [{ id: 'e1', source: 'f', target: 't', mode: 'first_frame' }] as GenerationCanvasEdge[]
    expect(resolveMentionReference(target, [target, frame], edges, 'video')).toEqual({ ok: false, reason: 'blocked_by_frame_edges' })
  })

  it('stays in the current mode when it already has the reference slot', () => {
    const target = videoNode('t', videoRefMode.id)
    const route = resolveMentionReference(target, [target], [], 'video')
    expect(route).toMatchObject({ ok: true, switchToModeId: null, edgeMode: 'reference' })
  })

  it('reports the limit instead of adding when the reference slot is full', () => {
    const target = videoNode('t', videoRefMode.id)
    const max = videoRefMode.slots.find((slot) => slot.kind === 'video_ref')?.max
    if (max === undefined) return
    const sources = Array.from({ length: max }, (_, index) => sourceWithResult(`v${index}`, 'video'))
    const edges = sources.map((source, index) => ({ id: `e${index}`, source: source.id, target: 't', mode: 'reference' })) as GenerationCanvasEdge[]
    expect(resolveMentionReference(target, [target, ...sources], edges, 'video')).toEqual({ ok: false, reason: 'full', max })
  })

  it('a node without a model archetype gets a plain reference edge', () => {
    const target = { ...videoNode('t'), meta: {} } as GenerationCanvasNode
    expect(resolveMentionReference(target, [target], [], 'image')).toEqual({ ok: true, switchToModeId: null, edgeMode: 'reference' })
  })
})
