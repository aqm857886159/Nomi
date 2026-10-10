import { describe, expect, it } from 'vitest'
import { COMMON_RATIO_ORDER } from '../../../workbench/generationCanvas/nodes/aspectRatio'
import { MIN_NODE_WIDTH, nodeWidthForAspectRatio } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import { EMPTY_STATE_BLOCK_HEIGHT, EMPTY_STATE_TOP_CLEARANCE, emptyStateBlockTop, emptyStateTier } from '../../../workbench/generationCanvas/nodes/render/nodeEmptyStateLayout'
import { LAB_RATIOS, ratioValueOf } from './labRatios'

// 类级检查（逃逸账本 USER-20261010-empty-node-ratio）：用户发现「空节点排版随比例变形，设计没考虑到」。
// ① 样张覆盖的比例必须正好是生产常用比例表——以后生产加比例，样张自动出格，不会漏比例；
// ② 矩阵：生产每个比例 × {生产宽度, 最小宽度}，空态块都落在卡内、且离顶让出左上角状态小标。
describe('空节点样张的比例清单从生产派生', () => {
  it('样张比例 = 生产 COMMON_RATIO_ORDER，顺序一致', () => {
    expect(LAB_RATIOS.map((ratio) => ratio.label)).toEqual([...COMMON_RATIO_ORDER])
  })
  it('格式不对就抛错，不静默漏格', () => {
    expect(() => ratioValueOf('wide')).toThrow()
  })
})

const cases = COMMON_RATIO_ORDER.flatMap((label) => {
  const ratio = ratioValueOf(label)
  return [nodeWidthForAspectRatio(ratio), MIN_NODE_WIDTH].map((width) => ({ label, width, height: width / ratio }))
})

describe('每个生产比例下空态块都放得下、不压小标', () => {
  it.each(cases)('$label · 宽 $width', ({ width, height }) => {
    const tier = emptyStateTier(height)
    const top = emptyStateBlockTop(tier, height)
    expect(width).toBeGreaterThanOrEqual(MIN_NODE_WIDTH)
    expect(top).toBeGreaterThanOrEqual(EMPTY_STATE_TOP_CLEARANCE)
    expect(top + EMPTY_STATE_BLOCK_HEIGHT[tier]).toBeLessThanOrEqual(height)
  })
})
