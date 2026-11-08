import { describe, expect, it } from 'vitest'
import type { VendorAccountFacts } from '../../../electron/shared/contracts/vendorAccountFacts'
import type { VendorPricePreview } from '../../../electron/shared/contracts/vendorPricePreview'
import { formatCreditValue, priceBalanceStatus } from './apimartAccountDisplay'

const at = 50_000
const account: VendorAccountFacts = { vendorKey: 'apimart', checkedAt: at, keyState: 'valid', accountCredits: 0, keyCredits: 8, keyUnlimited: false, usageCredits: null, usageRequests: null }
const amount: VendorPricePreview = { credits: 2, usd: 0.2, source: 'https://api.apimart.ai/api/pricing/model' }

describe('public estimates and verified account limits', () => {
  it.each([undefined, 'output-estimate'] as const)('recognizes a verified zero for a positive %s quote', (basis) => {
    const quote = { ...amount, basis }
    expect(priceBalanceStatus(quote, account, at).zero).toBe(true)
    expect(priceBalanceStatus(quote, { ...account, accountCredits: 10, keyCredits: 0 }, at).zero).toBe(true)
  })
  it('uses a positive balance as a hint and never assigns a precise gap to token estimates', () => {
    expect(priceBalanceStatus(amount, { ...account, accountCredits: 1 }, at)).toEqual({ zero: false, estimatedGap: 1 })
    expect(priceBalanceStatus({ ...amount, basis: 'output-estimate' }, account, at)).toEqual({ zero: true, estimatedGap: 0 })
    expect(priceBalanceStatus({ ...amount, basis: 'output-estimate' }, { ...account, accountCredits: 1 }, at)).toEqual({ zero: false, estimatedGap: 0 })
  })
  it('keeps unknown, invalid, stale and unlimited key limits from blocking a generation', () => {
    expect(priceBalanceStatus(amount, { ...account, accountCredits: null, keyCredits: 0, keyUnlimited: true }, at).zero).toBe(false)
    expect(priceBalanceStatus(amount, { ...account, keyState: 'invalid' }, at).zero).toBe(false)
    expect(priceBalanceStatus(amount, account, at + 30_000).zero).toBe(false)
    expect(priceBalanceStatus(null, account, at).zero).toBe(false)
  })
  it('rounds the public display without turning a small positive price into zero', () => {
    expect(formatCreditValue(0.34776, 'en')).toBe('0.35')
    expect(formatCreditValue(0.000006, 'en')).toBe('0.000006')
  })
})
