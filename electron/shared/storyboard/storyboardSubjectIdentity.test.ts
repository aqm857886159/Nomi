// 分镜主体身份（锚 id / 镜头 id / 镜号）唯一 owner 的类级测试：不管主体从哪条路来（Agent 首建、Agent 补镜头、
// 手建加锚、外部宿主自带 id），号段都分开、镜号只数镜头、「第 N 镜」只落到镜头。
import { describe, expect, it } from 'vitest'

import type { PlanAnchor, PlanShot, StoryboardPlan } from './storyboardPlan'
import {
  appendStoryboardSubjects, nextStoryboardSubjectIds, StoryboardSubjectIdentityError, storyboardSubjectAt,
} from './storyboardSubjectIdentity'

const anchor = (id: string, name = id): PlanAnchor => ({ id, kind: 'character', carrier: 'visual', name, description: name })
const shot = (index: number, shotId?: string, prompt = `p${index}`): PlanShot =>
  ({ index, ...(shotId ? { shotId } : {}), durationSec: 0, anchorIds: [], prompt })
const plan = (anchors: PlanAnchor[], shots: PlanShot[]): StoryboardPlan => ({ title: 't', anchors, shots })

describe('发号：锚和镜头各数各的', () => {
  it('混排的一批（锚、锚、镜、镜）发出 anchor-1、anchor-2、shot-1、shot-2', () => {
    expect(nextStoryboardSubjectIds(plan([], []), [{ role: 'anchor' }, { role: 'anchor' }, {}, { role: 'shot' }]))
      .toEqual(['anchor-1', 'anchor-2', 'shot-1', 'shot-2'])
  })

  it('接在已有方案后面：从已有的数往后数，跳过被占的号（含旧镜头按镜号派生的身份）', () => {
    const existing = plan([anchor('anchor-1'), anchor('anchor-3')], [shot(1, 'shot-1'), shot(2)])
    expect(nextStoryboardSubjectIds(existing, [{}, { role: 'anchor' }, {}])).toEqual(['shot-3', 'anchor-4', 'shot-4'])
  })

  it('自带的 id 照收，但不许跨号段、不许重复', () => {
    expect(nextStoryboardSubjectIds(plan([], []), [{ role: 'anchor', shotId: 'hero' }, { shotId: 'execution-id' }])).toEqual(['hero', 'execution-id'])
    expect(() => nextStoryboardSubjectIds(plan([], []), [{ role: 'anchor', shotId: 'shot-1' }])).toThrow(StoryboardSubjectIdentityError)
    expect(() => nextStoryboardSubjectIds(plan([], []), [{ shotId: 'anchor-2' }])).toThrow(/reference cards/)
    expect(() => nextStoryboardSubjectIds(plan([], []), [{ shotId: 'dup' }, { shotId: 'dup' }])).toThrow(/镜头 id 重复/)
  })
})

describe('接行：镜号 = 在镜头里的位置，锚不占号', () => {
  it('首建（id 已发）：两张锚在前也是 1、2', () => {
    const { plan: built, added } = appendStoryboardSubjects(plan([], []),
      [anchor('anchor-1'), anchor('anchor-2'), shot(0, 'shot-1'), shot(0, 'shot-2')], { assignIds: false })
    expect(built.shots.map(value => value.index)).toEqual([1, 2])
    expect(added).toEqual([
      { role: 'anchor', id: 'anchor-1', title: 'anchor-1' }, { role: 'anchor', id: 'anchor-2', title: 'anchor-2' },
      { role: 'shot', id: 'shot-1', row: 1 }, { role: 'shot', id: 'shot-2', row: 2 },
    ])
  })

  it('补进旧方案（镜号从 3 起、锚占着 shot-1）：整份归位成 1..N，新行接着数，旧行身份不变', () => {
    const legacy = plan([anchor('shot-1')], [shot(3, 'shot-3'), shot(4, 'shot-4')])
    const { plan: next, added } = appendStoryboardSubjects(legacy, [shot(0, 'pending'), anchor('pending-a')], { assignIds: true })
    expect(next.shots.map(value => [value.index, value.shotId])).toEqual([[1, 'shot-3'], [2, 'shot-4'], [3, 'shot-5']])
    expect(next.anchors.map(value => value.id)).toEqual(['shot-1', 'anchor-2'])
    expect(added.find(value => value.role === 'shot')).toEqual({ role: 'shot', id: 'shot-5', row: 3 })
  })
})

describe('寻址：「第 N 镜」只落到镜头', () => {
  it('新方案：shot-1 是第一个镜头，anchor-1 是参考卡', () => {
    const value = plan([anchor('anchor-1')], [shot(1, 'shot-1'), shot(2, 'shot-2')])
    expect(storyboardSubjectAt(value, 'shot-1')).toMatchObject({ kind: 'shot', shot: { prompt: 'p1' } })
    expect(storyboardSubjectAt(value, 'anchor-1')).toMatchObject({ kind: 'anchor' })
  })

  it('旧方案里参考卡占着 shot-1：不当作参考卡的地址，如实列出真实镜头', () => {
    const value = plan([anchor('shot-1')], [shot(3, 'shot-3')])
    expect(storyboardSubjectAt(value, 'shot-1')).toEqual({ kind: 'missing', anchorHoldsShotNumber: true, shots: [{ id: 'shot-3', row: 3 }] })
  })

  it('没有 shotId 的手建镜头按镜号派生身份，照样找得到', () => {
    expect(storyboardSubjectAt(plan([], [shot(1)]), 'shot-1')).toMatchObject({ kind: 'shot' })
  })
})
