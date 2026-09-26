import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { arrivalBounds, isNodeSeen, nextUnseenArrivals, resolveArrivalHint } from './canvasArrivalModel'

const node = (id: string, x: number, y: number, categoryId = 'shots'): GenerationCanvasNode =>
  ({ id, kind: 'image', title: id, position: { x, y }, size: { width: 200, height: 112 }, categoryId }) as GenerationCanvasNode

/** 用户眼前那块：画布坐标 (0,0) 起 1000×600。 */
const visible = { x: 0, y: 0, width: 1000, height: 600 }

describe('nextUnseenArrivals', () => {
  it('the first snapshot after opening a project is the baseline, not arrivals', () => {
    const nodes = [node('a', 5000, 0), node('b', 0, 5000)]
    expect(nextUnseenArrivals({ previousIds: null, unseen: [], nodes, activeCategoryId: 'shots', visible })).toEqual([])
  })

  it('reported case: a paid-card shot landing off-screen stays pending until it is seen', () => {
    const before = [node('a', 100, 100)]
    const after = [...before, node('shot', 2400, 100)]
    const pending = nextUnseenArrivals({ previousIds: new Set(['a']), unseen: [], nodes: after, activeCategoryId: 'shots', visible })
    expect(pending).toEqual(['shot'])
    // 用户自己拖过去（或点提示过去）→ 看见了 → 不再提示
    const panned = { ...visible, x: 2000 }
    expect(nextUnseenArrivals({ previousIds: new Set(['a', 'shot']), unseen: pending, nodes: after, activeCategoryId: 'shots', visible: panned })).toEqual([])
  })

  it('class: a node created inside the view is seen at once; deleted arrivals drop out', () => {
    const after = [node('a', 100, 100), node('here', 300, 200), node('far', 3000, 200)]
    const pending = nextUnseenArrivals({ previousIds: new Set(['a']), unseen: [], nodes: after, activeCategoryId: 'shots', visible })
    expect(pending).toEqual(['far'])
    const afterDelete = after.filter((entry) => entry.id !== 'far')
    expect(nextUnseenArrivals({ previousIds: new Set(after.map((entry) => entry.id)), unseen: pending, nodes: afterDelete, activeCategoryId: 'shots', visible })).toEqual([])
  })
})

describe('resolveArrivalHint', () => {
  it('points at the side where the unseen nodes are', () => {
    const nodes = [node('r', 2400, 200), node('l', -900, 200), node('d', 400, 1800), node('u', 400, -1500)]
    const cases: Array<[string, string]> = [['r', 'right'], ['l', 'left'], ['d', 'down'], ['u', 'up']]
    for (const [id, direction] of cases) {
      const hint = resolveArrivalHint({ unseen: [id], nodes, activeCategoryId: 'shots', visible })
      expect(hint).toMatchObject({ kind: 'direction', direction, count: 1, nodeIds: [id] })
    }
  })

  it('names the other category when the new nodes live there, never switching by itself', () => {
    const nodes = [node('c1', 0, 0, 'cast'), node('c2', 300, 0, 'cast')]
    expect(resolveArrivalHint({ unseen: ['c1', 'c2'], nodes, activeCategoryId: 'shots', visible }))
      .toMatchObject({ kind: 'category', categoryId: 'cast', count: 2 })
  })

  it('no unseen nodes → no hint', () => {
    expect(resolveArrivalHint({ unseen: [], nodes: [node('a', 0, 0)], activeCategoryId: 'shots', visible })).toBeNull()
  })
})

describe('seen / bounds', () => {
  it('a node counts as seen only in the active category with its centre on screen', () => {
    expect(isNodeSeen(node('a', 100, 100), 'shots', visible)).toBe(true)
    expect(isNodeSeen(node('a', 100, 100, 'cast'), 'shots', visible)).toBe(false)
    expect(isNodeSeen(node('a', 950, 100), 'shots', visible)).toBe(false)
  })

  it('bounds cover every arrival for the jump', () => {
    // 尺寸读节点尺寸的唯一解析口（resolveNodeVisualSize 会把过小的持久化尺寸拉到下限），这里不抄数字。
    const size = resolveNodeVisualSize(node('b', 400, 300))
    expect(arrivalBounds(['a', 'b'], [node('a', 0, 0), node('b', 400, 300)])).toEqual({ x: 0, y: 0, width: 400 + size.width, height: 300 + size.height })
  })
})
