import { describe, expect, it } from 'vitest'
import { composeComposerPanTarget, shouldHonourComposerPanRequest } from './useComposerVisibilityPan'

describe('composeComposerPanTarget', () => {
  it('没有别的动画在飞：目标 = 当前 + deltaY', () => {
    const target = composeComposerPanTarget({
      current: { x: 0, y: 0 },
      pending: { zoom: 1, offset: { x: 0, y: 0 } },
      deltaY: -60,
    })
    expect(target).toEqual({ zoom: 1, offset: { x: 0, y: -60 } })
  })

  it('新建节点的横向露出正在飞：x 跟着它走，y 仍按当前几何量出来的增量', () => {
    // 阳性对照：#488 之后 video 卡被常驻 Agent 面板挡住 232px，露出动画刚起步就被 composer 让位打断，
    // 打断者若从当前位置算目标，x 就被抹回 0。
    const target = composeComposerPanTarget({
      current: { x: -3, y: 0 },
      pending: { zoom: 1, offset: { x: -232, y: 0 } },
      deltaY: -60,
    })
    expect(target).toEqual({ zoom: 1, offset: { x: -232, y: -60 } })
  })

  it('zoom 取正在去的目标，不回退到 1', () => {
    const target = composeComposerPanTarget({
      current: { x: 0, y: 10 },
      pending: { zoom: 0.5, offset: { x: 40, y: 10 } },
      deltaY: 20,
    })
    expect(target.zoom).toBe(0.5)
    expect(target.offset).toEqual({ x: 40, y: 30 })
  })
})

describe('shouldHonourComposerPanRequest', () => {
  const alive = (id: string) => id === 'image'

  it('有限非零 delta、节点还在 → 执行', () => {
    expect(shouldHonourComposerPanRequest({ nodeId: 'image', deltaY: -60 }, alive)).toBe(true)
  })

  it('节点已被撤销删掉 → 丢掉（阳性对照：复制变体后 Cmd+Z，迟到的让位把视口拖到 y=-319，视频卡露不出「2 版」）', () => {
    expect(shouldHonourComposerPanRequest({ nodeId: 'dup', deltaY: -60 }, alive)).toBe(false)
  })

  it('没带 nodeId 的旧请求照旧只看 delta', () => {
    expect(shouldHonourComposerPanRequest({ deltaY: 12 }, alive)).toBe(true)
    expect(shouldHonourComposerPanRequest({ deltaY: 0 }, alive)).toBe(false)
    expect(shouldHonourComposerPanRequest({ deltaY: Number.NaN }, alive)).toBe(false)
    expect(shouldHonourComposerPanRequest(undefined, alive)).toBe(false)
  })
})
