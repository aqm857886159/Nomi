import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { createEmptyStoryboardPlan, isEmptyStoryboardPlan, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { planDefaultAspect, setPlanDefaultAspect } from '../../generationCanvas/agent/storyboardShotScope'
import type { StoryboardDesign } from '../../workbenchTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'

const plan: StoryboardPlan = { title: '测试方案', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' }] }
const DOC = 'doc-1'
const active = () => {
  const state = useWorkbenchStore.getState()
  const designs = state.storyboardDesignsByDocumentId[DOC] ?? []
  return designs.find((design) => design.id === state.activeStoryboardId) ?? designs[0]
}
function design(documentId: string, value: StoryboardPlan, committed = false): StoryboardDesign {
  return { id: `${documentId}-${value.title}`, documentId, title: value.title, plan: value, committed, status: committed ? 'committed' : 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }
}
function reset() {
  useWorkbenchStore.setState({ workbenchDocuments: [{ id: DOC, version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], activeDocumentId: DOC, storyboardDesignsByDocumentId: {}, activeStoryboardId: null, previewAspect: undefined })
}
describe('分镜方案生命周期（单一 owner）', () => {
  beforeEach(reset)
  it('manual creation starts blank, appends independent identities and leaves canvas unchanged', () => {
    const state = useWorkbenchStore.getState()
    const graph = useGenerationCanvasStore.getState()
    const revision = state.persistRevision
    const first = state.addStoryboardDesign({ initiator: 'user', documentId: DOC })
    expect(first?.plan).toEqual(createEmptyStoryboardPlan())
    // 空白新建也要有**自己的名字**：两行都叫「分镜方案」时，用户在左栏看到的是同一个东西
    // （2026-09-21 真机截图）。名字只落在行上，plan.title 仍是空——起手式判据靠的就是它。
    expect(first?.title).toBe('分镜方案')
    expect(useWorkbenchStore.getState().persistRevision).toBe(revision + 1)
    expect(useGenerationCanvasStore.getState().nodes).toBe(graph.nodes)
    state.setStoryboardPlan({ ...first!.plan, title: 'Keep authored draft', shots: first!.plan.shots.map(shot => ({ ...shot, prompt: 'Keep this prompt' })) }, DOC, first!.id)
    const authored = useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC][0]
    const authoredGraph = useGenerationCanvasStore.getState()
    const second = state.addStoryboardDesign({ initiator: 'user', documentId: DOC })
    expect(second?.plan).toEqual(createEmptyStoryboardPlan())
    expect(second?.id).not.toBe(first?.id)
    expect(second?.title).not.toBe(authored.title)
    expect(second?.title).toBe('分镜方案')
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]).toEqual([authored, second])
    expect(useGenerationCanvasStore.getState().nodes).toBe(authoredGraph.nodes)
    expect(useGenerationCanvasStore.getState().edges).toBe(authoredGraph.edges)
  })
  // 2026-09-21 真机截图：连开两个空白方案，左栏两行一模一样。
  it('two blank creations in a row never share a row label', () => {
    const state = useWorkbenchStore.getState()
    const titles = [1, 2, 3].map(() => state.addStoryboardDesign({ initiator: 'user', documentId: DOC })?.title)
    expect(titles).toEqual(['分镜方案', '分镜方案 2', '分镜方案 3'])
    expect(new Set(titles).size).toBe(3)
    // 删掉中间那个之后，再新建拿回的是**最小可用**号，不是「已有几个 + 1」（那会重发一个在用的号）。
    const designs = useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]
    useWorkbenchStore.getState().deleteStoryboardDesign(designs[1].id, DOC)
    expect(useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: DOC })?.title).toBe('分镜方案 2')
  })
  it('new and duplicate target the explicit document while invalid targets do not mutate', () => {
    const state = useWorkbenchStore.getState()
    const other = state.addWorkbenchDocument()
    state.setActiveStoryboardId(null)
    const blank = state.addStoryboardDesign({ initiator: 'user', documentId: DOC })
    expect(blank?.documentId).toBe(DOC)
    expect(useWorkbenchStore.getState().activeDocumentId).toBe(DOC)
    expect(useWorkbenchStore.getState().activeStoryboardId).toBe(blank?.id)
    state.setStoryboardPlan(plan, DOC, blank!.id)
    const copy = state.duplicateStoryboardDesign(blank!.id, DOC)
    expect(copy?.plan.shots).toEqual(plan.shots)
    expect(copy?.id).not.toBe(blank?.id)
    const before = useWorkbenchStore.getState()
    expect(state.addStoryboardDesign({ initiator: 'user', documentId: 'deleted-document' })).toBeNull()
    expect(useWorkbenchStore.getState()).toBe(before)
    expect(before.storyboardDesignsByDocumentId[other.id]).toBeUndefined()
  })
  it('setStoryboardPlan = 草稿态', () => { useWorkbenchStore.getState().setStoryboardPlan(plan, DOC); expect(active()?.plan).toEqual(plan); expect(active()?.committed).toBe(false) })
  it('planner replaces the blank structural starter', () => {
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ [DOC]: [design(DOC, createEmptyStoryboardPlan())] })
    const starterId = useWorkbenchStore.getState().activeStoryboardId
    useWorkbenchStore.getState().setStoryboardPlan(plan, DOC, undefined, true, 'user')
    expect(useWorkbenchStore.getState().activeStoryboardId).toBe(starterId)
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]).toHaveLength(1)
    expect(active()?.plan).toEqual(plan)
  })
  it('commitStoryboardPlan 保留方案并转已落画布', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); s.commitStoryboardPlan(DOC); expect(active()?.plan).toEqual(plan); expect(active()?.committed).toBe(true) })
  it('编辑已落画布的方案回落草稿', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); s.commitStoryboardPlan(DOC); s.setStoryboardPlan({ ...plan, title: '改了名' }, DOC); expect(active()?.committed).toBe(false) })
  it('discardStoryboardPlan 清空方案', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); s.discardStoryboardPlan(DOC); expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]).toEqual([]) })
  it('hydrateStoryboardDesigns 载入态恢复并选中', () => { const s = useWorkbenchStore.getState(); s.hydrateStoryboardDesigns({ [DOC]: [design(DOC, plan, true)] }); expect(active()?.plan).toEqual(plan); expect(active()?.committed).toBe(true) })
  it('不同文档的方案互不影响', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, 'doc-a'); s.setStoryboardPlan({ ...plan, title: 'doc-b 的方案' }, 'doc-b'); s.commitStoryboardPlan('doc-a'); const after = useWorkbenchStore.getState(); expect(after.storyboardDesignsByDocumentId['doc-a']?.[0].committed).toBe(true); expect(after.storyboardDesignsByDocumentId['doc-b']?.[0].plan.title).toBe('doc-b 的方案'); expect(after.storyboardDesignsByDocumentId['doc-b']?.[0].committed).toBe(false) })
  it('同一原稿保留多个设计并独立切换', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); const firstId = useWorkbenchStore.getState().activeStoryboardId!; s.setActiveStoryboardId(null); s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC); const secondId = useWorkbenchStore.getState().activeStoryboardId!; expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]).toHaveLength(2); s.setActiveStoryboardId(firstId, DOC); expect(active()?.plan.title).toBe('测试方案'); s.setActiveStoryboardId(secondId, DOC); expect(active()?.plan.title).toBe('第二版') })
  it('异步结果按显式 storyboardId 回写', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); const firstId = useWorkbenchStore.getState().activeStoryboardId!; s.setActiveStoryboardId(null); s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC); const secondId = useWorkbenchStore.getState().activeStoryboardId!; s.setActiveStoryboardId(firstId, DOC); s.setStoryboardPlan({ ...plan, title: '第二版异步结果' }, DOC, secondId, true); const after = useWorkbenchStore.getState(); expect(after.activeStoryboardId).toBe(firstId); expect(after.storyboardDesignsByDocumentId[DOC]?.find((d) => d.id === firstId)?.plan.title).toBe('测试方案'); expect(after.storyboardDesignsByDocumentId[DOC]?.find((d) => d.id === secondId)?.plan.title).toBe('第二版异步结果') })
  it('显式目标被删除时不会复活', () => { const s = useWorkbenchStore.getState(); s.setStoryboardPlan(plan, DOC); const id = useWorkbenchStore.getState().activeStoryboardId!; s.deleteStoryboardDesign(id, DOC); s.setStoryboardPlan({ ...plan, title: '迟到' }, DOC, id, true); expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]).toEqual([]) })
  it('hydrate 恢复多设计', () => { const s = useWorkbenchStore.getState(); s.hydrateStoryboardDesigns({ [DOC]: [design(DOC, plan), design(DOC, { ...plan, title: '第二版' })] }); const after = useWorkbenchStore.getState(); expect(after.storyboardDesignsByDocumentId[DOC]).toHaveLength(2); expect(active()?.plan).toEqual(plan) })
  // 视频镜头的时长只有一个家 durationSec（docs/plan/2026-11-17-param-value-type.md ★1c）：方案进 store 的每一扇门都收一次。
  // 0 + "12" 收成 12；5 + "12" 留 5；读不出的 "12s" 原样留着。载入只改内存、不标脏。
  describe('方案进 store 的每一扇门都把视频镜头时长收回 durationSec', () => {
    const conflicting: StoryboardPlan = { title: '打架', anchors: [], shots: [
      { index: 1, shotKind: 'video', durationSec: 0, anchorIds: [], prompt: '镜一', params: { duration: '12', aspect_ratio: '16:9' } },
      { index: 2, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '镜二', params: { duration: '12' } },
      { index: 3, shotKind: 'video', durationSec: 0, anchorIds: [], prompt: '镜三', params: { duration: '12s' } },
    ] }
    const expectReconciled = (value: StoryboardPlan | undefined) => {
      expect(value?.shots.map((shot) => [shot.durationSec, shot.params])).toEqual([
        [12, { aspect_ratio: '16:9' }],
        [5, {}],
        [0, { duration: '12s' }],
      ])
    }
    it('setStoryboardPlan', () => { useWorkbenchStore.getState().setStoryboardPlan(conflicting, DOC); expectReconciled(active()?.plan) })
    it('addStoryboardDesign 带来源', () => { expectReconciled(useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'agent', documentId: DOC, source: conflicting })?.plan) })
    it('restoreStoryboardDesign（撤销放回）', () => { useWorkbenchStore.getState().restoreStoryboardDesign(design(DOC, conflicting), DOC, 0); expectReconciled(active()?.plan) })
    it('hydrateStoryboardDesigns（打开项目）：收进内存、不标脏', () => {
      const revision = useWorkbenchStore.getState().persistRevision
      useWorkbenchStore.getState().hydrateStoryboardDesigns({ [DOC]: [design(DOC, conflicting)] })
      expectReconciled(active()?.plan)
      expect(useWorkbenchStore.getState().persistRevision).toBe(revision)
    })
  })

  describe('新建分镜方案默认画幅跟随项目画幅、存量与复制不强刷（UX-B3）', () => {
    it('默认项目画幅下新建空白方案为 16:9，且仍视为未编辑空白起手式', () => {
      const created = useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: DOC })!
      expect(created.plan.aspectRatio).toBe('16:9')
      expect(planDefaultAspect(created.plan)).toBe('16:9')
      expect(isEmptyStoryboardPlan(created.plan)).toBe(true)
    })

    it('项目预览画幅切为 9:16 后再新建方案，默认画幅跟随 9:16', () => {
      useWorkbenchStore.getState().setPreviewAspectRatio('9:16')
      const created = useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: DOC })!
      expect(created.plan.aspectRatio).toBe('9:16')
      expect(planDefaultAspect(created.plan)).toBe('9:16')
      expect(isEmptyStoryboardPlan(created.plan)).toBe(true)
    })

    it('新建方案可手动切回按模型默认（空串）', () => {
      const created = useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: DOC })!
      const modelDefault = setPlanDefaultAspect(created.plan, '')
      const saved = useWorkbenchStore.getState().setStoryboardPlan(modelDefault, DOC, created.id)!
      expect(saved.plan.aspectRatio).toBe('')
      expect(planDefaultAspect(saved.plan)).toBe('')
    })

    it('复制已有方案原样保留其画幅（显式按模型默认或存量未设均不强刷为项目画幅）', () => {
      const store = useWorkbenchStore.getState()
      store.setPreviewAspectRatio('9:16')
      const explicitModelDefault: StoryboardPlan = { ...plan, title: '模型默认版', aspectRatio: '' }
      const legacyUnset: StoryboardPlan = { ...plan, title: '老方案' }
      store.hydrateStoryboardDesigns({
        [DOC]: [design(DOC, explicitModelDefault), design(DOC, legacyUnset)],
      })
      const [first, second] = useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC]
      const copyFirst = useWorkbenchStore.getState().duplicateStoryboardDesign(first.id, DOC)!
      const copySecond = useWorkbenchStore.getState().duplicateStoryboardDesign(second.id, DOC)!
      expect(copyFirst.plan.aspectRatio).toBe('')
      expect(planDefaultAspect(copyFirst.plan)).toBe('')
      expect(copySecond.plan.aspectRatio).toBeUndefined()
      expect(planDefaultAspect(copySecond.plan)).toBe('')
    })

    it('载入存量无 aspectRatio 的老方案不回填、不标脏', () => {
      const store = useWorkbenchStore.getState()
      store.setPreviewAspectRatio('9:16')
      const revision = useWorkbenchStore.getState().persistRevision
      useWorkbenchStore.getState().hydrateStoryboardDesigns({ [DOC]: [design(DOC, plan)] })
      expect(active()?.plan.aspectRatio).toBeUndefined()
      expect(planDefaultAspect(active()!.plan)).toBe('')
      expect(useWorkbenchStore.getState().persistRevision).toBe(revision)
    })
  })
})

// A displayed draft must remain actionable even before a selection has been persisted.
it('waiting-to-start draft actions use the displayed design and catch the pre-submit gate', () => {
  const source = readFileSync(new URL('./StoryboardPlanEditor.tsx', import.meta.url), 'utf8')
  expect(source).not.toContain('if (busy || !activeStoryboardId) return')
  expect(source).toContain("const designId = activeDesign?.id ?? ''")
  expect(source).toMatch(/await runAction\(async context => \{[\s\S]*?resolveGeneratableGate/)
})
