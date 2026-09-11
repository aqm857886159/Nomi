import { describe, expect, it } from 'vitest'
import { resolveAnchoredPlacement, type AnchoredRect } from './anchoredPlacement'

/** 1000×800 的舞台，锚点是中间一个 200×200 的节点。 */
const stage: AnchoredRect = { left: 0, top: 0, right: 1000, bottom: 800 }
const centerNode: AnchoredRect = { left: 400, top: 300, right: 600, bottom: 500 }
const base = { stage, anchor: centerNode, width: 400, height: 200, gap: 12, aboveClearance: 0 }

const contains = (placement: { left: number; top: number; width: number; height: number }, region: AnchoredRect): boolean =>
  placement.left >= region.left
  && placement.top >= region.top
  && placement.left + placement.width <= region.right
  && placement.top + placement.height <= region.bottom

describe('resolveAnchoredPlacement', () => {
  it('attaches directly below the anchor, horizontally centred on it', () => {
    const placement = resolveAnchoredPlacement(base)
    expect(placement.side).toBe('below')
    expect(placement.top).toBe(centerNode.bottom + base.gap)
    expect(placement.left + placement.width / 2).toBe((centerNode.left + centerNode.right) / 2)
    expect(placement.width).toBe(base.width)
    expect(placement.height).toBe(base.height)
  })

  it('flips above when the region below cannot hold the card', () => {
    const lowNode: AnchoredRect = { left: 400, top: 560, right: 600, bottom: 760 }
    const placement = resolveAnchoredPlacement({ ...base, anchor: lowNode })
    expect(placement.side).toBe('above')
    expect(placement.top + placement.height).toBe(lowNode.top - base.gap)
    expect(contains(placement, stage)).toBe(true)
  })

  it('reserves the floating toolbar clearance when it flips above', () => {
    const lowNode: AnchoredRect = { left: 400, top: 560, right: 600, bottom: 760 }
    const placement = resolveAnchoredPlacement({ ...base, anchor: lowNode, aboveClearance: 40 })
    expect(placement.side).toBe('above')
    expect(placement.top + placement.height).toBe(lowNode.top - base.gap - 40)
  })

  it('keeps the whole card inside the stage when the anchor hugs an edge', () => {
    for (const anchor of [
      { left: -60, top: 300, right: 40, bottom: 400 },
      { left: 960, top: 300, right: 1060, bottom: 400 },
      { left: 400, top: -80, right: 600, bottom: 20 },
    ] satisfies AnchoredRect[]) {
      const placement = resolveAnchoredPlacement({ ...base, anchor })
      expect(contains(placement, stage)).toBe(true)
    }
  })

  it('narrows the card to the stage when the stage is narrower than the natural width', () => {
    const narrowStage: AnchoredRect = { left: 0, top: 0, right: 260, bottom: 800 }
    const placement = resolveAnchoredPlacement({ ...base, stage: narrowStage, anchor: { left: 30, top: 300, right: 230, bottom: 500 } })
    expect(placement.width).toBe(260)
    expect(contains(placement, narrowStage)).toBe(true)
  })

  it('takes the larger side and shortens the card when neither side can hold it', () => {
    const shortStage: AnchoredRect = { left: 0, top: 0, right: 1000, bottom: 560 }
    const anchor: AnchoredRect = { left: 400, top: 120, right: 600, bottom: 500 }
    const placement = resolveAnchoredPlacement({ ...base, stage: shortStage, anchor })
    // 上方剩 108（120-12），下方剩 48（560-500-12）→ 取上方，并压到 108。
    expect(placement.side).toBe('above')
    expect(placement.height).toBe(108)
    expect(contains(placement, shortStage)).toBe(true)
  })

  it('never reports a negative size for a degenerate stage', () => {
    const collapsed: AnchoredRect = { left: 500, top: 400, right: 480, bottom: 380 }
    const placement = resolveAnchoredPlacement({ ...base, stage: collapsed })
    expect(placement.width).toBeGreaterThanOrEqual(0)
    expect(placement.height).toBeGreaterThanOrEqual(0)
  })

  // 调用方（useComposerViewportPlacement）不是把整个视口当 stage，而是先扣掉左缘常驻
  // 工具条（CanvasToolbar）量到的真实矩形，传进来的 stage.left 因此常年不是 0——
  // 这条守住「stage 本身左移之后，居中 + clamp 仍然是同一套算法」，不会因为 left≠0
  // 悄悄漏出另一条分支（2026-09-10 反馈 #10：浮框左缘被左栏压住的复现根因）。
  it('keeps the card clear of an inset stage.left, as when a fixed left dock narrows the usable area', () => {
    const dockedStage: AnchoredRect = { left: 96, top: 0, right: 1000, bottom: 800 }
    // 锚点紧贴收窄后的左边界——如果调用方仍按 stage.left=0 算居中，卡片会被推出
    // dockedStage.left 之外，被这条测试的 contains() 抓到。
    const anchorNearDock: AnchoredRect = { left: 100, top: 300, right: 300, bottom: 500 }
    const placement = resolveAnchoredPlacement({ ...base, stage: dockedStage, anchor: anchorNearDock })
    expect(contains(placement, dockedStage)).toBe(true)
    expect(placement.left).toBeGreaterThanOrEqual(dockedStage.left)
  })

  it('narrows the card to an inset stage that is narrower than the natural width', () => {
    // 模拟左栏很宽 + agent 面板把画布挤窄的极端窄视口：可用宽度只剩 220。
    const narrowDockedStage: AnchoredRect = { left: 96, top: 0, right: 316, bottom: 800 }
    const placement = resolveAnchoredPlacement({ ...base, stage: narrowDockedStage, anchor: { left: 150, top: 300, right: 260, bottom: 500 } })
    expect(placement.width).toBe(220)
    expect(contains(placement, narrowDockedStage)).toBe(true)
  })

  // 这条就是「不漂移」的机器判据：函数签名里根本没有障碍物这个入口，所以画布上
  // 别的节点、别的浮条、别的结果堆叠怎么动，同一个锚点算出来的位置必须逐字节相同。
  it('is a pure function of stage and anchor: the same anchor always resolves to the same rectangle', () => {
    const first = resolveAnchoredPlacement(base)
    const second = resolveAnchoredPlacement({ ...base, anchor: { ...centerNode } })
    expect(second).toEqual(first)
    expect(Object.keys(base)).toEqual(['stage', 'anchor', 'width', 'height', 'gap', 'aboveClearance'])
  })
})
