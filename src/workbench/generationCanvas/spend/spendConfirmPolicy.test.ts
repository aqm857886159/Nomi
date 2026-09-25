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
  it('reported case: I click ↑ on one node, 0.3 credits → no card', () => {
    expect(spendConfirmationRequirement({ initiator: 'user', runCount: 1, amount: 0.3, hostingDisclosure: false }))
      .toEqual({ required: false, reasons: [] })
  })

  it('unpriced single user run does not ask (unknown price never blocks generation)', () => {
    expect(spendConfirmationRequirement({ initiator: 'user', runCount: 1, amount: null, hostingDisclosure: false }).required).toBe(false)
  })

  it('class: asks exactly when one of agent / ≥2 runs / ≥ threshold / hosting / no quote holds', () => {
    const initiators: SpendInitiator[] = ['user', 'agent']
    const runCounts = [1, 2, 4]
    const amounts: Array<number | null | undefined> = [0, 0.3, SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS - 0.01, SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS, 42, null, undefined]
    for (const initiator of initiators) for (const runCount of runCounts) for (const amount of amounts) for (const hostingDisclosure of [false, true]) {
      const expected = initiator === 'agent' || runCount > 1 || (typeof amount === 'number' && amount >= SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS)
        || hostingDisclosure || amount === undefined
      expect(spendConfirmationRequirement({ initiator, runCount, amount, hostingDisclosure }).required,
        JSON.stringify({ initiator, runCount, amount, hostingDisclosure })).toBe(expected)
    }
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
    const ok = await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', onQuoteConfirmed: accepted })
    expect(ok).toBe(true)
    expect(card).not.toHaveBeenCalled()
    expect(quoteSpend).toHaveBeenCalledTimes(1)
    expect(accepted).toHaveBeenCalledWith('quote-single')
  })

  it('×2 on the same node asks once with the doubled quote', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-two', amount: 0.6, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    const accepted = vi.fn()
    await confirmGenerationSpend([paidNode, paidNode], { title: 'Generate', message: 'Two images', onQuoteConfirmed: accepted })
    expect(card).toHaveBeenCalledTimes(1)
    expect(accepted).toHaveBeenCalledWith('quote-two')
  })

  it('an expensive single run asks, and declining never transfers the quote', async () => {
    quoteSpend.mockResolvedValue({ quoteId: 'quote-dear', amount: SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS + 2, lines: [] })
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    const accepted = vi.fn()
    const ok = await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One video', onQuoteConfirmed: accepted })
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
    expect(await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image' })).toBe(false)
    expect(card).toHaveBeenCalledTimes(1)
  })
})
