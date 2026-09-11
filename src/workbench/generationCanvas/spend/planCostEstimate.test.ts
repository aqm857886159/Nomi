import { describe, expect, it } from 'vitest'
import { estimatePlanCost } from './planCostEstimate'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (id: string): GenerationCanvasNode =>
  ({ id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots', meta: {} }) as unknown as GenerationCanvasNode
const priced = (cost: number): ModelOption => ({ value: 'm', label: 'M', pricing: { cost, enabled: true, specCosts: [] } })
const unpriced = (): ModelOption => ({ value: 'm', label: 'M' }) // 无 pricing

describe('estimatePlanCost — F11 本波价格（未知 ≠ 0）', () => {
  it('全部有价 → known，累加 credits', () => {
    const est = estimatePlanCost([node('a'), node('b')], (n) => (n.id === 'a' ? priced(3) : priced(5)))
    expect(est).toEqual({ known: true, credits: 8 })
  })

  it('任一节点解不出 pricing → 整批 known:false（价格未知），绝不当 0 少报', () => {
    const est = estimatePlanCost([node('a'), node('b')], (n) => (n.id === 'a' ? priced(3) : unpriced()))
    expect(est.known).toBe(false)
    if (!est.known) expect(est.unresolved).toBe(1)
  })

  it('cost 为 0 是「已知免费」，不是未知（区分 0 与未知）', () => {
    const est = estimatePlanCost([node('a')], () => priced(0))
    expect(est).toEqual({ known: true, credits: 0 })
  })

  it('缺失节点（undefined）计入未知，不悄悄漏', () => {
    const est = estimatePlanCost([node('a'), undefined], () => priced(2))
    expect(est.known).toBe(false)
  })

  it('模型选项没匹配到（resolveOption 返回 undefined）→ 未知', () => {
    const est = estimatePlanCost([node('a')], () => undefined)
    expect(est.known).toBe(false)
  })

  // 2026-09-11 根因回归：这里此前只累加基价，规格加价一分都不进这个数——同一批镜头，
  // 条上印的比主进程真正要扣的少。现在两边跑的是契约层那条唯一算式（基价 + 命中的加价）。
  it('选中的参数命中规格加价 → 加价必须进这个数（此前只累加基价，少报）', () => {
    const upgraded = { ...node('a'), meta: { size: '1536x1024' } } as GenerationCanvasNode
    const option: ModelOption = {
      value: 'm', label: 'M',
      pricing: { cost: 0.3, enabled: true, specCosts: [{ specKey: 'size:1536x1024', cost: 0.2, enabled: true }] },
    }
    expect(estimatePlanCost([upgraded], () => option)).toEqual({ known: true, credits: 0.5 })
    // 没选到那一档就不加钱——加价钉的是「某个参数选了某个值」，不是无条件涨价。
    const base = { ...node('a'), meta: { size: '1024x1024' } } as GenerationCanvasNode
    expect(estimatePlanCost([base], () => option)).toEqual({ known: true, credits: 0.3 })
  })

  // 未启用的价目档不该被当成「已知的 0 元」印出去。
  it('价目整条 enabled:false → 未知，不是 0', () => {
    const off: ModelOption = { value: 'm', label: 'M', pricing: { cost: 3, enabled: false, specCosts: [] } }
    expect(estimatePlanCost([node('a')], () => off).known).toBe(false)
  })
})
