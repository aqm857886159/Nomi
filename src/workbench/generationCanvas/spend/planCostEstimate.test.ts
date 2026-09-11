import { describe, expect, it } from 'vitest'
import { estimatePlanCost } from './planCostEstimate'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 这一条钉的是 2026-09-11 逮到的第二处**少报**：确认条此前只累加基价，命中的规格加价
 * （720p / 10s 这种加钱档）一分都不进这个数，于是印出来的比主进程真正要扣的少。
 *
 * 同一批镜头，本地估算和主进程封印用的必须是**同一条算式**（`shotPricingRule`）。
 * 少报比不报更坏：用户以为便宜。
 */
const option = (pricing: ModelOption['pricing']): ModelOption => ({
  value: 'demo-image',
  label: '演示',
  vendor: 'demo',
  modelKey: 'demo-image',
  pricing,
})

const node = (meta: Record<string, unknown>): GenerationCanvasNode =>
  ({ id: 'n1', kind: 'image', meta }) as never

describe('estimatePlanCost', () => {
  it('命中的规格加价进这个数，不是只累加基价', () => {
    const picked = option({ cost: 0.3, enabled: true, specCosts: [{ specKey: '1536x1024', cost: 0.2, enabled: true }] })
    expect(estimatePlanCost([node({ size: '1536x1024' })], () => picked)).toEqual({ known: true, credits: 0.5 })
    // 没命中那一档就只有基价——加价是「命中才加」，不是无条件加。
    expect(estimatePlanCost([node({ size: '1024x1024' })], () => picked)).toEqual({ known: true, credits: 0.3 })
  })

  it('任一节点解不出价目 → 整批标「价格未知」，绝不把解不出的当 0 悄悄少报', () => {
    const picked = option({ cost: 0.3, enabled: true, specCosts: [] })
    expect(estimatePlanCost([node({}), node({})], (target) => (target === undefined ? undefined : picked))).toEqual({
      known: true,
      credits: 0.6,
    })
    expect(estimatePlanCost([node({}), undefined], () => picked)).toEqual({ known: false, credits: 0.3, unresolved: 1 })
    expect(estimatePlanCost([node({})], () => option(undefined))).toEqual({ known: false, credits: 0, unresolved: 1 })
  })
})
