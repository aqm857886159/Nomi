import { describe, expect, it } from 'vitest'
import { parseDirectorPlan, type DirectorPlan } from './directorPlanSchema'
import { applyDirectorPlanEdits, canonicalDirectorPlan, directorPlanRevision } from './planPatch'

function cafe(): DirectorPlan {
  const parsed = parseDirectorPlan({
    scene: { environment: 'day', template: 'room', tags: ['咖啡馆'] },
    actors: [
      { id: 'lin', kind: 'person', desc: '林', placement: { relation: 'near', ref: 'bob' } },
      { id: 'bob', kind: 'person', desc: '鲍勃', placement: { relation: 'near', ref: 'lin' } },
    ],
    shots: [
      { id: 'a', window: [0, 3], transitionIn: 'cut', subject: 'lin', size: '中景', angle: { over_shoulder: 'bob' }, height: 'eye', move: { kind: 'static' } },
      { id: 'b', window: [3, 6], transitionIn: 'cut', subject: 'bob', size: '中景', angle: { over_shoulder: 'lin' }, height: 'eye', move: { kind: 'static' } },
    ],
  })
  if (!parsed.success) throw new Error(parsed.error.message)
  return canonicalDirectorPlan(parsed.data)
}

describe('applyDirectorPlanEdits', () => {
  it('replaces one named shot field and reports exactly that shot as touched', () => {
    const result = applyDirectorPlanEdits(cafe(), [{ op: 'replace', path: '/shots/b/size', value: '特写' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.shots.find((shot) => shot.id === 'b')?.size).toBe('特写')
    expect(result.plan.shots.find((shot) => shot.id === 'a')?.size).toBe('中景')
    expect(result.touched).toEqual(['shot:b'])
    expect(result.unchanged).toBe(false)
  })

  it('treats an edit that restates the current plan as unchanged with no touched entities', () => {
    const result = applyDirectorPlanEdits(cafe(), [{ op: 'replace', path: '/shots/a/size', value: '中景' }])
    expect(result).toMatchObject({ ok: true, unchanged: true, touched: [] })
  })

  it('normalizes lossless synonyms before comparing (中文同义词 / 分隔符)', () => {
    const result = applyDirectorPlanEdits(cafe(), [{ op: 'replace', path: '/scene/environment', value: '白天' }])
    expect(result).toMatchObject({ ok: true, unchanged: true })
  })

  it('adds a shot by name in time order and removes one', () => {
    const added = applyDirectorPlanEdits(cafe(), [{ op: 'add', path: '/shots/push', value: { window: [1, 2], transitionIn: 'cut', subject: 'lin', size: '特写', angle: 'front', height: 'eye', move: { kind: 'push_in' } } }])
    expect(added.ok && added.plan.shots.map((shot) => shot.id)).toEqual(['a', 'push', 'b'])
    const removed = applyDirectorPlanEdits(cafe(), [{ op: 'remove', path: '/shots/a' }])
    expect(removed.ok && removed.plan.shots.map((shot) => shot.id)).toEqual(['b'])
  })

  it('rejects the whole patch when the result breaks a cross-field rule (no half-applied plan)', () => {
    const result = applyDirectorPlanEdits(cafe(), [
      { op: 'replace', path: '/shots/a/size', value: '特写' },
      { op: 'remove', path: '/actors/bob' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toMatch(/unknown subject bob|unknown placement ref bob/)
  })

  it('names the bad path and why, for every unsupported shape', () => {
    const result = applyDirectorPlanEdits(cafe(), [
      { op: 'replace', path: '/shots/zzz/size', value: '特写' },
      { op: 'replace', path: 'shots/a', value: {} },
      { op: 'replace', path: '/shots/a/id', value: 'x' },
      { op: 'add', path: '/shots/a', value: { window: [0, 1] } },
      { op: 'replace', path: '/timeline/a', value: 1 },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toHaveLength(5)
    expect(result.errors[0]).toContain('no shot named zzz')
    expect(result.errors[3]).toContain('already exists')
  })

  it('replaces one actor blocking list by actor name', () => {
    const result = applyDirectorPlanEdits(cafe(), [{ op: 'add', path: '/blocking/lin', value: [{ verb: 'walk_to', target: 'bob', window: [0, 2] }] }])
    expect(result.ok && result.plan.blocking).toEqual([{ actor: 'lin', verb: 'walk_to', target: 'bob', window: [0, 2] }])
    expect(result.ok && result.touched).toEqual(['blocking:lin'])
  })

  it('derives a content revision: same plan same id, any change a new id', () => {
    const plan = cafe()
    expect(directorPlanRevision(plan)).toBe(directorPlanRevision(cafe()))
    const changed = applyDirectorPlanEdits(plan, [{ op: 'replace', path: '/shots/b/size', value: '特写' }])
    expect(changed.ok && directorPlanRevision(changed.plan)).not.toBe(directorPlanRevision(plan))
    expect(directorPlanRevision(plan)).toMatch(/^dplan-[0-9a-f]{16}$/)
  })
})
