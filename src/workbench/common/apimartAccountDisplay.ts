import type { VendorAccountFacts } from '../../../electron/shared/contracts/vendorAccountFacts'
import { formatMoney } from '../ai/v4/formatMoney'

export function apimartBillingUrl(locale: string): string {
  return locale.startsWith('zh') ? 'https://apimart.ai/zh/billing' : 'https://apimart.ai/billing'
}

export function formatCreditValue(value: number, locale: string): string {
  return value.toLocaleString(locale, value !== 0 && Math.abs(value) < 0.01
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 })
}

/** APIMart's usage contract defines credits as ten per USD. Only convert its account snapshot. */
export function accountBalanceUsd(snapshot: VendorAccountFacts | null, locale: string): string | null {
  const balance = snapshot?.accountCredits
  if (balance == null) return null
  const usd = balance / 10
  return usd > 0 && usd < 0.01 ? '<' + formatMoney(locale, 'USD', 0.01) : formatMoney(locale, 'USD', usd)
}
