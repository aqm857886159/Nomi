import { describe, expect, it } from 'vitest'
import type { PlanShot, StoryboardPlan } from './storyboardPlan'
import {
  FILM_DEFAULT_PARAM_KEYS,
  FILM_DEFAULT_PLAN_KEYS,
  effectiveShotAspect,
  isAspectOverridden,
  overriddenAspectCount,
  planDefaultAspect,
  resolveKeyframeParams,
  resolveShotParams,
  setPlanDefaultAspect,
  setShotAspectOverride,
  shotAspectOverride,
  unsupportedFilmDefaultKeys,
} from './storyboardShotScope'

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

describe('storyboardShotScope', () => {
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

/**
 * 「整片默认 → 逐镜生成参数」的普查（2026-09-12 根因合同
 * docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json）。
 *
 * 这一族 bug 的本体不是"画幅那一个键漏了"，而是**整片级设置在「显示」与「请求」之间有两份真相**。
 * 所以这些用例钉的不是某个字面值，而是 resolver 的三段语义：行覆盖 > 整片默认 > 诚实缺席。
 */
describe('resolveShotParams：整片默认 → 逐镜请求参数', () => {
  it('行继承整片默认 → 请求体带上整片画幅（这正是 9:16 设了却出横屏的那一格）', () => {
    const plan = planOf([shot(1), shot(2)], '9:16')
    expect(resolveShotParams(plan, plan.shots[0])).toEqual({ aspect_ratio: '9:16' })
    expect(resolveShotParams(plan, plan.shots[1])).toEqual({ aspect_ratio: '9:16' })
  })

  it('行覆盖赢整片默认，且不碰这一行别的参数', () => {
    const plan = planOf([shot(1, '16:9', { resolution: '1080p' }), shot(2)], '9:16')
    expect(resolveShotParams(plan, plan.shots[0])).toEqual({ aspect_ratio: '16:9', resolution: '1080p' })
    expect(resolveShotParams(plan, plan.shots[1])).toEqual({ aspect_ratio: '9:16' })
  })

  it('整片默认未定 → 参数键诚实缺席（不编一个值，交回模型档案默认）', () => {
    const plan = planOf([shot(1, undefined, { resolution: '720p' })])
    expect(resolveShotParams(plan, plan.shots[0])).toEqual({ resolution: '720p' })
    expect('aspect_ratio' in resolveShotParams(plan, plan.shots[0])).toBe(false)
  })

  it('整片默认显式清成「按模型默认」→ 同样缺席，不回落到全镜共同值', () => {
    const plan = planOf([shot(1), shot(2)], '')
    expect(resolveShotParams(plan, plan.shots[0])).toEqual({})
  })

  it('首帧图跟着整片画幅走：首帧与它喂的视频必须同画幅', () => {
    const plan = planOf([{ ...shot(1), keyframe: { enabled: true, prompt: '首帧' } }], '9:16')
    expect(resolveKeyframeParams(plan, plan.shots[0])).toEqual({ aspect_ratio: '9:16' })
  })

  it('首帧自己写了画幅时按它自己的来（行覆盖对首帧同样生效）', () => {
    const plan = planOf([{ ...shot(1, '1:1'), keyframe: { enabled: true, params: { aspect_ratio: '1:1' } } }], '9:16')
    expect(resolveKeyframeParams(plan, plan.shots[0])).toEqual({ aspect_ratio: '1:1' })
  })

  it('resolver 不改 plan/shot 本体（继承仍是读时算的，不抄进每一行）', () => {
    const plan = planOf([shot(1)], '9:16')
    resolveShotParams(plan, plan.shots[0])
    expect(plan.shots[0].params).toBeUndefined()
  })
})

describe('片种模板声明的画幅', () => {
  it('选了短剧片种 → 整片默认是模板声明的 9:16（模板那句话第一次真的算数）', () => {
    const plan: StoryboardPlan = { ...planOf([shot(1), shot(2)]), profileKey: 'genre.short-drama' }
    expect(planDefaultAspect(plan)).toBe('9:16')
    expect(resolveShotParams(plan, plan.shots[0])).toEqual({ aspect_ratio: '9:16' })
  })

  it('plan 上显式设过 → 片种声明不再插手（用户手设 > 模板）', () => {
    const plan: StoryboardPlan = { ...planOf([shot(1)], '1:1'), profileKey: 'genre.short-drama' }
    expect(planDefaultAspect(plan)).toBe('1:1')
  })

  it('全镜共同值 > 片种声明（旧 plan 的读时迁移优先，不被模板改写）', () => {
    const plan: StoryboardPlan = { ...planOf([shot(1, '16:9'), shot(2, '16:9')]), profileKey: 'genre.short-drama' }
    expect(planDefaultAspect(plan)).toBe('16:9')
  })

  it('没选片种 → 不拿 free-form 的 16:9 当兜底（那是替用户硬定横屏）', () => {
    expect(planDefaultAspect(planOf([shot(1), shot(2)]))).toBe('')
  })
})

describe('unsupportedFilmDefaultKeys：供应商没有这个控件时如实说明', () => {
  it('该 mode 没有 aspect_ratio 控件 → 报出来（界面不许继续显示一个发不出去的值）', () => {
    const plan = planOf([shot(1)], '9:16')
    expect(unsupportedFilmDefaultKeys(plan, plan.shots[0], [{ key: 'duration' }, { key: 'resolution' }]))
      .toEqual(['aspect_ratio'])
  })

  it('该 mode 有这个控件 → 不报', () => {
    const plan = planOf([shot(1)], '9:16')
    expect(unsupportedFilmDefaultKeys(plan, plan.shots[0], [{ key: 'aspect_ratio' }])).toEqual([])
  })

  it('整片默认本来就没定 → 不报（没有值要丢，就不是"被丢了"）', () => {
    const plan = planOf([shot(1)])
    expect(unsupportedFilmDefaultKeys(plan, plan.shots[0], [{ key: 'duration' }])).toEqual([])
  })

  it('无模型/无档案 → 无契约可判，不瞎报', () => {
    const plan = planOf([shot(1)], '9:16')
    expect(unsupportedFilmDefaultKeys(plan, plan.shots[0], null)).toEqual([])
  })
})

describe('登记表本身', () => {
  it('每条整片级设置都同时登记了 plan 字段名与参数键（门岗按这两份清单核验 schema）', () => {
    expect(FILM_DEFAULT_PARAM_KEYS).toContain('aspect_ratio')
    expect(FILM_DEFAULT_PLAN_KEYS).toContain('aspectRatio')
    expect(FILM_DEFAULT_PARAM_KEYS.length).toBe(FILM_DEFAULT_PLAN_KEYS.length)
  })
})
