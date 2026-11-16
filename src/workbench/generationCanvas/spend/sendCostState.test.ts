import { describe, expect, it, vi } from 'vitest'
import type { VendorAccountFacts } from '../../../../electron/shared/contracts/vendorAccountFacts'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { sendCostState } from './useSendCost'

vi.mock('../../../ui/onboarding/useVendorAccountFacts', () => ({ useVendorAccountFacts: () => ({ facts: null, refresh: () => undefined }) }))
vi.mock('./useNodePricePreview', () => ({ useNodePricePreview: () => ({ quote: null }) }))

/** 发送键那一格的三态（板 ModelSurfaces cost.send-pill / cost.low-balance；用户 2026-11-16「照图」）。 */
const NOW = 1_000_000
const quote: VendorPricePreview = { usd: 1.95, credits: 19.5, source: 'test' }
const facts = (patch: Partial<VendorAccountFacts> = {}): VendorAccountFacts => ({
  vendorKey: 'apimart', checkedAt: NOW - 1_000, keyState: 'valid', accountCredits: 52.3, keyCredits: null,
  keyUnlimited: true, usageCredits: null, usageRequests: null, ...patch,
})
const at = (q: VendorPricePreview | null, f: VendorAccountFacts | null, idle = true) => sendCostState(q, f, { idle, now: NOW })

describe('sendCostState', () => {
  it('余额够：胶囊印估价', () => {
    expect(at(quote, facts())).toEqual({ kind: 'credits', credits: 19.5, approximate: false })
  })
  it('余额刚查到且低于估价：还差 N（不是整笔）', () => {
    const state = at(quote, facts({ accountCredits: 11.9 }))
    expect(state.kind).toBe('shortfall')
    expect(state.kind === 'shortfall' && state.credits).toBeCloseTo(7.6, 9)
  })
  it('余额为零和缺额同一个样子：还差整笔估价，按输出估的也一样', () => {
    expect(at(quote, facts({ accountCredits: 0 }))).toEqual({ kind: 'shortfall', credits: 19.5 })
    expect(at({ ...quote, basis: 'output-estimate' }, facts({ keyUnlimited: false, keyCredits: 0 }))).toEqual({ kind: 'shortfall', credits: 19.5 })
  })
  it('反例：余额查不到 / 读数过期 / Key 不确定 → 照常胶囊，不换成去充值', () => {
    for (const f of [null, facts({ accountCredits: 1, checkedAt: NOW - 31_000 }), facts({ accountCredits: 1, keyState: 'unknown' }), facts({ accountCredits: null })]) {
      expect(at(quote, f).kind).toBe('credits')
    }
  })
  it('反例：算不出价 / 价为 0 / 忙着 → 什么都不印（不印 0）', () => {
    expect(at(null, facts({ accountCredits: 0 }))).toEqual({ kind: 'none' })
    expect(at({ ...quote, credits: 0 }, facts())).toEqual({ kind: 'none' })
    expect(at(quote, facts({ accountCredits: 0 }), false)).toEqual({ kind: 'none' })
  })
})
