import { describe, expect, it } from 'vitest'
import { planCanvasFrameMembership, type CanvasNodeRectProbe } from './useCanvasFrameMembership'
import type { CanvasGroupBox } from './GroupFrame'
import type { NodeGroup } from '../model/generationCanvasTypes'

function box(id: string, rect: { left: number; top: number; width: number; height: number }, nodeIds: string[]): CanvasGroupBox {
  return {
    group: { id, name: id, nodeIds, categoryId: 'c1' } as unknown as NodeGroup,
    ...rect,
    memberCount: nodeIds.length,
    empty: nodeIds.length === 0,
  }
}

/** 「内核测量到的矩形」的假件：测试里由它决定判定看到的是哪条边。 */
function probe(rects: Record<string, { x: number; y: number; width: number; height: number } | null>): CanvasNodeRectProbe {
  return (nodeId) => rects[nodeId] ?? null
}

const frame = box('g1', { left: 0, top: 0, width: 400, height: 400 }, [])

describe('planCanvasFrameMembership — 判定线跟着测量尺寸走', () => {
  it('中心点进框就入组', () => {
    const plan = planCanvasFrameMembership(['n1'], [frame], probe({ n1: { x: 100, y: 100, width: 200, height: 100 } }))
    expect(plan).toMatchObject({ groupId: 'g1', change: 'join', nodeIds: ['n1'], nextCount: 1 })
  })

  it('中心点出框，成员退组', () => {
    const withMember = box('g1', { left: 0, top: 0, width: 400, height: 400 }, ['n1'])
    const plan = planCanvasFrameMembership(['n1'], [withMember], probe({ n1: { x: 600, y: 600, width: 200, height: 100 } }))
    expect(plan).toMatchObject({ groupId: 'g1', change: 'leave', nodeIds: ['n1'], nextCount: 0 })
  })

  it('**同一位置、同一声明尺寸，测量尺寸不同 → 判定不同**（R29 §6.1 要防的那条分裂）', () => {
    // 节点左上角在 (300, 300)。声明尺寸 100×100 时中心在 (350,350)，还在 400×400 的框内；
    // 实际渲染成 400×400（内容撑开）时中心跑到 (500,500)，已经出框。
    // 用户看到的是后者那条边，判定必须跟着它走。
    const declaredSized = planCanvasFrameMembership(['n1'], [frame], probe({ n1: { x: 300, y: 300, width: 100, height: 100 } }))
    const measuredSized = planCanvasFrameMembership(['n1'], [frame], probe({ n1: { x: 300, y: 300, width: 400, height: 400 } }))
    expect(declaredSized).toMatchObject({ change: 'join' })
    expect(measuredSized).toBeNull()
  })

  it('内核还没量到这个节点就当没发生，不拿声明尺寸凑一个假判定', () => {
    expect(planCanvasFrameMembership(['n1'], [frame], probe({ n1: null }))).toBeNull()
  })

  it('一次拖多个：进优先于出，计数把整批算进去', () => {
    const other = box('g2', { left: 800, top: 0, width: 400, height: 400 }, ['n1', 'n2'])
    const plan = planCanvasFrameMembership(['n1', 'n2'], [frame, other], probe({
      n1: { x: 100, y: 100, width: 100, height: 100 },
      n2: { x: 150, y: 150, width: 100, height: 100 },
    }))
    expect(plan).toMatchObject({ groupId: 'g1', change: 'join', nextCount: 2 })
    expect(plan?.nodeIds.sort()).toEqual(['n1', 'n2'])
  })
})
