import { describe, expect, it } from 'vitest'
import { extractCanvasThumbnailUrls, extractThumbnailUrlsFromRaw, normalizePayload } from './projectNormalize'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

function node(overrides: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'image',
    title: overrides.title ?? 'Node',
    position: overrides.position ?? { x: 0, y: 0 },
    result: overrides.result,
  } as GenerationCanvasNode
}

describe('normalizePayload — storyboardPlan 持久化往返(P0-6)', () => {
  const plan: StoryboardPlan = {
    title: '雨夜告白',
    anchors: [{ id: 'a1', kind: 'character', name: '男主', description: '黑发少年', carrier: 'visual' }],
    shots: [{ index: 1, durationSec: 3, anchorIds: ['a1'], prompt: '少年站在雨里' }],
  }

  it('带方案的 payload 往返不丢(normalizePayload 字段重建式,曾会丢)', () => {
    const out = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), storyboardPlan: plan })
    expect(out.storyboardPlan).toEqual(plan)
  })

  it('老项目无 storyboardPlan → 归一化为 null,不报错', () => {
    const out = normalizePayload(createDefaultWorkbenchProjectPayload())
    expect(out.storyboardPlan).toBeNull()
  })
})

describe('normalizePayload — 损坏记录优雅降级（缺可默认字段不该让项目打不开）', () => {
  // 真机案例（elicit走查）：payload 只有 { name, generationCanvas }，缺 workbenchDocument/timeline。
  // 旧行为：schema 硬必填这两个字段 → safeParse 失败 → throw「缺少必要字段」→ 整个项目打不开。
  // 根因：这两个字段的校验+默认本就由容错 normalizer 负责，schema 的严格门是冗余且有害的。
  it('缺 workbenchDocument + timeline（画布内容完好）→ 默认补齐、不抛、画布保留', () => {
    const corrupted = {
      name: 'elicit走查',
      generationCanvas: { nodes: [node({ id: 'n1' })], edges: [], groups: [], selectedNodeIds: [] },
    }
    const out = normalizePayload(corrupted)
    expect(out.generationCanvas.nodes).toHaveLength(1) // 关键内容保留
    // 默认文档结构（不比 updatedAt——默认用 Date.now()，会 flaky）
    expect(out.workbenchDocument.version).toBe(1)
    expect(out.workbenchDocument.title).toBe('')
    expect(out.timeline.tracks.length).toBeGreaterThan(0) // 默认时间轴轨道补齐
  })

  it('workbenchDocument/timeline 是非法值（present-but-malformed）→ 同样降级为默认，不抛', () => {
    const out = normalizePayload({
      workbenchDocument: 'garbage',
      timeline: 42,
      generationCanvas: { nodes: [], edges: [] },
    })
    expect(out.workbenchDocument.version).toBe(1)
    expect(out.workbenchDocument.title).toBe('')
    expect(out.timeline.tracks.length).toBeGreaterThan(0)
  })
})

describe('extractCanvasThumbnailUrls（封面派生 + 无产物降级）', () => {
  it('从有产物的节点取前若干个 url（封顶 max）', () => {
    const nodes = [
      node({ id: 'a', result: { url: 'https://cdn/a.png' } }),
      node({ id: 'b', result: { thumbnailUrl: 'https://cdn/b.png' } }),
      node({ id: 'c', result: { url: 'https://cdn/c.png' } }),
    ]
    expect(extractCanvasThumbnailUrls(nodes)).toEqual(['https://cdn/a.png', 'https://cdn/b.png', 'https://cdn/c.png'])
    expect(extractCanvasThumbnailUrls(nodes, 2)).toEqual(['https://cdn/a.png', 'https://cdn/b.png'])
  })

  it('示例/空项目（节点无产物）返回明确的空标记 []（供 UI 占位）', () => {
    const nodes = [node({ id: 'empty-1' }), node({ id: 'empty-2', result: { url: '' } })]
    expect(extractCanvasThumbnailUrls(nodes)).toEqual([])
  })

  it('降级：传入非数组/undefined/null 时返回 []，不抛错', () => {
    expect(extractCanvasThumbnailUrls(undefined as unknown as GenerationCanvasNode[])).toEqual([])
    expect(extractCanvasThumbnailUrls(null as unknown as GenerationCanvasNode[])).toEqual([])
    expect(extractCanvasThumbnailUrls({} as unknown as GenerationCanvasNode[])).toEqual([])
  })

  it('降级：数组里混入 null/非对象节点时跳过而不崩（与 main 侧派生等价的健壮性）', () => {
    const nodes = [
      null,
      undefined,
      'not-a-node',
      node({ id: 'good', result: { url: 'https://cdn/good.png' } }),
    ] as unknown as GenerationCanvasNode[]
    expect(extractCanvasThumbnailUrls(nodes)).toEqual(['https://cdn/good.png'])
  })

  it('过滤过短 url（length <= 4）', () => {
    const nodes = [node({ id: 'tiny', result: { url: 'abcd' } }), node({ id: 'ok', result: { url: 'abcde' } })]
    expect(extractCanvasThumbnailUrls(nodes)).toEqual(['abcde'])
  })
})

describe('extractThumbnailUrlsFromRaw', () => {
  it('从 payload.generationCanvas.nodes 派生', () => {
    const raw = { payload: { generationCanvas: { nodes: [{ result: { url: 'https://cdn/x.png' } }] } } }
    expect(extractThumbnailUrlsFromRaw(raw)).toEqual(['https://cdn/x.png'])
  })

  it('无画布/无节点时返回 []', () => {
    expect(extractThumbnailUrlsFromRaw(null)).toEqual([])
    expect(extractThumbnailUrlsFromRaw({})).toEqual([])
    expect(extractThumbnailUrlsFromRaw({ payload: {} })).toEqual([])
  })
})
