import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmGenerationSpend,
  spendConfirmationRequirement,
  useSpendConfirmStore,
  type SpendInitiator,
} from './spendConfirm'

const quoteSpend = vi.hoisted(() => vi.fn())
const bridge = vi.hoisted(() => ({ present: true }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => (bridge.present ? { tasks: { quoteSpend } } : null) }))

const paidNode = { meta: { modelVendor: 'relay', modelKey: 'image' } }

describe('spendConfirmationRequirement（唯一判据）', () => {
  // 列：说明 / 发起方 / 一下跑几份 / 首次匿名托管告知 / 要不要确认。金额不在判据里（Nomi 现在不计算价格）。
  it.each<[string, SpendInitiator, number, boolean, boolean]>([
    ['reported case: I click ↑ on one node', 'user', 1, false, false],
    ['storyboard row 「生成镜 N」, one shot', 'user', 1, false, false],
    ['×2 on one node', 'user', 2, false, true],
    ['batch of four', 'user', 4, false, true],
    ['Agent, single run', 'agent', 1, false, true],
    ['Agent, batch', 'agent', 3, false, true],
    ['first hosted run discloses', 'user', 1, true, true],
  ])('%s', (_label, initiator, runCount, hostingDisclosure, expected) => {
    expect(spendConfirmationRequirement({ initiator, runCount, hostingDisclosure })).toBe(expected)
  })
})

describe('confirmGenerationSpend 走判据', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    quoteSpend.mockReset()
    bridge.present = true
  })

  it('reported case: single user run skips the card but still hands over the quote for the grant', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-single', amount: 0.3, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')
    const accepted = vi.fn()
    const ok = await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', onQuoteConfirmed: accepted, initiator: 'user' })
    expect(ok).toBe(true)
    expect(card).not.toHaveBeenCalled()
    expect(quoteSpend).toHaveBeenCalledTimes(1)
    expect(accepted).toHaveBeenCalledWith('quote-single')
  })

  it('×2 on the same node asks once with the doubled quote', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-two', amount: 0.6, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    const accepted = vi.fn()
    await confirmGenerationSpend([paidNode, paidNode], { title: 'Generate', message: 'Two images', onQuoteConfirmed: accepted, initiator: 'user' })
    expect(card).toHaveBeenCalledTimes(1)
    expect(accepted).toHaveBeenCalledWith('quote-two')
  })

  it('an unpriced single user run (today\'s normal case) still starts without a card', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-unpriced', amount: null, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')
    const accepted = vi.fn()
    expect(await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One video', onQuoteConfirmed: accepted, initiator: 'user' })).toBe(true)
    expect(card).not.toHaveBeenCalled()
    expect(accepted).toHaveBeenCalledWith('quote-unpriced')
  })

  it('declining a card that had to be shown never transfers the quote', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-two', amount: null, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    const accepted = vi.fn()
    const ok = await confirmGenerationSpend([paidNode, paidNode], { title: 'Generate', message: 'Two videos', onQuoteConfirmed: accepted, initiator: 'user' })
    expect(ok).toBe(false)
    expect(card).toHaveBeenCalledTimes(1)
    expect(accepted).not.toHaveBeenCalled()
  })

  it('an Agent-initiated single cheap run still asks', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-agent', amount: 0.3, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', initiator: 'agent' })
    expect(card).toHaveBeenCalledTimes(1)
  })

  it('a missing quote is not a reason to ask; the single user run starts and no quote id is invented', async () => {
    bridge.present = false
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')
    const accepted = vi.fn()
    expect(await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', onQuoteConfirmed: accepted, initiator: 'user' })).toBe(true)
    expect(card).not.toHaveBeenCalled()
    expect(accepted).not.toHaveBeenCalled()
  })
})
