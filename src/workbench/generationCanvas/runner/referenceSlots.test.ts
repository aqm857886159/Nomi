import { describe, expect, it } from 'vitest'
import { resolveReferenceSlots, decideArrayReferenceRemoval, findOrphanArrayReferences } from './referenceSlots'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(
  id: string,
  kind: string,
  opts: { url?: string; archetypeId?: string; modeId?: string; meta?: Record<string, unknown> } = {},
): GenerationCanvasNode {
  const meta: Record<string, unknown> = { ...(opts.meta || {}) }
  if (opts.archetypeId) meta.archetype = { id: opts.archetypeId, modeId: opts.modeId || '' }
  return {
    id,
    kind: kind as GenerationCanvasNode['kind'],
    title: id,
    prompt: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    meta,
    ...(opts.url ? { result: { type: kind === 'video' ? 'video' : 'image', url: opts.url } } : {}),
  } as GenerationCanvasNode
}

function target(kind: string, archetypeId: string, modeId: string, meta?: Record<string, unknown>) {
  return node('tgt', kind, { archetypeId, modeId, meta })
}

describe('resolveReferenceSlots — 能力驱动单一真相源', () => {
  it('Sora i2v：image 源经 first_frame 边、源已生成 → image_ref 槽显示该参考（这正是「连线没用」要修的）', () => {
    const img = node('img1', 'image', { url: 'https://cdn/a.png' })
    const tgt = target('video', 'sora-2', 'i2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'img1', target: 'tgt', mode: 'first_frame' }]
    const slots = resolveReferenceSlots(tgt, [img, tgt], edges)
    expect(slots).toHaveLength(1)
    expect(slots[0].slotKind).toBe('image_ref')
    expect(slots[0].max).toBe(1)
    expect(slots[0].fills).toEqual([
      { position: 0, url: 'https://cdn/a.png', status: 'resolved', origin: { type: 'edge', sourceNodeId: 'img1', semantic: 'first_frame' } },
    ])
  })

  it('源还没生成 → 槽仍显示「已连接·待生成」(pending-generation, url=null)，不再显示为空', () => {
    const img = node('img1', 'image') // 无 result
    const tgt = target('video', 'sora-2', 'i2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'img1', target: 'tgt', mode: 'first_frame' }]
    const slots = resolveReferenceSlots(tgt, [img, tgt], edges)
    expect(slots[0].fills).toEqual([
      { position: 0, url: null, status: 'pending-generation', origin: { type: 'edge', sourceNodeId: 'img1', semantic: 'first_frame' } },
    ])
  })

  it('Kling i2v：first_frame 边→位置 0、last_frame 边→位置 1（有序，保首/尾帧语义）', () => {
    const a = node('a', 'image', { url: 'https://cdn/first.png' })
    const b = node('b', 'image', { url: 'https://cdn/last.png' })
    const tgt = target('video', 'kling-3.0', 'i2v')
    const edges: GenerationCanvasEdge[] = [
      { id: 'e2', source: 'b', target: 'tgt', mode: 'last_frame' },
      { id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame' },
    ]
    const slots = resolveReferenceSlots(tgt, [a, b, tgt], edges)
    expect(slots[0].slotKind).toBe('image_ref')
    expect(slots[0].max).toBe(2)
    expect(slots[0].fills).toEqual([
      { position: 0, url: 'https://cdn/first.png', status: 'resolved', origin: { type: 'edge', sourceNodeId: 'a', semantic: 'first_frame' } },
      { position: 1, url: 'https://cdn/last.png', status: 'resolved', origin: { type: 'edge', sourceNodeId: 'b', semantic: 'last_frame' } },
    ])
  })

  it('Hailuo i2v：video 源经 first_frame 边 → pending-extraction（待抽帧，绝不拿视频当首帧）', () => {
    const v = node('v1', 'video', { url: 'nomi-local://asset/p/v1.mp4' })
    const tgt = target('video', 'hailuo-2.3', 'i2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'v1', target: 'tgt', mode: 'first_frame' }]
    const slots = resolveReferenceSlots(tgt, [v, tgt], edges)
    expect(slots[0].slotKind).toBe('first_frame')
    expect(slots[0].fills).toEqual([
      { position: 0, url: null, status: 'pending-extraction', origin: { type: 'edge', sourceNodeId: 'v1', semantic: 'first_frame' } },
    ])
  })

  it('meta 上传（无源节点）也在槽里可见，origin=upload', () => {
    const tgt = target('video', 'sora-2', 'i2v', { referenceImageUrls: ['https://cdn/up.png'] })
    const slots = resolveReferenceSlots(tgt, [tgt], [])
    expect(slots[0].fills).toEqual([
      { position: 0, url: 'https://cdn/up.png', status: 'resolved', origin: { type: 'upload' } },
    ])
  })

  it('边 + 上传共存（Kling max2）：边占其首选位、上传填剩余空位', () => {
    const a = node('a', 'image', { url: 'https://cdn/edge.png' })
    const tgt = target('video', 'kling-3.0', 'i2v', { referenceImageUrls: ['https://cdn/upload.png'] })
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame' }]
    const slots = resolveReferenceSlots(tgt, [a, tgt], edges)
    expect(slots[0].fills).toEqual([
      { position: 0, url: 'https://cdn/edge.png', status: 'resolved', origin: { type: 'edge', sourceNodeId: 'a', semantic: 'first_frame' } },
      { position: 1, url: 'https://cdn/upload.png', status: 'resolved', origin: { type: 'upload' } },
    ])
  })

  it('过载槽（gpt-image-2 i2i max4）：3 条 pending 边 + 3 个上传 → fills 封顶 4（pending 边也占位），多出的上传落不下', () => {
    // 这是 2026-06-25「参考图上不去/连线连不上」的根因场景：被「连了但源未生成」的 pending 边占满位置，
    // 容量必须按 fills.length（含 pending）算——不能只数有 url 的显示图 / meta 数组长度，否则槽满了还放行。
    const s1 = node('s1', 'image'); const s2 = node('s2', 'image'); const s3 = node('s3', 'image') // 无 url = pending
    const tgt = target('image', 'gpt-image-2', 'i2i', { referenceImageUrls: ['https://cdn/u1.png', 'https://cdn/u2.png', 'https://cdn/u3.png'] })
    const edges: GenerationCanvasEdge[] = [
      { id: 'e1', source: 's1', target: 'tgt', mode: 'reference', order: 0 },
      { id: 'e2', source: 's2', target: 'tgt', mode: 'reference', order: 1 },
      { id: 'e3', source: 's3', target: 'tgt', mode: 'reference', order: 2 },
    ]
    const slots = resolveReferenceSlots(tgt, [s1, s2, s3, tgt], edges)
    expect(slots[0].max).toBe(4)
    expect(slots[0].fills).toHaveLength(4) // 占满：3 pending 边 + 1 上传；另 2 上传无位可落
    expect(slots[0].fills.filter((f) => f.origin.type === 'edge')).toHaveLength(3)
    expect(slots[0].fills.filter((f) => f.status === 'pending-generation')).toHaveLength(3)
    expect(slots[0].fills.filter((f) => f.origin.type === 'upload')).toHaveLength(1)
  })

  it('边与上传是同一 URL → 去重，只留一个', () => {
    const a = node('a', 'image', { url: 'https://cdn/same.png' })
    const tgt = target('video', 'kling-3.0', 'i2v', { referenceImageUrls: ['https://cdn/same.png'] })
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame' }]
    const slots = resolveReferenceSlots(tgt, [a, tgt], edges)
    expect(slots[0].fills).toHaveLength(1)
    expect(slots[0].fills[0].origin).toEqual({ type: 'edge', sourceNodeId: 'a', semantic: 'first_frame' })
  })

  it('无档案节点（未知/未设模型）→ []（交旧 image-url 启发式路径兜，本函数不接管）', () => {
    const plain = node('p', 'video')
    expect(resolveReferenceSlots(plain, [plain], [])).toEqual([])
  })

  it('t2v 模式无声明槽 → []（纯文生没有参考槽）', () => {
    const img = node('img1', 'image', { url: 'https://cdn/a.png' })
    const tgt = target('video', 'sora-2', 't2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'img1', target: 'tgt', mode: 'first_frame' }]
    expect(resolveReferenceSlots(tgt, [img, tgt], edges)).toEqual([])
  })

  it('文本源（不可作参考）→ 不落任何槽', () => {
    const txt = node('t1', 'text')
    const tgt = target('video', 'sora-2', 'i2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 't1', target: 'tgt', mode: 'reference' }]
    const slots = resolveReferenceSlots(tgt, [txt, tgt], edges)
    expect(slots[0].fills).toEqual([])
  })
})

describe('decideArrayReferenceRemoval — 参考图「×」按来源分流（治「连线来的参考叉不掉」）', () => {
  it('边来源的参考图点× → 断边（disconnect-edge），不是删 meta', () => {
    const a = node('a', 'image', { url: 'https://cdn/edge.png' })
    const tgt = target('video', 'kling-3.0', 'i2v', { referenceImageUrls: ['https://cdn/upload.png'] })
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame' }]
    // 显示列表 [0]=边(edge.png) [1]=上传(upload.png)
    expect(decideArrayReferenceRemoval(tgt, [a, tgt], edges, 'referenceImageUrls', 0)).toEqual({
      kind: 'disconnect-edge', edgeId: 'e1', url: 'https://cdn/edge.png',
    })
  })

  it('上传来源点× → 删 meta（remove-upload，按 url 不按显示 index）', () => {
    const a = node('a', 'image', { url: 'https://cdn/edge.png' })
    const tgt = target('video', 'kling-3.0', 'i2v', { referenceImageUrls: ['https://cdn/upload.png'] })
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame' }]
    expect(decideArrayReferenceRemoval(tgt, [a, tgt], edges, 'referenceImageUrls', 1)).toEqual({
      kind: 'remove-upload', url: 'https://cdn/upload.png',
    })
  })

  it('index 越界 / 无该槽 → noop', () => {
    const tgt = target('video', 'sora-2', 'i2v', { referenceImageUrls: ['https://cdn/up.png'] })
    expect(decideArrayReferenceRemoval(tgt, [tgt], [], 'referenceImageUrls', 9)).toEqual({ kind: 'noop' })
    expect(decideArrayReferenceRemoval(tgt, [tgt], [], 'notASlot', 0)).toEqual({ kind: 'noop' })
  })
})

describe('findOrphanArrayReferences — 显示出的数组参考必有对应边（治「无边有图」§1c）', () => {
  it('纯手动上传（URL 不对应画布任何节点产物）→ 不是孤儿', () => {
    const tgt = target('video', 'sora-2', 'i2v', { referenceImageUrls: ['https://cdn/uploaded-only.png'] })
    expect(findOrphanArrayReferences([tgt], [])).toEqual([])
  })

  it('正常：边来源的参考有对应边 → 无孤儿', () => {
    const a = node('a', 'image', { url: 'https://cdn/a.png' })
    const tgt = target('video', 'sora-2', 'i2v')
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'first_frame', order: 0 }]
    expect(findOrphanArrayReferences([a, tgt], edges)).toEqual([])
  })

  it('孤儿：meta 里的 URL 其实是画布内某节点产物（本该建边却残留 meta）→ 如实报', () => {
    const a = node('a', 'image', { url: 'https://cdn/a.png' })
    // a.png 是节点 a 的产物，却以 meta-only 上传形态留在 tgt（应是 character_ref 边）。
    const tgt = target('video', 'sora-2', 'i2v', { referenceImageUrls: ['https://cdn/a.png'] })
    const orphans = findOrphanArrayReferences([a, tgt], [])
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ actual: 'meta-only 残留（无边有图）' })
  })

  it('迁移后：同 URL 已建成边 → 不再报孤儿', () => {
    const a = node('a', 'image', { url: 'https://cdn/a.png' })
    const tgt = target('video', 'sora-2', 'i2v') // meta 已清
    const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'a', target: 'tgt', mode: 'character_ref', order: 0 }]
    expect(findOrphanArrayReferences([a, tgt], edges)).toEqual([])
  })
})
