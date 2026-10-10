import { describe, expect, it } from 'vitest'
import { COMMON_RATIO_ORDER } from '../../../workbench/generationCanvas/nodes/aspectRatio'
import {
  EMPTY_STATE_BLOCK_HEIGHT,
  EMPTY_STATE_COMPACT_MIN_HEIGHT,
  emptyStateBlockTop,
  emptyStateTier,
} from '../../../workbench/generationCanvas/nodes/render/nodeEmptyStateLayout'
import { LAB_RATIOS, ratioFrame, ratioValueOf, renderedFrame, smallRatioFrame } from './labRatios'

// 结构测试（逃逸账本 USER-20261010-empty-node-ratio 的类级检查）：
// 1. 样张覆盖的比例必须正好是生产常用比例表；生产加比例，样张自动跟着出格。
// 2. 矩阵用的是**渲染有效高度**（resolveNodeVisualSize 钳过的），不是存的名义高度：
//    每个比例、每种尺寸，块底都必须 ≤ 渲染高度，且渲染高度 ≥ 紧凑阈值。
describe('空节点样张的比例清单从生产派生', () => {
  it('样张比例 = 生产 COMMON_RATIO_ORDER，顺序一致', () => {
    expect(LAB_RATIOS.map((ratio) => ratio.label)).toEqual([...COMMON_RATIO_ORDER])
  })
  it('比例值就是 a / b', () => {
    expect(ratioValueOf('16:9')).toBeCloseTo(16 / 9, 10)
    expect(ratioValueOf('9:21')).toBeCloseTo(9 / 21, 10)
  })
  it('格式不对就抛错，不静默漏格', () => {
    expect(() => ratioValueOf('wide')).toThrow()
  })
})

describe('样张矩阵：块底不越过渲染高度', () => {
  const cases = LAB_RATIOS.flatMap((ratio) => [
    { label: `${ratio.label} 真宽`, frame: ratioFrame(ratio) },
    { label: `${ratio.label} 小尺寸 240`, frame: smallRatioFrame(ratio) },
  ])
  it.each(cases)('$label：渲染高度 ≥ 紧凑阈值，块底 ≤ 渲染高度', ({ frame }) => {
    const rendered = renderedFrame('image', frame)
    expect(rendered.height).toBeGreaterThanOrEqual(EMPTY_STATE_COMPACT_MIN_HEIGHT)
    const tier = emptyStateTier(rendered.height)
    const top = emptyStateBlockTop(tier, rendered.height)
    expect(top + EMPTY_STATE_BLOCK_HEIGHT[tier]).toBeLessThanOrEqual(rendered.height)
  })
  it('存的 240×103 渲染成 240×120，档位按 120 判（紧凑）', () => {
    const rendered = renderedFrame('image', { width: 240, height: 103 })
    expect(rendered).toEqual({ width: 240, height: 120 })
    expect(emptyStateTier(rendered.height)).toBe('compact')
  })
})
