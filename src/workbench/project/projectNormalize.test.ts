import { describe, expect, it } from 'vitest'
import { normalizePayload } from './projectNormalize'
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
    const out = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), storyboardPlans: { 'doc-1': { plan, committed: false } } })
    expect(out.storyboardPlans!['doc-1'].plan).toEqual(plan)
  })

  it('从 active document projection 派生旧单方案字段，保存后仍与新真源一致', () => {
    const base = createDefaultWorkbenchProjectPayload()
    const documentId = base.activeDocumentId!
    const out = normalizePayload({
      ...base,
      storyboardPlans: { [documentId]: { plan, committed: true } },
    })
    expect(out.storyboardPlan).toEqual(plan)
    expect(out.storyboardPlanCommitted).toBe(true)
  })

  it('老项目无 storyboardPlan → 归一化为空映射,不报错', () => {
    const out = normalizePayload(createDefaultWorkbenchProjectPayload())
    expect(out.storyboardPlans).toEqual({})
  })

  it('多分镜设计持久化往返不丢，且保留旧 storyboardPlans 投影', () => {
    const base = createDefaultWorkbenchProjectPayload()
    const documentId = base.activeDocumentId!
    const design = {
      id: 'storyboard-1',
      documentId,
      title: '导演版 A',
      plan,
      committed: false,
      status: 'draft' as const,
      sourceDocumentUpdatedAt: 10,
      createdAt: 11,
      updatedAt: 12,
    }
    const out = normalizePayload({
      ...base,
      storyboardPlans: { [documentId]: { plan, committed: false } },
      storyboardDesignsByDocumentId: { [documentId]: [design] },
    })
    expect(out.storyboardDesignsByDocumentId?.[documentId]).toEqual([design])
    expect(out.storyboardPlans?.[documentId].plan).toEqual(plan)
  })

  it('空的新字段不会遮掉仍有数据的旧 storyboardPlans', () => {
    const base = createDefaultWorkbenchProjectPayload()
    const documentId = base.activeDocumentId!
    const out = normalizePayload({
      ...base,
      storyboardPlans: { [documentId]: { plan, committed: false } },
      storyboardDesignsByDocumentId: {},
    })

    expect(out.storyboardDesignsByDocumentId).toBeUndefined()
    expect(out.storyboardPlans?.[documentId].plan).toEqual(plan)
  })

  it('保留画布事件日志游标，避免结果级更新后重复回放旧事件', () => {
    const out = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), generationCanvasLastSeq: 37 })
    expect(out.generationCanvasLastSeq).toBe(37)
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
    expect(out.workbenchDocuments!).toHaveLength(1)
    expect(out.workbenchDocuments![0].version).toBe(1)
    expect(out.workbenchDocuments![0].title).toBe('')
    expect(out.timeline.tracks.length).toBeGreaterThan(0) // 默认时间轴轨道补齐
  })

  it('workbenchDocument/timeline 是非法值（present-but-malformed）→ 同样降级为默认，不抛', () => {
    const out = normalizePayload({
      workbenchDocument: 'garbage',
      timeline: 42,
      generationCanvas: { nodes: [], edges: [] },
    })
    expect(out.workbenchDocuments!).toHaveLength(1)
    expect(out.workbenchDocuments![0].version).toBe(1)
    expect(out.workbenchDocuments![0].title).toBe('')
    expect(out.timeline.tracks.length).toBeGreaterThan(0)
  })
})
