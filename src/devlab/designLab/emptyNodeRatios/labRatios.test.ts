import { describe, expect, it } from 'vitest'
import { COMMON_RATIO_ORDER } from '../../../workbench/generationCanvas/nodes/aspectRatio'
import { LAB_RATIOS, ratioValueOf } from './labRatios'

// 结构测试（逃逸账本 REAL-20261010-empty-node-ratio 的类级检查）：
// 样张覆盖的比例必须正好是生产常用比例表；以后生产加比例，这里自动跟着，样张不会漏格。
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
