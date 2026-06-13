import { describe, expect, it } from 'vitest'
import { resolveGenerationReferences } from './generationReferenceResolver'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, kind: string, url?: string): GenerationCanvasNode {
  return {
    id,
    kind: kind as GenerationCanvasNode['kind'],
    title: id,
    prompt: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...(url ? { result: { type: kind === 'video' ? 'video' : 'image', url } } : {}),
  } as GenerationCanvasNode
}

describe('resolveGenerationReferences — T5 尾帧接力分流', () => {
  it('first_frame 边的源是 image → 现行为：firstFrameUrl = 该图', () => {
    const kf = node('kf1', 'image', 'https://cdn/keyframe.png')
    const video = node('v1', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'kf1', target: 'v1', mode: 'first_frame' }]
    const refs = resolveGenerationReferences(video, { nodes: [kf, video], edges })
    expect(refs.firstFrameUrl).toBe('https://cdn/keyframe.png')
    expect(refs.relayFromVideoUrl).toBeUndefined()
  })

  it('first_frame 边的源是 video → 尾帧接力：标记 relayFromVideoUrl，绝不拿视频当首帧', () => {
    const prevVideo = node('v1', 'video', 'nomi-local://asset/p/v1.mp4')
    const nextVideo = node('v2', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'v1', target: 'v2', mode: 'first_frame' }]
    const refs = resolveGenerationReferences(nextVideo, { nodes: [prevVideo, nextVideo], edges })
    // 封死「用视频/封面冒充首帧」：firstFrameUrl 不被源视频污染
    expect(refs.firstFrameUrl).toBeUndefined()
    expect(refs.relayFromVideoUrl).toBe('nomi-local://asset/p/v1.mp4')
  })

  it('nomi-local:// 资源 URL 被放行（抽帧 IPC 返回值不再被丢弃）', () => {
    const kf = node('kf1', 'image', 'nomi-local://asset/p/frame.png')
    const video = node('v1', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'kf1', target: 'v1', mode: 'first_frame' }]
    const refs = resolveGenerationReferences(video, { nodes: [kf, video], edges })
    expect(refs.firstFrameUrl).toBe('nomi-local://asset/p/frame.png')
  })
})
