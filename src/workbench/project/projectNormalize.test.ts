import { generationNodeRunRecordSchema } from '../generationCanvas/model/generationCanvasSchema'
import { textDocumentDigest } from '../generationCanvas/runner/textGenerationDocument'
import { describe, expect, it, vi } from 'vitest'
import { normalizePayload, normalizeRecord } from './projectNormalize'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode, TiptapDocJson } from '../generationCanvas/model/generationCanvasTypes'

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
  it('Agent plans saved before shot numbers stopped counting reference cards load with rows 1..N; identities untouched', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const legacy: StoryboardPlan = { title: 'agent', anchors: [{ id: 'shot-1', kind: 'character', name: 'Hero', description: 'red coat', carrier: 'visual' }],
      shots: [{ index: 3, shotId: 'shot-3', durationSec: 3, anchorIds: [], prompt: 'A' }, { index: 4, shotId: 'shot-4', durationSec: 3, anchorIds: [], prompt: 'B' }] }
    const out = normalizePayload({ ...base, storyboardDesignsByDocumentId: { [documentId]: [{ ...design(documentId), plan: legacy }] } })
    const loaded = out.storyboardDesignsByDocumentId?.[documentId]?.[0].plan
    expect(loaded?.shots.map(shot => [shot.index, shot.shotId])).toEqual([[1, 'shot-3'], [2, 'shot-4']])
    expect(loaded?.anchors).toEqual(legacy.anchors)
    // 有镜头没 shotId（旧手建方案，身份按镜号派生）：一字不动。
    const handMade = normalizePayload({ ...base, storyboardDesignsByDocumentId: { [documentId]: [{ ...design(documentId), plan: { ...plan, shots: [{ ...plan.shots[0], index: 2 }] } }] } })
    expect(handMade.storyboardDesignsByDocumentId?.[documentId]?.[0].plan.shots[0].index).toBe(2)
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
  // 旧项目按定义带着历史字段。一份方案多一个键，不该让这个项目的分镜消失，更不该让
  // `normalizePayload` 抛 corruptPayload 把**整个项目**变成打不开。
  it('opens a stored record whose plans carry unknown historical keys, with every plan intact', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const withUnknown = {
      ...plan, retiredTopLevelField: 'from an older build',
      anchors: [{ ...plan.anchors[0], retiredAnchorField: 1 }],
      shots: [{ ...plan.shots[0], retiredShotField: true, keyframe: { enabled: true, retiredKeyframeField: 'x' },
        referenceBindings: { character: [{ url: 'https://example/a.png', retiredBindingField: 'x' }] } }],
    }
    const stored = { ...design(documentId), plan: withUnknown }
    const out = normalizePayload({ ...base, storyboardDesignsByDocumentId: { [documentId]: [stored] } })
    const designs = out.storyboardDesignsByDocumentId?.[documentId]
    expect(designs).toHaveLength(1)
    expect(designs?.[0].plan.shots).toHaveLength(1)
    expect(designs?.[0].plan.shots[0].prompt).toBe(plan.shots[0].prompt)
    expect(designs?.[0].plan.anchors[0].name).toBe(plan.anchors[0].name)
    expect(designs?.[0].plan.shots[0].keyframe?.enabled).toBe(true)
    expect(designs?.[0].plan.shots[0].referenceBindings?.character?.[0].url).toBe('https://example/a.png')
  })
  it('migrates a retired map whose plan carries unknown historical keys', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const legacyKey = ['storyboard', 'Plans'].join('')
    const out = normalizePayload({ ...base,
      [legacyKey]: { [documentId]: { plan: { ...plan, retiredTopLevelField: 'x' }, committed: true } } })
    expect(out.storyboardDesignsByDocumentId?.[documentId]?.[0].plan.shots).toHaveLength(1)
  })
  it('says which document and which field when a legacy plan is genuinely unreadable', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const legacyKey = ['storyboard', 'Plans'].join('')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = normalizePayload({ ...base, [legacyKey]: { [documentId]: { plan: { title: 'broken', anchors: [], shots: [{ index: 1 }] }, committed: true } } })
      expect(out.storyboardDesignsByDocumentId).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(JSON.stringify(warn.mock.calls[0]))).toContain(documentId)
      expect(String(JSON.stringify(warn.mock.calls[0]))).toContain('shots')
    } finally { warn.mockRestore() }
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

// 2026-09-06：用户报「看不到原来的剧本/分镜」。上面那组用例全都直接喂 normalizePayload，
// 所以一直是绿的——但生产上没有任何调用者这么调：读盘走的是 normalizeRecord，而它把
// **zod 解析后**的 payload 喂给迁移器，普通 z.object 早已把 storyboardPlan 这类老键剥掉了。
// 于是老项目的分镜方案打开即消失，随后任何一次自动保存把它从盘上永久抹掉。
// 这一组把断言挪到真正的读侧边界上：迁移器测得再全，喂错料就等于没测。
describe('normalizeRecord — 老项目的分镜方案必须活着穿过读侧', () => {
  const legacyPlan: StoryboardPlan = {
    title: 'Nomi 开源宣传片',
    anchors: [{ id: 'anchor-creator', kind: 'character', name: '创作者', description: '短黑发', carrier: 'visual' }],
    // 真实老项目的镜头就是这个形状：没有 shotId、没有 sceneId。
    shots: [
      { index: 1, durationSec: 0, anchorIds: ['anchor-creator'], prompt: '工作室全景' },
      { index: 2, durationSec: 0, anchorIds: [], prompt: '时钟特写' },
    ],
  }
  const summary = { id: 'p1', name: '老项目', createdAt: 1, updatedAt: 2 } as never
  const legacyRecord = (payloadExtra: Record<string, unknown>) => ({
    id: 'p1', name: '老项目', version: 1, createdAt: 1, updatedAt: 2, savedAt: 2, revision: 1,
    payload: {
      // 老项目就是单份 workbenchDocument（连 id 都没有）+ 顶层老分镜键。
      workbenchDocument: { version: 1, title: '', updatedAt: 30, contentJson: { type: 'doc', content: [] } },
      timeline: null,
      generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
      ...payloadExtra,
    },
  })

  // 报告案例：单份 storyboardPlan。
  it('carries the retired single plan through normalizeRecord', () => {
    const out = normalizeRecord(summary, legacyRecord({
      [['storyboard', 'Plan'].join('')]: legacyPlan,
      [['storyboard', 'Plan', 'Committed'].join('')]: true,
    }))
    const designs = Object.values(out.payload.storyboardDesignsByDocumentId ?? {}).flat()
    expect(designs).toHaveLength(1)
    expect(designs[0].plan.shots).toHaveLength(2)
    expect(designs[0].committed).toBe(true)
    // 方案必须挂在真实存在的那篇原稿下，否则侧栏同样点不到。
    expect(out.payload.workbenchDocuments?.some((d) => d.id === designs[0].documentId)).toBe(true)
  })

  // 类断言：同一族的另一个老键（按稿分组的 map）走的是同一个读侧边界。
  it('carries the retired per-document plan map through normalizeRecord', () => {
    const documentId = 'doc-legacy'
    const out = normalizeRecord(summary, legacyRecord({
      workbenchDocument: { id: documentId, version: 1, title: '', updatedAt: 30, contentJson: { type: 'doc', content: [] } },
      [['storyboard', 'Plans'].join('')]: { [documentId]: { plan: legacyPlan, committed: false } },
    }))
    expect(Object.values(out.payload.storyboardDesignsByDocumentId ?? {}).flat()).toHaveLength(1)
  })

  // 新形状不受影响：owner 字段照常穿过，且不被老键覆盖。
  it('keeps the owner field intact for current-shape records', () => {
    const documentId = 'doc-new'
    const design = {
      id: 'sb-1', documentId, title: legacyPlan.title, plan: legacyPlan, committed: false,
      status: 'draft' as const, sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12,
    }
    const out = normalizeRecord(summary, legacyRecord({
      workbenchDocuments: [{ id: documentId, version: 1, title: '新稿', updatedAt: 30, contentJson: { type: 'doc', content: [] } }],
      activeDocumentId: documentId,
      storyboardDesignsByDocumentId: { [documentId]: [design] },
    }))
    expect(out.payload.storyboardDesignsByDocumentId?.[documentId]).toEqual([design])
  })
})

it('retains the shared assistant width and collapsed preference through project normalization', async () => {
  const { EDITING_PANEL_DEFAULTS } = await import('../preview/panelLayout')
  const layout = { ...EDITING_PANEL_DEFAULTS, assistantWidth: 310, visibility: { ...EDITING_PANEL_DEFAULTS.visibility, assistant: false } }
  const saved = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), editingPanelLayout: layout })
  expect(saved.editingPanelLayout).toEqual(layout)
  expect(normalizePayload(saved).editingPanelLayout).toEqual(layout)
})

it('rejects malformed persisted layouts before they reach workspace sizing', async () => {
  const { EDITING_PANEL_DEFAULTS } = await import('../preview/panelLayout')
  for (const assistantWidth of [NaN, Infinity, '310']) {
    expect(() => normalizePayload({ ...createDefaultWorkbenchProjectPayload(), editingPanelLayout: { ...EDITING_PANEL_DEFAULTS, assistantWidth } })).toThrow()
  }
})


it('keeps the existing immutable workspace identity through the original record normalizer', () => {
  const summary = { id: 'original-project', name: 'Original', createdAt: 1, updatedAt: 1 }
  const identity = { immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 4 }
  const normalized = normalizeRecord(summary, { ...summary, ...identity, version: 2, payload: createDefaultWorkbenchProjectPayload() })
  expect(normalized).toMatchObject({ ...identity, id: summary.id, version: 1 })
})


it('round-trips a generated text body with its exact run/result identity and single run digest through the original project reader', () => {
  const contentJson: TiptapDocJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'generated body' }] }] }
  const result = { id: 'text-result', type: 'text', text: 'generated body', createdAt: 1 }
  const run = { id: 'text-run', status: 'success', projectId: 'project-text', resultId: result.id, textDocumentDigest: textDocumentDigest(contentJson), startedAt: 1, updatedAt: 2 }
  const input = { id: 'project-text', name: 'text', version: 1, createdAt: 1, updatedAt: 2,
    payload: { ...createDefaultWorkbenchProjectPayload(), generationCanvas: { nodes: [{
      id: 'text-node', kind: 'text', title: '', position: { x: 0, y: 0 }, contentJson, result, history: [result], runs: [run],
    }], edges: [], groups: [], selectedNodeIds: [] } } }
  expect(generationNodeRunRecordSchema.parse(run).projectId).toBe(run.projectId)
  const reopened = normalizeRecord(input, JSON.parse(JSON.stringify(input))).payload.generationCanvas.nodes[0]
  expect(reopened.contentJson).toEqual(contentJson)
  expect(reopened.runs?.[0].textDocumentDigest).toBe(run.textDocumentDigest)
  expect(reopened.runs?.[0].projectId).toBe(run.projectId)
  expect(reopened.runs?.[0].resultId).toBe(reopened.result?.id)
  expect(reopened.history?.[0].id).toBe(result.id)
})
