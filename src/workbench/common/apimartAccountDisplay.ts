import type { VendorAccountFacts } from '../../../electron/shared/contracts/vendorAccountFacts'
import type { VendorPricePreview } from '../../../electron/shared/contracts/vendorPricePreview'
import { formatMoney } from '../ai/v4/formatMoney'

export function apimartBillingUrl(locale: string): string {
  return locale.startsWith('zh') ? 'https://apimart.ai/zh/billing' : 'https://apimart.ai/billing'
}

export function formatCreditValue(value: number, locale: string): string {
  return value.toLocaleString(locale, value !== 0 && Math.abs(value) < 0.01
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 })
}

export function publicEstimateUsd(quote: VendorPricePreview, locale: string): string {
  const precision = quote.usd > 0 && quote.usd < 0.001
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 3 }
  return formatMoney(locale, 'USD', quote.usd, precision)
}

/** APIMart's usage contract defines credits as ten per USD. Only convert its account snapshot. */
export function accountBalanceUsd(snapshot: VendorAccountFacts | null, locale: string): string | null {
  const balance = snapshot?.accountCredits
  if (balance == null) return null
  const usd = balance / 10
  return usd > 0 && usd < 0.01 ? '<' + formatMoney(locale, 'USD', 0.01) : formatMoney(locale, 'USD', usd)
}

export function priceBalanceStatus(quote: VendorPricePreview | null, snapshot: VendorAccountFacts | null, now: number) {
  if (!quote || !snapshot || quote.credits <= 0 || snapshot.keyState !== 'valid' || now - snapshot.checkedAt >= 30_000) {
    return { zero: false, estimatedGap: 0 }
  }
  const limits = [snapshot.accountCredits, snapshot.keyUnlimited ? null : snapshot.keyCredits].filter((n): n is number => n !== null)
  return {
    zero: limits.includes(0),
    estimatedGap: quote.basis === 'output-estimate' || !limits.length ? 0 : Math.max(0, quote.credits - Math.min(...limits)),
  }
}
