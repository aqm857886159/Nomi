import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

const plan: StoryboardPlan = {
  title: '测试方案',
  anchors: [],
  shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' }],
}

const DOC = 'doc-1'

function reset() {
  useWorkbenchStore.getState().discardStoryboardPlan(DOC)
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
})
