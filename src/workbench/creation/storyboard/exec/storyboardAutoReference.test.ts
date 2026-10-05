import { describe, expect, it } from 'vitest'
import { encodeMention, mentionUrlsInOrder } from '../../../assets/promptMentions'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { autoReferencePlan, autoReferenceShot } from './storyboardAutoReference'
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'

/**
 * 分镜侧调用方 `autoReferencePlan`：参考卡出图 → 引用它的镜头「名字后面补 @ + 参考框绑上」，两件一起成。
 * 模型档案是真的（seedance-2-5：t2v 无槽、omni 有 image_ref；veo-3.1：frame 模式只有首尾帧）。
 */
const LINWEI = { anchorId: 'a-linwei', name: '林薇', url: 'nomi-local://asset/linwei.png' }

function shot(over: Partial<PlanShot> = {}): PlanShot {
  return { index: 1, shotId: 'shot-1', durationSec: 5, anchorIds: [], prompt: '林薇冲进后巷', modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 'omni', ...over }
}

describe('autoReferenceShot', () => {
  it('当前模式收参考图：名字后面补 @，同一张图绑进 image_ref（带锚 id），账本记下', () => {
    const next = autoReferenceShot(shot(), [LINWEI], true)
    expect(next.prompt).toBe(`林薇${encodeMention(LINWEI.url)}冲进后巷`)
    expect(next.referenceBindings?.image_ref).toEqual([{ url: LINWEI.url, name: '林薇', anchorId: 'a-linwei' }])
    expect(next.autoReferenced).toEqual(['a-linwei'])
    expect(next.modeId).toBe('omni')
  })

  it('用户删掉 @ 之后再跑：不补回来（账本挡住）', () => {
    const once = autoReferenceShot(shot(), [LINWEI], true)
    const userDeleted = { ...once, prompt: '林薇冲进后巷', referenceBindings: { image_ref: [] } }
    expect(autoReferenceShot(userDeleted, [LINWEI], true)).toBe(userDeleted)
  })

  it('幂等：同一张图出图签名再触发一次，不会出现第二枚 @', () => {
    const once = autoReferenceShot(shot(), [LINWEI], true)
    const twice = autoReferenceShot(once, [LINWEI], true)
    expect(twice).toBe(once)
    expect(mentionUrlsInOrder(twice.prompt)).toEqual([LINWEI.url])
  })

  it('方案 A：文生视频（无参考槽）且还没出过结果 → 切到同模型能收参考图的模式再补', () => {
    const next = autoReferenceShot(shot({ modeId: 't2v' }), [LINWEI], true)
    expect(next.modeId).toBe('omni')
    expect(next.referenceBindings?.image_ref?.[0]?.url).toBe(LINWEI.url)
  })

  it('已出过结果的镜不切模式：收不了参考图就整镜不补（@ 和绑定都不留）', () => {
    const before = shot({ modeId: 't2v' })
    expect(autoReferenceShot(before, [LINWEI], false)).toBe(before)
  })

  it('当前是首尾帧模式：人像不塞进首帧槽，切到同模型的「参考图」模式再补', () => {
    const before = shot({ modelKey: 'veo-3.1', modeId: 'frame' })
    const next = autoReferenceShot(before, [LINWEI], true)
    expect(next.modeId).toBe('reference')
    expect(next.referenceBindings?.first_frame).toBeUndefined()
  })

  it('没选模型（默认模型，档案未知）→ 不补，不假装知道能收什么', () => {
    const before = shot({ modelKey: undefined, modelVendor: undefined, modeId: undefined })
    expect(autoReferenceShot(before, [LINWEI], true)).toBe(before)
  })
})

describe('autoReferencePlan', () => {
  it('整份方案：只动名字出现的镜，已出结果的镜按 generatedShotIds 不切模式；没变化返回同一个对象', () => {
    const plan: StoryboardPlan = {
      title: 't', anchors: [],
      shots: [shot(), shot({ index: 2, shotId: 'shot-2', prompt: '她回头' }), shot({ index: 3, shotId: 'shot-3', modeId: 't2v' })],
    }
    const next = autoReferencePlan(plan, [LINWEI], new Set(['shot-3']))
    expect(next.shots[0].prompt).toContain(encodeMention(LINWEI.url))
    expect(next.shots[1]).toBe(plan.shots[1])
    expect(next.shots[2]).toBe(plan.shots[2])
    expect(autoReferencePlan(next, [LINWEI], new Set(['shot-3']))).toBe(next)
    expect(autoReferencePlan(plan, [])).toBe(plan)
  })
})

/**
 * 类级普查（逃逸账本 AUD-20261005-04 的类检查）：**登记表里每一个**视频 / 图片档案、每一种模式起步，
 * 自动引用的结果只有两种——@ 和参考绑定一起出现，或者两样都没有。不许出现「@ 有了、图发不出去」
 * （模式收不了参考却插了芯片）或「参考绑了、提示词里看不见」。
 */
describe('普查：所有档案 × 所有起步模式，@ 与绑定一起成、一起不成', () => {
  const imageSlotKinds = new Set(['image_ref'])
  for (const archetype of MODEL_ARCHETYPES.filter((candidate) => candidate.kind === 'video' || candidate.kind === 'image')) {
    const modelKey = archetype.identifierPatterns?.[0] ?? archetype.id
    for (const mode of archetype.modes) {
      it(`${archetype.id} · ${mode.id}`, () => {
        const before: PlanShot = { index: 1, shotId: 'shot-1', durationSec: 5, anchorIds: [], prompt: '林薇冲进后巷', modelKey, modeId: mode.id }
        const resolvedHere = resolveArchetypeForModel({ modelKey })
        if (resolvedHere?.id !== archetype.id) return // 识别串命中了别的档案：这一格不归它
        const next = autoReferenceShot(before, [LINWEI], true)
        const mentioned = mentionUrlsInOrder(next.prompt).includes(LINWEI.url)
        const finalMode = resolvedHere.modes.find((candidate) => candidate.id === (next.modeId ?? resolvedHere.defaultModeId))
        const bound = Object.entries(next.referenceBindings ?? {}).some(([slot, bindings]) => imageSlotKinds.has(slot) && bindings.some((binding) => binding.url === LINWEI.url))
        expect(mentioned, '@ 与绑定必须一起出现或一起不出现').toBe(bound)
        if (bound) expect(finalMode?.slots.some((slot) => slot.kind === 'image_ref'), '绑上了却落在收不了参考图的模式里（发不出去）').toBe(true)
      })
    }
  }
})
