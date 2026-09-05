import { describe, expect, it } from 'vitest'
import type { PlanShot, StoryboardPlan } from './storyboardPlan'
import {
  effectiveShotAspect,
  isAspectOverridden,
  overriddenAspectCount,
  planDefaultAspect,
  setPlanDefaultAspect,
  setShotAspectOverride,
  shotAspectOverride,
} from './storyboardAspectScope'

const shot = (index: number, aspect?: string, extra?: Record<string, unknown>): PlanShot => ({
  index,
  durationSec: 5,
  anchorIds: [],
  prompt: `p${index}`,
  ...(aspect || extra ? { params: { ...(aspect ? { aspect_ratio: aspect } : {}), ...(extra ?? {}) } } : {}),
})
const planOf = (shots: PlanShot[], aspectRatio?: string): StoryboardPlan => ({
  title: 't',
  anchors: [],
  shots,
  ...(aspectRatio !== undefined ? { aspectRatio } : {}),
})

describe('storyboardAspectScope', () => {
  it('旧 plan（每行都写着同一个画幅、plan 上没有默认）读出整片默认，且一行都不算覆盖', () => {
    const plan = planOf([shot(1, '9:16'), shot(2, '9:16'), shot(3, '9:16')])
    expect(planDefaultAspect(plan)).toBe('9:16')
    expect(overriddenAspectCount(plan)).toBe(0)
    expect(plan.shots.every((s) => !isAspectOverridden(plan, s))).toBe(true)
    expect(effectiveShotAspect(plan, plan.shots[0])).toBe('9:16')
  })

  it('与整片默认不同的那一行才算覆盖（底栏胶囊出不出现只看这一条）', () => {
    const plan = planOf([shot(1), shot(2, '16:9'), shot(3)], '9:16')
    expect(isAspectOverridden(plan, plan.shots[0])).toBe(false)
    expect(isAspectOverridden(plan, plan.shots[1])).toBe(true)
    expect(overriddenAspectCount(plan)).toBe(1)
    expect(effectiveShotAspect(plan, plan.shots[0])).toBe('9:16')
    expect(effectiveShotAspect(plan, plan.shots[1])).toBe('16:9')
  })

  it('改整片默认：继承的行跟着变、已覆盖的行不动（合同 §2.4.1 的承诺）', () => {
    const before = planOf([shot(1, '9:16'), shot(2, '16:9'), shot(3, '9:16')], '9:16')
    const after = setPlanDefaultAspect(before, '1:1')
    expect(planDefaultAspect(after)).toBe('1:1')
    expect(effectiveShotAspect(after, after.shots[0])).toBe('1:1')
    expect(effectiveShotAspect(after, after.shots[2])).toBe('1:1')
    expect(effectiveShotAspect(after, after.shots[1])).toBe('16:9')
    expect(isAspectOverridden(after, after.shots[1])).toBe(true)
    expect(overriddenAspectCount(after)).toBe(1)
  })

  it('"跟着变"是把继承行的冗余值清掉，不是把新值抄进每一行（否则又造回第二份真相）', () => {
    const after = setPlanDefaultAspect(planOf([shot(1, '9:16'), shot(2, '9:16')], '9:16'), '1:1')
    expect(after.shots.map(shotAspectOverride)).toEqual([null, null])
  })

  it('收回行级覆盖后 params 的其余键原样留着；params 空了才整个删掉', () => {
    const plan = planOf([shot(1, '16:9', { resolution: '1080p' }), shot(2, '16:9')], '9:16')
    const cleared = setShotAspectOverride(plan, 0, null)
    expect(cleared.shots[0].params).toEqual({ resolution: '1080p' })
    expect(setShotAspectOverride(plan, 1, null).shots[1].params).toBeUndefined()
  })

  it('把行级画幅设成与整片默认相同 = 收回覆盖（不留一个"看起来被动过"的假覆盖）', () => {
    const plan = planOf([shot(1, '16:9')], '9:16')
    const same = setShotAspectOverride(plan, 0, '9:16')
    expect(shotAspectOverride(same.shots[0])).toBeNull()
    expect(overriddenAspectCount(same)).toBe(0)
  })

  it('越界位置 no-op；无镜方案的默认是空串（按模型默认走，不编造 9:16）', () => {
    const plan = planOf([shot(1)], '9:16')
    expect(setShotAspectOverride(plan, 9, '1:1')).toBe(plan)
    expect(planDefaultAspect(planOf([]))).toBe('')
  })
})
