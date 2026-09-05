import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getCanvasNodeVisualSize } from './generationCanvasGeometry'
import { REVEAL_MARGIN_PX, revealPanDelta, shouldRestoreAfterReveal } from './useCreatedNodeVisibilityPan'

const at = (x: number, y: number): GenerationCanvasNode =>
  ({ id: 'created', kind: 'image', position: { x, y } } as unknown as GenerationCanvasNode)

const { width: W, height: H } = getCanvasNodeVisualSize(at(0, 0))

describe('revealPanDelta', () => {
  it('leaves an already visible node alone', () => {
    expect(revealPanDelta(at(100, 100), 1, { x: 0, y: 0 }, 1200, 800)).toBeNull()
  })

  it('pans just enough to reveal a node pushed past the right edge', () => {
    // 阳性对照：这正是常驻 Agent 面板把 stage 压窄后发生的事——避让把第二张卡推到可视区之外。
    const stageWidth = 880
    const node = at(stageWidth - 40, 100) // 只露出 40px，其余在右边界外
    const delta = revealPanDelta(node, 1, { x: 0, y: 0 }, stageWidth, 800)
    expect(delta).not.toBeNull()
    const right = node.position.x + W + (delta?.x ?? 0)
    expect(right).toBeLessThanOrEqual(stageWidth - REVEAL_MARGIN_PX + 0.001)
    expect(delta?.y).toBe(0) // 只动越界的那个轴
  })

  it('pans down-left nodes back into view on both axes', () => {
    const delta = revealPanDelta(at(-500, -400), 1, { x: 0, y: 0 }, 1200, 800)
    expect(delta).toEqual({ x: REVEAL_MARGIN_PX + 500, y: REVEAL_MARGIN_PX + 400 })
  })

  it('honours zoom when measuring the node box', () => {
    // zoom 0.5 时同一张卡只占一半屏幕尺寸，原本越界的落点可能已经完整可见。
    expect(revealPanDelta(at(600, 100), 0.5, { x: 0, y: 0 }, 1200, 800)).toBeNull()
    expect(revealPanDelta(at(600, 100), 2, { x: 0, y: 0 }, 1200, 800)).not.toBeNull()
  })

  it('aligns oversized nodes to the top-left instead of oscillating', () => {
    const tiny = Math.round(Math.min(W, H) / 2)
    const delta = revealPanDelta(at(300, 300), 1, { x: 0, y: 0 }, tiny, tiny)
    expect(delta).toEqual({ x: REVEAL_MARGIN_PX - 300, y: REVEAL_MARGIN_PX - 300 })
  })

  it('refuses to guess before the stage has been measured', () => {
    expect(revealPanDelta(at(9999, 9999), 1, { x: 0, y: 0 }, 0, 0)).toBeNull()
  })
})

describe('shouldRestoreAfterReveal', () => {
  const record = { id: 'dup', before: { zoom: 1, offset: { x: 0, y: 0 } } }
  const revealLanding = { zoom: 1, offset: { x: 250, y: -557 } }

  it('卡还在 → 不回', () => {
    expect(shouldRestoreAfterReveal(record, new Set(['dup']), revealLanding, revealLanding)).toBe(false)
  })

  it('卡被撤销、视口仍停在最近一次自动让位的落点 → 回到出发点（阳性对照：card-stack 复制变体后撤销，视频卡被留在视口外 557px）', () => {
    expect(shouldRestoreAfterReveal(record, new Set(['other']), { zoom: 1, offset: { x: 251, y: -556 } }, revealLanding)).toBe(true)
  })

  it('露出之后 composer 又让位了一次：比较对象是最近那次自动落点，仍然回', () => {
    const composerLanding = { zoom: 1, offset: { x: 250, y: -620 } }
    expect(shouldRestoreAfterReveal(record, new Set(), composerLanding, composerLanding)).toBe(true)
    expect(shouldRestoreAfterReveal(record, new Set(), composerLanding, revealLanding)).toBe(false)
  })

  it('用户此后自己动过画布 → 不抢', () => {
    expect(shouldRestoreAfterReveal(record, new Set(), { zoom: 1, offset: { x: 40, y: -557 } }, revealLanding)).toBe(false)
    expect(shouldRestoreAfterReveal(record, new Set(), { zoom: 0.8, offset: { x: 250, y: -557 } }, revealLanding)).toBe(false)
  })

  it('没有露出记录或没有自动让位记录 → 不回', () => {
    expect(shouldRestoreAfterReveal(null, new Set(), revealLanding, revealLanding)).toBe(false)
    expect(shouldRestoreAfterReveal(record, new Set(), revealLanding, null)).toBe(false)
  })
})
