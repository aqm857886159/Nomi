import { describe, expect, it } from 'vitest'
import {
  frameRowTolerance,
  isFrameTimelineEligibleKind,
  orderFrameMembersForReading,
  planFrameTimelineUnits,
  type FrameTimelineMember,
} from './frameTimelinePlan'
import type { GenerationCanvasNode } from './generationCanvasTypes'

function node(id: string, kind: GenerationCanvasNode['kind'], withResult = true): GenerationCanvasNode {
  return {
    id,
    kind,
    title: id,
    position: { x: 0, y: 0 },
    ...(withResult
      ? { result: { id: `${id}-r`, type: kind === 'image' ? 'image' : 'video', url: `file:///${id}.mp4`, createdAt: 1 } }
      : {}),
  } as GenerationCanvasNode
}

function member(
  id: string,
  kind: GenerationCanvasNode['kind'],
  x: number,
  y: number,
  size = { width: 300, height: 200 },
  withResult = true,
): FrameTimelineMember {
  return { node: node(id, kind, withResult), rect: { x, y, ...size } }
}

describe('isFrameTimelineEligibleKind — 只收视频 / 剪辑', () => {
  it('视频与剪辑进，图片和文字不进', () => {
    // 框里的图和文字是参考与说明，不是这一段片子的画面。把它们也排进去，
    // 用户每次都要在轴上删掉一堆——那正是「整框进时间轴」想省掉的那件事。
    expect(isFrameTimelineEligibleKind(node('v', 'video'))).toBe(true)
    expect(isFrameTimelineEligibleKind(node('c', 'clip'))).toBe(true)
    expect(isFrameTimelineEligibleKind(node('i', 'image'))).toBe(false)
    expect(isFrameTimelineEligibleKind(node('t', 'text'))).toBe(false)
  })
})

describe('orderFrameMembersForReading — 从左到右、从上到下', () => {
  it('同一行按 x 排，行与行按 y 排', () => {
    const ordered = orderFrameMembersForReading([
      member('b', 'video', 400, 0),
      member('d', 'video', 400, 300),
      member('a', 'video', 0, 0),
      member('c', 'video', 0, 300),
    ])
    expect(ordered.map((item) => item.node.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('上下略微错开仍算同一行——行带按成员高度中位数派生，不写死像素', () => {
    // 用户是用手摆的，同一行不会像素级对齐。固定阈值在矮卡上会把一行拆成两行、
    // 在高卡上会把两行并成一行；「错开超过半张卡才算换行」对两种尺寸都说得通。
    const height = 200
    const ordered = orderFrameMembersForReading([
      member('right', 'video', 400, height / 2 - 10, { width: 300, height }),
      member('left', 'video', 0, 0, { width: 300, height }),
    ])
    expect(ordered.map((item) => item.node.id)).toEqual(['left', 'right'])
  })

  it('错开超过半张卡就换行——此时靠下那个即使更靠左也排在后面', () => {
    const height = 200
    const ordered = orderFrameMembersForReading([
      member('below-left', 'video', 0, height, { width: 300, height }),
      member('above-right', 'video', 400, 0, { width: 300, height }),
    ])
    expect(ordered.map((item) => item.node.id)).toEqual(['above-right', 'below-left'])
  })

  it('完全同坐标时按 id 兜底——同输入必同输出', () => {
    const first = orderFrameMembersForReading([member('z', 'video', 0, 0), member('a', 'video', 0, 0)])
    const second = orderFrameMembersForReading([member('a', 'video', 0, 0), member('z', 'video', 0, 0)])
    expect(first.map((item) => item.node.id)).toEqual(['a', 'z'])
    expect(second.map((item) => item.node.id)).toEqual(['a', 'z'])
  })

  it('行带在没有成员时是 0，不产生 NaN', () => {
    expect(frameRowTolerance([])).toBe(0)
  })
})

describe('planFrameTimelineUnits — 排哪些、什么顺序', () => {
  it('按阅读序排，图与文字进 skipped 并说清原因', () => {
    const plan = planFrameTimelineUnits([
      member('img', 'image', 400, 0),
      member('v2', 'video', 800, 0),
      member('v1', 'video', 0, 0),
    ])
    expect(plan.units.map((unit) => unit.nodeId)).toEqual(['v1', 'v2'])
    expect(plan.skipped).toEqual([{ nodeId: 'img', reason: 'not_moving_image' }])
  })

  it('shotIndex 是阅读序的名次（0,1,2…），不是镜号', () => {
    // 框里的东西没有镜号——用户是把它们**摆**成一段戏的，顺序的真相就是摆放位置。
    const plan = planFrameTimelineUnits([member('b', 'video', 400, 0), member('a', 'video', 0, 0)])
    expect(plan.units).toEqual([
      { nodeId: 'a', shotIndex: 0, role: 'video' },
      { nodeId: 'b', shotIndex: 1, role: 'video' },
    ])
  })

  it('种类对但还没生成 → 跳过并说清是「没产物」，不与「不是画面」混为一谈', () => {
    const plan = planFrameTimelineUnits([member('pending', 'video', 0, 0, { width: 300, height: 200 }, false)])
    expect(plan.units).toEqual([])
    expect(plan.skipped).toEqual([{ nodeId: 'pending', reason: 'no_result' }])
  })

  it('一个都不合格时 units 为空——调用方据此给「框里没有可进时间轴的画面」那条提示', () => {
    const plan = planFrameTimelineUnits([member('img', 'image', 0, 0), member('txt', 'text', 400, 0)])
    expect(plan.units).toEqual([])
    expect(plan.skipped).toHaveLength(2)
  })
})
