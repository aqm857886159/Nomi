import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { createEmptyStoryboardPlan, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardDesign } from '../../workbenchTypes'

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
  useWorkbenchStore.setState({ workbenchDocuments: [{ id: DOC, version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], activeDocumentId: DOC, storyboardDesignsByDocumentId: {}, activeStoryboardId: null })
}
describe('分镜方案生命周期（单一 owner）', () => {
  beforeEach(reset)
  it('setStoryboardPlan = 草稿态', () => { useWorkbenchStore.getState().setStoryboardPlan(plan, DOC); expect(active()?.plan).toEqual(plan); expect(active()?.committed).toBe(false) })
  it('planner replaces the blank structural starter', () => {
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ [DOC]: [design(DOC, createEmptyStoryboardPlan())] })
    const starterId = useWorkbenchStore.getState().activeStoryboardId
    useWorkbenchStore.getState().setStoryboardPlan(plan, DOC, undefined, true, true)
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
})
