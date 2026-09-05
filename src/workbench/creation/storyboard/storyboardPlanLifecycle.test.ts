import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { createEmptyStoryboardPlan, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

const plan: StoryboardPlan = {
  title: '测试方案',
  anchors: [],
  shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' }],
}

const DOC = 'doc-1'

function reset() {
  useWorkbenchStore.setState({
    workbenchDocuments: [{ id: DOC, version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
    activeDocumentId: DOC,
    storyboardPlans: {},
    storyboardDesignsByDocumentId: {},
    activeStoryboardId: null,
  })
}

// 锁分镜方案的生命周期不变量（核心：确认落画布不焚、载入态不标脏）。
// P4 多原稿多方案：storyboardPlan/storyboardPlanCommitted 已改为 storyboardPlans（按 documentId 索引）。
describe('分镜方案 生命周期', () => {
  beforeEach(reset)

  it('setStoryboardPlan = 草稿态', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const after = useWorkbenchStore.getState()
    expect(after.storyboardPlans[DOC].plan).toEqual(plan)
    expect(after.storyboardPlans[DOC].committed).toBe(false)
  })

  it('planner replaces the blank structural starter and projects the selected design', () => {
    const s = useWorkbenchStore.getState()
    s.hydrateStoryboardPlans({ [DOC]: { plan: createEmptyStoryboardPlan(), committed: false } })
    const starterId = useWorkbenchStore.getState().activeStoryboardId

    s.setStoryboardPlan(plan, DOC, undefined, true, true)
    const after = useWorkbenchStore.getState()

    expect(after.activeStoryboardId).toBe(starterId)
    expect(after.storyboardDesignsByDocumentId[DOC]).toHaveLength(1)
    expect(after.storyboardPlans[DOC]).toEqual({ plan, committed: false })
  })

  it('commitStoryboardPlan 不焚:方案保留、转已落画布', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    s.commitStoryboardPlan(DOC)
    const after = useWorkbenchStore.getState()
    expect(after.storyboardPlans[DOC].plan).toEqual(plan) // 关键:不再 setStoryboardPlan(null)
    expect(after.storyboardPlans[DOC].committed).toBe(true)
  })

  it('编辑已落画布的方案 → 回落草稿(与画布上旧节点视为不一致)', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    s.commitStoryboardPlan(DOC)
    s.setStoryboardPlan({ ...plan, title: '改了名' }, DOC)
    expect(useWorkbenchStore.getState().storyboardPlans[DOC].committed).toBe(false)
  })

  it('discardStoryboardPlan 清空方案', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    s.discardStoryboardPlan(DOC)
    const after = useWorkbenchStore.getState()
    expect(after.storyboardPlans[DOC]).toBeUndefined()
  })

  it('hydrateStoryboardPlans 载入态:恢复整套映射、不标脏', () => {
    const s = useWorkbenchStore.getState()
    s.hydrateStoryboardPlans({ [DOC]: { plan, committed: true } })
    const after = useWorkbenchStore.getState()
    expect(after.storyboardPlans[DOC].plan).toEqual(plan)
    expect(after.storyboardPlans[DOC].committed).toBe(true)
    expect(after.activeStoryboardId).toBe(after.storyboardDesignsByDocumentId[DOC][0].id)
  })

  it('不同文档的方案互不影响（P4 核心不变量）', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, 'doc-a')
    s.setStoryboardPlan({ ...plan, title: 'doc-b 的方案' }, 'doc-b')
    s.commitStoryboardPlan('doc-a')
    const after = useWorkbenchStore.getState()
    expect(after.storyboardPlans['doc-a'].committed).toBe(true)
    expect(after.storyboardPlans['doc-b'].plan.title).toBe('doc-b 的方案')
    expect(after.storyboardPlans['doc-b'].committed).toBe(false) // doc-b 仍是草稿
  })

  it('同一原稿可以保留多个分镜设计，并独立切换', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const firstId = useWorkbenchStore.getState().activeStoryboardId!
    s.setActiveStoryboardId(null)
    s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC)
    const afterCreate = useWorkbenchStore.getState()
    const secondId = afterCreate.activeStoryboardId!

    expect(secondId).not.toBe(firstId)
    expect(afterCreate.storyboardDesignsByDocumentId[DOC]).toHaveLength(2)

    s.setActiveStoryboardId(firstId, DOC)
    expect(useWorkbenchStore.getState().storyboardPlans[DOC].plan.title).toBe('测试方案')
    s.setActiveStoryboardId(secondId, DOC)
    expect(useWorkbenchStore.getState().storyboardPlans[DOC].plan.title).toBe('第二版')
  })

  it('异步结果按显式 storyboardId 回写，不受当前选择变化影响', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const firstId = useWorkbenchStore.getState().activeStoryboardId!
    s.setActiveStoryboardId(null)
    s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC)
    const secondId = useWorkbenchStore.getState().activeStoryboardId!

    s.setActiveStoryboardId(firstId, DOC)
    s.setStoryboardPlan({ ...plan, title: '第二版异步结果' }, DOC, secondId, true)

    const after = useWorkbenchStore.getState()
    expect(after.activeStoryboardId).toBe(firstId)
    expect(after.storyboardDesignsByDocumentId[DOC].find((design) => design.id === firstId)?.plan.title).toBe('测试方案')
    expect(after.storyboardDesignsByDocumentId[DOC].find((design) => design.id === secondId)?.plan.title).toBe('第二版异步结果')

    s.commitStoryboardPlan(DOC, secondId)
    const committed = useWorkbenchStore.getState()
    expect(committed.activeStoryboardId).toBe(firstId)
    expect(committed.storyboardPlans[DOC].committed).toBe(false)
    expect(committed.storyboardDesignsByDocumentId[DOC].find((design) => design.id === secondId)?.committed).toBe(true)
  })

  it('新建分镜的异步结果不会覆盖生成期间新选中的分镜', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const firstId = useWorkbenchStore.getState().activeStoryboardId!

    // New planning started with no storyboard id. The user selects another
    // resource before the async tool result returns.
    s.setActiveStoryboardId(firstId, DOC)
    s.setStoryboardPlan({ ...plan, title: '异步新方案' }, DOC, undefined, true, true)

    const after = useWorkbenchStore.getState()
    expect(after.activeStoryboardId).toBe(firstId)
    expect(after.storyboardDesignsByDocumentId[DOC]).toHaveLength(2)
    expect(after.storyboardDesignsByDocumentId[DOC].find((design) => design.id === firstId)?.plan.title).toBe('测试方案')
    expect(after.storyboardDesignsByDocumentId[DOC].some((design) => design.plan.title === '异步新方案')).toBe(true)
  })

  it('修订目标在生成期间被删除时不会复活', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const storyboardId = useWorkbenchStore.getState().activeStoryboardId!
    s.deleteStoryboardDesign(storyboardId, DOC)

    s.setStoryboardPlan({ ...plan, title: '迟到的修订' }, DOC, storyboardId, true)

    const after = useWorkbenchStore.getState()
    expect(after.storyboardDesignsByDocumentId[DOC]).toEqual([])
    expect(after.storyboardPlans[DOC]).toBeUndefined()
  })

  it('显式提交已删除的分镜时不会误提交同原稿的其他设计', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const firstId = useWorkbenchStore.getState().activeStoryboardId!
    s.setActiveStoryboardId(null)
    s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC)
    const deletedId = useWorkbenchStore.getState().activeStoryboardId!
    s.setActiveStoryboardId(firstId, DOC)
    s.deleteStoryboardDesign(deletedId, DOC)

    s.commitStoryboardPlan(DOC, deletedId)

    const after = useWorkbenchStore.getState()
    expect(after.activeStoryboardId).toBe(firstId)
    expect(after.storyboardDesignsByDocumentId[DOC][0].committed).toBe(false)
    expect(after.storyboardPlans[DOC].committed).toBe(false)
  })

  it('删除其他原稿的分镜不会改变当前选择', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const activeId = useWorkbenchStore.getState().activeStoryboardId!
    s.setStoryboardPlan({ ...plan, title: '其他原稿方案' }, 'doc-other')
    const otherId = useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc-other'][0].id

    s.deleteStoryboardDesign(otherId, 'doc-other')

    const after = useWorkbenchStore.getState()
    expect(after.activeDocumentId).toBe(DOC)
    expect(after.activeStoryboardId).toBe(activeId)
    expect(after.storyboardPlans[DOC].plan.title).toBe('测试方案')
  })

  it('旧 discard 入口清理其他原稿时也不会改变当前选择', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const activeId = useWorkbenchStore.getState().activeStoryboardId!
    s.setStoryboardPlan({ ...plan, title: '其他原稿方案' }, 'doc-other')

    s.discardStoryboardPlan('doc-other')

    const after = useWorkbenchStore.getState()
    expect(after.activeDocumentId).toBe(DOC)
    expect(after.activeStoryboardId).toBe(activeId)
    expect(after.storyboardPlans[DOC].plan.title).toBe('测试方案')
  })

  it('hydrateStoryboardDesigns 恢复多分镜并选中当前原稿的首个方案', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const first = useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC][0]
    s.setActiveStoryboardId(null)
    s.setStoryboardPlan({ ...plan, title: '第二版' }, DOC)
    const entries = useWorkbenchStore.getState().storyboardDesignsByDocumentId

    s.hydrateStoryboardDesigns(entries)

    const after = useWorkbenchStore.getState()
    expect(after.activeStoryboardId).toBe(first.id)
    expect(after.storyboardDesignsByDocumentId[DOC]).toHaveLength(2)
    expect(after.storyboardPlans[DOC].plan).toEqual(first.plan)
  })

  it('没有已恢复方案时保持未选中，创作区仍显示新建入口', () => {
    const s = useWorkbenchStore.getState()

    s.hydrateStoryboardDesigns({})

    expect(useWorkbenchStore.getState().activeStoryboardId).toBeNull()
    expect(useWorkbenchStore.getState().storyboardPlans).toEqual({})
  })

  it('混合版本恢复时按原稿用新设计优先、用旧投影补缺', () => {
    const s = useWorkbenchStore.getState()
    s.setStoryboardPlan(plan, DOC)
    const currentDesign = useWorkbenchStore.getState().storyboardDesignsByDocumentId[DOC][0]
    const legacyPlan = { ...plan, title: '旧字段中的另一篇原稿' }

    s.hydrateStoryboardDesigns(
      { [DOC]: [currentDesign] },
      { 'doc-other': { plan: legacyPlan, committed: true } },
    )

    const after = useWorkbenchStore.getState()
    expect(after.storyboardDesignsByDocumentId[DOC]).toEqual([currentDesign])
    expect(after.storyboardDesignsByDocumentId['doc-other'][0].plan).toEqual(legacyPlan)
    expect(after.storyboardDesignsByDocumentId['doc-other'][0].committed).toBe(true)
  })
})
