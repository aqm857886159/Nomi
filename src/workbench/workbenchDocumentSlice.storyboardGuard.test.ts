import { beforeEach, describe, expect, it, vi } from 'vitest'

const logs = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../desktop/rendererLog', () => ({ logRendererWarn: logs.warn, logRendererError: vi.fn(), logRendererInfo: vi.fn() }))

import { useWorkbenchStore } from './workbenchStore'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'

/**
 * 设计卡 D-main-thread-unblock ★9 A1：分镜设计的写入口自己校验（`storyboardDesignSchema`，存盘用的同一份判据），
 * 不过就拒写、状态一个字节不变；日志只记字段路径。
 */
const good: StoryboardPlan = { title: 'plan', anchors: [], shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'A' }] }
const withDuration = (durationSec: number): StoryboardPlan => ({ ...good, shots: [{ ...good.shots[0], durationSec }] })
const designs = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc ?? []

beforeEach(() => {
  logs.warn.mockClear()
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
})

describe('storyboard write doors refuse what cannot be saved', () => {
  it('a plan whose durationSec is NaN is refused and the state is unchanged', () => {
    const store = useWorkbenchStore.getState()
    const added = store.addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: good, identity: { id: 'd1', title: 'plan' } })
    expect(added?.id).toBe('d1')
    const before = designs()
    expect(store.setStoryboardPlan(withDuration(Number.NaN), 'doc', 'd1', true)).toBeNull()
    expect(designs()).toBe(before)
    expect(designs()[0].plan.shots[0].durationSec).toBe(3)
  })

  it('adding a design with an unsavable plan creates nothing', () => {
    const store = useWorkbenchStore.getState()
    expect(store.addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: withDuration(Number.POSITIVE_INFINITY), identity: { id: 'd2', title: 'x' } })).toBeNull()
    expect(designs()).toEqual([])
  })

  // 类级矩阵：每种存不下的取值 × 每个写入口，都拒写、状态不变（同类问题从另一个入口回来的路）。
  const unsavable: Array<[string, number]> = [['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['-Infinity', Number.NEGATIVE_INFINITY]]
  const doors: Array<[string, (plan: StoryboardPlan) => unknown]> = [
    ['addStoryboardDesign', plan => useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: plan, identity: { id: 'd9', title: 'x' } })],
    ['setStoryboardPlan', plan => useWorkbenchStore.getState().setStoryboardPlan(plan, 'doc', 'd1', true)],
  ]
  it.each(unsavable.flatMap(([label, value]) => doors.map(([door, write]) => [label, door, value, write] as const)))(
    'matrix: durationSec %s through %s is refused and leaves the store untouched',
    (_label, _door, value, write) => {
      useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: good, identity: { id: 'd1', title: 'plan' } })
      const before = designs()
      expect(write(withDuration(value))).toBeNull()
      expect(designs()).toBe(before)
    },
  )

  it('a refusal logs the field path and never the creator\'s words', () => {
    const store = useWorkbenchStore.getState()
    store.addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: good, identity: { id: 'd1', title: 'plan' } })
    store.setStoryboardPlan({ ...withDuration(Number.NaN), title: '私有标题' }, 'doc', 'd1', true)
    const text = JSON.stringify(logs.warn.mock.calls)
    expect(text).toContain('storyboard-write-rejected')
    expect(text).toContain('durationSec')
    expect(text).not.toContain('私有标题')
  })

  it('undoing a delete cannot bring back a design that cannot be saved (restoreStoryboardDesign is a write door too)', () => {
    const store = useWorkbenchStore.getState()
    store.addStoryboardDesign({ initiator: 'user', documentId: 'doc', source: good, identity: { id: 'd1', title: 'plan' } })
    const removed = designs()[0]
    store.deleteStoryboardDesign('d1', 'doc')
    expect(designs()).toEqual([])
    store.restoreStoryboardDesign({ ...removed, plan: withDuration(Number.NaN) }, 'doc', 0)
    expect(designs()).toEqual([])
    store.restoreStoryboardDesign(removed, 'doc', 0)
    expect(designs().map(design => design.id)).toEqual(['d1'])
  })

  it('an ordinary edit still goes through', () => {
    const store = useWorkbenchStore.getState()
    store.addStoryboardDesign({ initiator: 'user', documentId: 'doc', source: good, identity: { id: 'd1', title: 'plan' } })
    expect(store.setStoryboardPlan(withDuration(8), 'doc', 'd1', true)?.id).toBe('d1')
    expect(designs()[0].plan.shots[0].durationSec).toBe(8)
  })
})
