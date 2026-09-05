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

describe('normalizePayload — storyboard design owner', () => {
  const plan: StoryboardPlan = {
    title: '雨夜告白', anchors: [{ id: 'a1', kind: 'character', name: '男主', description: '黑发少年', carrier: 'visual' }],
    shots: [{ index: 1, durationSec: 3, anchorIds: ['a1'], prompt: '少年站在雨里' }],
  }
  const design = (documentId: string) => ({ id: 'storyboard-1', documentId, title: plan.title, plan, committed: false, status: 'draft' as const, sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 })
  it('owner payload round trips without projection fields', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const out = normalizePayload({ ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId)] } })
    expect(out.storyboardDesignsByDocumentId?.[documentId]).toEqual([design(documentId)])
  })
  it('migrates the retired map into owner designs and drops the retired field', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const legacyKey = ['storyboard', 'Plans'].join('')
    const out = normalizePayload({ ...base, [legacyKey]: { [documentId]: { plan, committed: true } } })
    expect(out.storyboardDesignsByDocumentId?.[documentId]?.[0].plan).toEqual(plan)
    expect(out.storyboardDesignsByDocumentId?.[documentId]?.[0].committed).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(out, legacyKey)).toBe(false)
  })
  it('migrates the retired single plan field once', () => {
    const base = createDefaultWorkbenchProjectPayload(); const key = ['storyboard', 'Plan'].join('')
    const out = normalizePayload({ ...base, [key]: plan })
    expect(Object.values(out.storyboardDesignsByDocumentId ?? {})[0]?.[0].plan).toEqual(plan)
  })
  it('prefers owner designs when both owner and retired map exist', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const legacyKey = ['storyboard', 'Plans'].join('')
    const out = normalizePayload({ ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId)] }, [legacyKey]: { [documentId]: { plan: { ...plan, title: '旧' }, committed: true } } })
    expect(out.storyboardDesignsByDocumentId?.[documentId]?.[0].title).toBe(plan.title)
  })
  it('returns an empty owner when no storyboard exists', () => {
    const out = normalizePayload(createDefaultWorkbenchProjectPayload())
    expect(out.storyboardDesignsByDocumentId).toBeUndefined()
  })
  it('retains canvas event cursor', () => {
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
