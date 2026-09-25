import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmGenerationSpend, useSpendConfirmStore } from './spendConfirm'

const quoteSpend = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ tasks: { quoteSpend } }) }))

// 这两条走的是「会弹卡」的那条路（Agent 发起），验的是卡上的金额行与报价授权；
// 用户自己点单个节点不弹卡的那条路在 spendConfirmPolicy.test.ts。
describe('shared quote confirmation card', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('shows a priced model amount and transfers only the confirmed quote id', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-1', amount: 0.3, lines: [] })
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    const accepted = vi.fn()
    await confirmGenerationSpend([{ meta: { modelVendor: 'relay', modelKey: 'image' } }], {
      title: 'Generate', message: 'One image', onQuoteConfirmed: accepted, initiator: 'agent',
    })
    expect(confirm.mock.calls[0][0].details?.[0].value).toContain('0.3')
    expect(accepted).toHaveBeenCalledWith('quote-1')
  })
  it('unknown price is explicit and rejection never transfers quote authorization', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-2', amount: null, lines: [] })
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    const accepted = vi.fn()
    await confirmGenerationSpend([{ meta: { modelVendor: 'relay', modelKey: 'unpriced' } }], {
      title: 'Generate', message: 'One image', onQuoteConfirmed: accepted, initiator: 'agent',
    })
    expect(confirm.mock.calls[0][0].details?.[0].value).toMatch(/目录未标价|Not priced/)
    expect(accepted).not.toHaveBeenCalled()
  })
})
