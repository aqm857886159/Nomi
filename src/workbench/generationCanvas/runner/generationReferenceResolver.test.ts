import { describe, expect, it } from 'vitest'
import { resolveGenerationReferences } from './generationReferenceResolver'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, kind: string, url?: string): GenerationCanvasNode {
  return {
    id,
    kind: kind as GenerationCanvasNode['kind'],
    title: id,
    prompt: '',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    ...(url ? { result: { id: `r-${id}`, type: kind === 'video' ? 'video' : 'image', url, createdAt: 0 } } : {}),
  }
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

  it('导入的**视频素材**(kind=asset,result.type=video)经 first_frame 边 → 也标 relayFromVideoUrl（按 result.type 判，不按 node.kind）', () => {
    // kind='asset' 图/视频同种类，按 node.kind==='video' 会漏判 → 把视频 URL 当首帧发。referenceAssetKindForNode
    // 看 result.type → video → 接力。与显示侧 referenceSlots 的 pending-extraction 同一口径。
    const videoAsset = {
      id: 'v1', kind: 'asset', title: 'v1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      result: { type: 'video', url: 'nomi-local://asset/p/tom.mp4' },
    } as unknown as GenerationCanvasNode
    const nextVideo = node('v2', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'v1', target: 'v2', mode: 'first_frame' }]
    const refs = resolveGenerationReferences(nextVideo, { nodes: [videoAsset, nextVideo], edges })
    expect(refs.firstFrameUrl).toBeUndefined()
    expect(refs.relayFromVideoUrl).toBe('nomi-local://asset/p/tom.mp4')
    expect(refs.referenceImages).toEqual([])
    expect(refs.referenceVideos).toEqual([]) // 不当参考视频，是首帧接力源
  })

  it('导入的**视频素材**经**通用 reference 边**连 first-frame-only i2v(hailuo) → 首帧接力，不当参考视频丢掉（治「永远待抽帧、发不出」陷阱）', () => {
    // 手动拖连给的是 reference 边。目标 hailuo i2v 只有 first_frame 槽（无 video_ref）→ 视频只能当首帧接力。
    // 修前：reference 分支把视频推进 referenceImages→分流进 referenceVideos→模型无 video_ref 槽丢弃，
    // 但显示侧已显示 pending-extraction → 永远待抽帧、发不出。修后：发送侧也接力，两侧一致。
    const videoAsset = {
      id: 'v1', kind: 'asset', title: 'v1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      result: { type: 'video', url: 'nomi-local://asset/p/tom.mp4' },
    } as unknown as GenerationCanvasNode
    const tgt = {
      id: 't1', kind: 'video', title: 't1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      meta: { archetype: { id: 'hailuo-2.3', modeId: 'i2v' } },
    } as unknown as GenerationCanvasNode
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'v1', target: 't1', mode: 'reference' }]
    const refs = resolveGenerationReferences(tgt, { nodes: [videoAsset, tgt], edges })
    expect(refs.relayFromVideoUrl).toBe('nomi-local://asset/p/tom.mp4')
    expect(refs.firstFrameUrl).toBeUndefined()
    expect(refs.referenceVideos).toEqual([])
    expect(refs.referenceImages).toEqual([])
  })

  it('导入的**视频素材**经 reference 边连有 video_ref 槽的模型(Seedance 全能参考) → 仍当参考视频，不接力', () => {
    // 回归护栏：有专门参考视频槽的模型，视频该进 referenceVideos（video_ref），不能误判成首帧接力。
    const videoAsset = {
      id: 'v1', kind: 'asset', title: 'v1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      result: { type: 'video', url: 'nomi-local://asset/p/tom.mp4' },
    } as unknown as GenerationCanvasNode
    const tgt = {
      id: 't1', kind: 'video', title: 't1', prompt: '', x: 0, y: 0, width: 100, height: 100,
      meta: { archetype: { id: 'dreamina-seedance-2', modeId: 'multimodal' } },
    } as unknown as GenerationCanvasNode
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'v1', target: 't1', mode: 'reference' }]
    const refs = resolveGenerationReferences(tgt, { nodes: [videoAsset, tgt], edges })
    expect(refs.referenceVideos).toEqual(['nomi-local://asset/p/tom.mp4'])
    expect(refs.relayFromVideoUrl).toBeUndefined()
    expect(refs.referenceImages).toEqual([])
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
  // image_urls 空 → 模型纯文生出无关内容。修后直接参考边也统一读 referenceUrl，两侧一致。
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

describe('resolveGenerationReferences — 图生图链只取直接参考，不递归串入祖先', () => {
  it('A → B → C：C 只收到直接相连的 B，不把祖先 A 塞进参考数组', () => {
    const a = node('a', 'image', 'https://cdn/a.png')
    const b = node('b', 'image', 'https://cdn/b.png')
    const c = node('c', 'image')
    const edges: GenerationCanvasEdge[] = [
      { id: 'ab', source: 'a', target: 'b', mode: 'reference', order: 0 },
      { id: 'bc', source: 'b', target: 'c', mode: 'reference', order: 0 },
    ]
    expect(resolveGenerationReferences(c, { nodes: [a, b, c], edges }).referenceImages)
      .toEqual(['https://cdn/b.png'])
  })

  it('多条直接参考边仍严格按 edge.order 排序', () => {
    const a = node('a', 'image', 'https://cdn/a.png')
    const b = node('b', 'image', 'https://cdn/b.png')
    const c = node('c', 'image')
    const edges: GenerationCanvasEdge[] = [
      { id: 'bc', source: 'b', target: 'c', mode: 'reference', order: 1 },
      { id: 'ac', source: 'a', target: 'c', mode: 'reference', order: 0 },
    ]
    expect(resolveGenerationReferences(c, { nodes: [a, b, c], edges }).referenceImages)
      .toEqual(['https://cdn/a.png', 'https://cdn/b.png'])
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

/**
 * 落盘失败退回 base64 的兜底图（persistNodeImage：可持久化、不丢图）连线当参考。
 * 修前：asUrl 判空 → 参考被静默丢掉 → L3 反过来说「你没连参考」（把原因说反了），
 * 或按纯文生跑照样扣费。修后：内联字节照常成为参考，出站前由主进程物化上传。
 */
describe('resolveGenerationReferences — base64 兜底图也能当参考', () => {
  const inlineImage = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64')}`

  it('reference 边的源只有内联 base64 → 进 referenceImages', () => {
    const source = node('c1', 'image', inlineImage)
    const target = node('g1', 'image')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'c1', target: 'g1', mode: 'reference' }]
    const refs = resolveGenerationReferences(target, { nodes: [source, target], edges })
    expect(refs.referenceImages).toEqual([inlineImage])
  })

  it('first_frame 边的源只有内联 base64 → 进 firstFrameUrl', () => {
    const source = node('c1', 'image', inlineImage)
    const target = node('v1', 'video')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'c1', target: 'v1', mode: 'first_frame' }]
    const refs = resolveGenerationReferences(target, { nodes: [source, target], edges })
    expect(refs.firstFrameUrl).toBe(inlineImage)
  })
})
