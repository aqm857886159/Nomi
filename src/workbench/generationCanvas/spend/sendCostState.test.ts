import { describe, expect, it, vi } from 'vitest'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { sendCostState } from './useSendCost'

vi.mock('./useNodePricePreview', () => ({ useNodePricePreview: () => ({ quote: null, pending: false }) }))

/** 发送键那一格的三态（板 ModelSurfaces cost.send-pill / cost.hover；设计卡 ★4）。 */
const quote: VendorPricePreview = { usd: 1.95, credits: 19.5, source: 'test' }
const at = (q: VendorPricePreview | null, { vendorKey = 'apimart', pending = false, idle = true } = {}) =>
  sendCostState({ vendorKey, quote: q, pending }, { idle })

describe('sendCostState', () => {
  it('有价：硬币 + 积分数（单价 × 份数由主进程算好，这里原样用）', () => {
    expect(at(quote)).toEqual({ kind: 'credits', quote })
  })
  it('改参数、新价没回来但旧数还在暂留期：仍印旧数，不闪箭头', () => {
    expect(at(quote, { pending: true })).toEqual({ kind: 'credits', quote })
  })
  it('新价超过暂留期还没回来：只剩箭头，也不说「估不出」', () => {
    expect(at(null, { pending: true })).toEqual({ kind: 'none' })
  })
  it('反例：算不出 / 价为 0 / 不是有限数 → 估不出（不印数、不印 0）', () => {
    for (const q of [null, { ...quote, credits: 0 }, { ...quote, credits: Number.NaN }, { ...quote, credits: -1 }]) {
      expect(at(q)).toEqual({ kind: 'unknown' })
    }
  })
  it('反例：忙着 / 不走公开价的那家 → 钮原样，什么都不多', () => {
    expect(at(quote, { idle: false })).toEqual({ kind: 'none' })
    expect(at(null, { idle: false })).toEqual({ kind: 'none' })
    expect(sendCostState({ quote, pending: false }, { idle: true })).toEqual({ kind: 'none' })
  })
})
