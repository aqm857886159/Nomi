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

describe('resolveGenerationReferences — URL 优先级一致（#4 根因：providerUrl 图生成侧不能丢）', () => {
  // 只有 providerUrl（公网 CDN）、无 result.url 的上游图（很多生成图就是这形态）：
  // 显示侧（referenceUrl.resultUrl）读 providerUrl 能显示；生成侧若不读 providerUrl 会静默丢 →
  // image_urls 空 → 模型纯文生出无关内容。修后 collectNodeContext 也优先 providerUrl，两侧一致。
  it('源图只有 providerUrl（无 result.url）→ 经任意边进 referenceImages（不再静默丢）', () => {
    const img = {
      id: 'img1', kind: 'image', title: 'img1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      result: { type: 'image', providerUrl: 'https://cdn/provider-only.png' },
    } as unknown as GenerationCanvasNode
    const video = node('v1', 'video')
    const edge = { id: 'e1', source: 'img1', target: 'v1', mode: 'reference' } as unknown as GenerationCanvasEdge
    const refs = resolveGenerationReferences(video, { nodes: [img, video], edges: [edge] })
    expect(refs.referenceImages).toContain('https://cdn/provider-only.png')
  })
})

describe('B4 — 连线视频/音频参考分流（不漏进 referenceImages / 不冒充首帧）', () => {
  it('视频源 reference 边 → 进 referenceVideos，不进 referenceImages、不当首帧', () => {
    const refVid = node('rv1', 'video', 'https://cdn/ref.mp4')
    const target = node('t1', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'rv1', target: 't1', mode: 'reference' }]
    const refs = resolveGenerationReferences(target, { nodes: [refVid, target], edges })
    expect(refs.referenceVideos).toEqual(['https://cdn/ref.mp4'])
    expect(refs.referenceImages).toEqual([]) // 不再把 mp4 当图片参考
    expect(refs.firstFrameUrl).toBeUndefined() // 不再拿视频冒充首帧
  })

  it('图片源仍进 referenceImages（视频分流不误伤图片）', () => {
    const img = node('i1', 'image', 'https://cdn/a.png')
    const target = node('t1', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'i1', target: 't1', mode: 'reference' }]
    const refs = resolveGenerationReferences(target, { nodes: [img, target], edges })
    expect(refs.referenceImages).toEqual(['https://cdn/a.png'])
    expect(refs.referenceVideos).toEqual([])
  })
})
