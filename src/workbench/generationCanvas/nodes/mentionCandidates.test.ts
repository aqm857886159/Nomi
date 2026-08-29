import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { MENTION_CANDIDATE_LIMIT, buildMentionCandidates, currentReferenceMedia, planMentionInsert } from './mentionCandidates'

function imageNode(id: string, title: string, url?: string): GenerationCanvasNode {
  return {
    id, kind: 'image', title, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots',
    ...(url ? { result: { id: `${id}-r`, type: 'image', url, createdAt: 1 } } : {}),
  } as GenerationCanvasNode
}
function videoNode(id: string, title: string, url: string): GenerationCanvasNode {
  return {
    id, kind: 'video', title, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots',
    result: { id: `${id}-r`, type: 'video', url, createdAt: 1 },
  } as GenerationCanvasNode
}
const currentLabel = (n: number) => `图片${n}`
const build = (over: Partial<Parameters<typeof buildMentionCandidates>[0]> = {}) =>
  buildMentionCandidates({
    target: imageNode('target', '镜头 1'),
    nodes: [imageNode('target', '镜头 1')],
    edges: [] as GenerationCanvasEdge[],
    libraryAssets: [],
    query: '',
    currentLabel,
    ...over,
  })

describe('buildMentionCandidates — 三组候选', () => {
  it('画布上已出图的节点进「canvas」组，带 sourceNodeId（选中要建边）', () => {
    const target = imageNode('target', '镜头 1')
    const src = imageNode('a', '女主定妆', 'https://x/a.png')
    const got = build({ target, nodes: [target, src] })
    expect(got).toEqual([
      { key: 'canvas:a', url: 'https://x/a.png', label: '女主定妆', group: 'canvas', sourceNodeId: 'a' },
    ])
  })

  it('素材库图进「library」组', () => {
    const got = build({ libraryAssets: [{ id: 'as1', name: '王家卫色调.jpg', url: 'nomi-local://x/1.jpg' }] })
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ group: 'library', label: '王家卫色调.jpg' })
  })

  it('目标节点自己不进候选（不能 @ 自己）', () => {
    const target = imageNode('target', '镜头 1', 'https://x/self.png')
    expect(build({ target, nodes: [target] })).toEqual([])
  })

  it('还没生成的节点不进候选 —— 它没有 URL，而 mention 的身份就是 URL', () => {
    const target = imageNode('target', '镜头 1')
    expect(build({ target, nodes: [target, imageNode('a', '还没跑')] })).toEqual([])
  })

  it('已出视频节点进入视频候选（不再被图类过滤器静默丢弃）', () => {
    const target = imageNode('target', '镜头 1')
    const got = build({ target, nodes: [target, videoNode('v', '一段视频', 'https://x/v.mp4')] })
    expect(got).toMatchObject([{ key: 'canvas:v', label: '一段视频', kind: 'video' }])
  })

  it('视频候选按节点标题搜索，英文 query 也命中', () => {
    const target = imageNode('target', '镜头 1')
    const got = build({ target, nodes: [target, videoNode('v', 'drone move', 'https://x/drone.mp4')], query: 'dr' })
    expect(got).toMatchObject([{ key: 'canvas:v', label: 'drone move', kind: 'video' }])
  })

  it('全能参考模式的当前视频可按「视频1」搜索，并保留视频类型', () => {
    const target = {
      ...videoNode('target', '镜头 1', 'https://x/target.mp4'),
      meta: { modelKey: 'bytedance/seedance-2', modelVendor: 'kie', archetype: { id: 'seedance-2', modeId: 'omni' } },
    } as GenerationCanvasNode
    const source = videoNode('v', '运镜参考', 'https://x/move.mp4')
    const edges: GenerationCanvasEdge[] = [{ id: 'e', source: 'v', target: 'target', mode: 'reference', order: 0 }]
    expect(currentReferenceMedia(target, [target, source], edges)).toEqual([
      { url: 'https://x/move.mp4', kind: 'video', index: 1, label: '运镜参考' },
    ])
    expect(build({ target, nodes: [target, source], edges, query: '运镜' })).toMatchObject([
      { key: 'current:https://x/move.mp4', label: '运镜参考', kind: 'video', referenceIndex: 0 },
    ])
  })

  it('同一个 URL 在画布和素材库都出现时只留一条（画布优先，它能建边）', () => {
    const target = imageNode('target', '镜头 1')
    const src = imageNode('a', '女主定妆', 'nomi-local://x/1.png')
    const got = build({
      target,
      nodes: [target, src],
      libraryAssets: [{ id: 'as1', name: '同一张', url: 'nomi-local://x/1.png' }],
    })
    expect(got).toHaveLength(1)
    expect(got[0]?.group).toBe('canvas')
  })
})

describe('buildMentionCandidates — 搜索', () => {
  const target = imageNode('target', '镜头 1')
  const nodes = [target, imageNode('a', '女主定妆', 'https://x/a.png'), imageNode('b', '天台远景', 'https://x/b.png')]

  it('按名字过滤', () => {
    expect(build({ target, nodes, query: '女主' }).map((c) => c.label)).toEqual(['女主定妆'])
  })

  it('大小写不敏感', () => {
    const withEn = [target, imageNode('c', 'HeroShot', 'https://x/c.png')]
    expect(build({ target, nodes: withEn, query: 'heroshot' })).toHaveLength(1)
  })

  it('空 query 全给', () => {
    expect(build({ target, nodes, query: '   ' })).toHaveLength(2)
  })

  it('没有匹配 → 空', () => {
    expect(build({ target, nodes, query: '不存在的' })).toEqual([])
  })
})

describe('buildMentionCandidates — 上限', () => {
  it(`最多 ${MENTION_CANDIDATE_LIMIT} 条`, () => {
    const target = imageNode('target', '镜头 1')
    const many = Array.from({ length: 60 }, (_, i) => imageNode(`n${i}`, `图 ${i}`, `https://x/${i}.png`))
    expect(build({ target, nodes: [target, ...many] })).toHaveLength(MENTION_CANDIDATE_LIMIT)
  })
})

describe('planMentionInsert — 选中后该干什么', () => {
  it('已是参考 → 直接插 chip，编号 = 下标+1', () => {
    expect(planMentionInsert({ key: 'k', url: 'u', label: '图片2', group: 'current', referenceIndex: 1 }))
      .toEqual({ kind: 'insert', url: 'u', mediaKind: 'image', index: 2 })
  })

  it('画布节点 → 先建边', () => {
    expect(planMentionInsert({ key: 'k', url: 'u', label: 'x', group: 'canvas', sourceNodeId: 'a' }))
      .toEqual({ kind: 'connect', sourceNodeId: 'a', url: 'u', mediaKind: 'image' })
  })

  it('素材库 → 落上传参考槽', () => {
    expect(planMentionInsert({ key: 'k', url: 'u', label: 'x', group: 'library' }))
      .toEqual({ kind: 'attach', url: 'u', mediaKind: 'image' })
  })

  it('canvas 组丢了 sourceNodeId → 退化成 attach，不产生「连了个寂寞」的边', () => {
    expect(planMentionInsert({ key: 'k', url: 'u', label: 'x', group: 'canvas' }))
      .toEqual({ kind: 'attach', url: 'u', mediaKind: 'image' })
  })

  it('视频参考 → 选择后保留 video 类型', () => {
    expect(planMentionInsert({ key: 'k', url: 'u', label: '视频1', kind: 'video', group: 'current', referenceIndex: 0 }))
      .toEqual({ kind: 'insert', url: 'u', mediaKind: 'video', index: 1 })
  })
})
