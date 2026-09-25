import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmGenerationSpend,
  SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS,
  spendConfirmationRequirement,
  useSpendConfirmStore,
  type SpendInitiator,
} from './spendConfirm'

const quoteSpend = vi.hoisted(() => vi.fn())
const bridge = vi.hoisted(() => ({ present: true }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => (bridge.present ? { tasks: { quoteSpend } } : null) }))

const paidNode = { meta: { modelVendor: 'relay', modelKey: 'image' } }

describe('spendConfirmationRequirement（唯一判据）', () => {
  const T = SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS
  it.each<[string, SpendInitiator, number, number | null | undefined, boolean, boolean]>([
    ['reported case: I click ↑ on one node, 0.3 credits', 'user', 1, 0.3, false, false],
    ['free single run', 'user', 1, 0, false, false],
    ['just under the threshold', 'user', 1, T - 0.01, false, false],
    ['unpriced single run never blocks generation', 'user', 1, null, false, false],
    ['at the threshold', 'user', 1, T, false, true],
    ['well over the threshold', 'user', 1, 42, false, true],
    ['×2 on one node', 'user', 2, 0.6, false, true],
    ['batch of four, unpriced', 'user', 4, null, false, true],
    ['Agent, single cheap run', 'agent', 1, 0.3, false, true],
    ['Agent, unpriced', 'agent', 1, null, false, true],
    ['first hosted run discloses', 'user', 1, 0.3, true, true],
    ['no quote at all', 'user', 1, undefined, false, true],
  ])('%s', (_label, initiator, runCount, amount, hostingDisclosure, expected) => {
    expect(spendConfirmationRequirement({ initiator, runCount, amount, hostingDisclosure })).toBe(expected)
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

  it('an expensive single run asks, and declining never transfers the quote', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-dear', amount: SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS + 2, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    const accepted = vi.fn()
    const ok = await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One video', onQuoteConfirmed: accepted, initiator: 'user' })
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

  it('without a quote it falls back to asking (never spends blind)', async () => {
    bridge.present = false
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    expect(await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', initiator: 'user' })).toBe(false)
    expect(card).toHaveBeenCalledTimes(1)
  })
})
