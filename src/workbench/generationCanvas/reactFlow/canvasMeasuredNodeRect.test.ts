import { describe, expect, it } from 'vitest'
import type { InternalNode } from '@xyflow/react'
import { measuredRectFromInternalNode } from './canvasMeasuredNodeRect'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'

type Probe = Pick<InternalNode<GenerationFlowNode>, 'internals' | 'measured'>

function internal(x: number, y: number, measured: { width?: number; height?: number }): Probe {
  return {
    measured,
    internals: { positionAbsolute: { x, y }, z: 0, userNode: {} as GenerationFlowNode },
  } as unknown as Probe
}

describe('measuredRectFromInternalNode — 命中判定的尺寸只认内核测量值', () => {
  it('取 internals.positionAbsolute + measured，而不是节点的声明尺寸', () => {
    // 声明尺寸是 360×432（style 上写的），实际渲染出来是 360×520（内容撑高了）。
    // 判定必须用后者——否则用户看到卡片下缘已经进框，判定线却停在 432 那一行。
    expect(measuredRectFromInternalNode(internal(100, 50, { width: 360, height: 520 })))
      .toEqual({ x: 100, y: 50, width: 360, height: 520 })
  })

  it('还没量到尺寸就返回 null，不回退到声明尺寸', () => {
    expect(measuredRectFromInternalNode(internal(0, 0, {}))).toBeNull()
    expect(measuredRectFromInternalNode(internal(0, 0, { width: 360 }))).toBeNull()
    expect(measuredRectFromInternalNode(internal(0, 0, { width: 0, height: 0 }))).toBeNull()
  })

  it('坐标不是有限数就返回 null（NaN 视口那一族的下游防线）', () => {
    expect(measuredRectFromInternalNode(internal(Number.NaN, 0, { width: 10, height: 10 }))).toBeNull()
  })

  it('内核里没有这个节点（尚未挂载 / 已被剔除）返回 null', () => {
    expect(measuredRectFromInternalNode(undefined)).toBeNull()
    expect(measuredRectFromInternalNode(null)).toBeNull()
  })
})
