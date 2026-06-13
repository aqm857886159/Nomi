import { describe, expect, it } from 'vitest'
import type { StoryboardPlan } from './storyboardPlan'
import {
  addAnchor,
  addShot,
  changeAnchorKind,
  danglingAnchorIdsForShot,
  defaultCarrierForKind,
  makeAnchorId,
  moveShot,
  removeAnchor,
  removeShotAt,
  toggleShotAnchor,
  validatePlan,
} from './storyboardPlanEdits'

const base = (): StoryboardPlan => ({
  title: 't',
  anchors: [
    { id: 'anchor-1', kind: 'character', name: '林夏', description: 'd', carrier: 'visual' },
    { id: 'anchor-2', kind: 'style', name: '全片', description: 's', carrier: 'text', scope: 'all' },
  ],
  shots: [
    { index: 1, durationSec: 5, anchorIds: ['anchor-1', 'anchor-2'], prompt: 'p1' },
    { index: 2, durationSec: 8, anchorIds: ['anchor-1'], prompt: 'p2' },
  ],
})

describe('storyboardPlanEdits — 锚', () => {
  it('addAnchor 按类型给默认 carrier（style=text，其余=visual）+ 唯一 id', () => {
    const p1 = addAnchor(base(), 'scene')
    expect(p1.anchors.at(-1)).toMatchObject({ kind: 'scene', carrier: 'visual', name: '' })
    const p2 = addAnchor(p1, 'style')
    expect(p2.anchors.at(-1)).toMatchObject({ kind: 'style', carrier: 'text', scope: 'all' })
    const ids = p2.anchors.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length) // 无重复
  })

  it('makeAnchorId 避开已有 id', () => {
    const plan = { ...base(), anchors: [{ id: 'anchor-3', kind: 'prop', name: 'x', description: '', carrier: 'visual' } as const] }
    expect(plan.anchors.some((a) => a.id === makeAnchorId(plan))).toBe(false)
  })

  it('changeAnchorKind 改风格 → carrier 跟随成 text', () => {
    expect(defaultCarrierForKind('style')).toBe('text')
    const p = changeAnchorKind(base(), 'anchor-1', 'style')
    expect(p.anchors[0]).toMatchObject({ kind: 'style', carrier: 'text' })
  })

  it('removeAnchor 不擦引用它的镜头（失效引用留给校验标红）', () => {
    const p = removeAnchor(base(), 'anchor-1')
    expect(p.anchors.map((a) => a.id)).toEqual(['anchor-2'])
    expect(p.shots[0].anchorIds).toContain('anchor-1') // 镜头引用未被静默清掉
    expect(danglingAnchorIdsForShot(p, p.shots[0])).toEqual(['anchor-1'])
  })
})

describe('storyboardPlanEdits — 镜头', () => {
  it('addShot 追加并续号', () => {
    const p = addShot(base())
    expect(p.shots.map((s) => s.index)).toEqual([1, 2, 3])
    expect(p.shots.at(-1)).toMatchObject({ index: 3, durationSec: 5, anchorIds: [], prompt: '' })
  })

  it('removeShotAt 删除后镜号重排连续', () => {
    const p = removeShotAt(base(), 0)
    expect(p.shots.map((s) => s.index)).toEqual([1])
    expect(p.shots[0].prompt).toBe('p2') // 原镜2 成了镜1
  })

  it('moveShot 重排后镜号连续；越界 no-op', () => {
    const p = moveShot(base(), 1, 0)
    expect(p.shots.map((s) => [s.index, s.prompt])).toEqual([[1, 'p2'], [2, 'p1']])
    expect(moveShot(base(), 0, 9)).toEqual(base()) // 越界不动
  })

  it('toggleShotAnchor 勾/取消引用', () => {
    const added = toggleShotAnchor(base(), 1, 'anchor-2') // 镜2 原无 anchor-2
    expect(added.shots[1].anchorIds).toEqual(['anchor-1', 'anchor-2'])
    const removed = toggleShotAnchor(added, 1, 'anchor-1')
    expect(removed.shots[1].anchorIds).toEqual(['anchor-2'])
  })
})

describe('storyboardPlanEdits — 校验', () => {
  it('全合法方案 → 无 issue', () => {
    expect(validatePlan(base())).toEqual([])
  })

  it('删锚造成的失效引用被逐镜捕获', () => {
    const p = removeAnchor(base(), 'anchor-1')
    const issues = validatePlan(p)
    expect(issues).toContainEqual({ kind: 'dangling-ref', shotIndex: 1, anchorId: 'anchor-1' })
    expect(issues).toContainEqual({ kind: 'dangling-ref', shotIndex: 2, anchorId: 'anchor-1' })
  })

  it('空提示词镜 / 无镜 / 视觉锚无名 各自拦截', () => {
    expect(validatePlan({ title: 't', anchors: [], shots: [] })).toContainEqual({ kind: 'no-shots' })
    const noPrompt = { ...base(), shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '  ' }] }
    expect(validatePlan(noPrompt)).toContainEqual({ kind: 'empty-shot-prompt', shotIndex: 1 })
    const noName = { ...base(), anchors: [{ id: 'anchor-1', kind: 'character', name: '', description: '', carrier: 'visual' } as const] }
    expect(validatePlan(noName)).toContainEqual({ kind: 'anchor-no-name', anchorId: 'anchor-1' })
  })

  it('文本锚无名不拦（不建卡，无需标题）', () => {
    const textNoName = { ...base(), anchors: [{ id: 'anchor-2', kind: 'style', name: '', description: 's', carrier: 'text' } as const], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'p' }] }
    expect(validatePlan(textNoName).some((i) => i.kind === 'anchor-no-name')).toBe(false)
  })
})
