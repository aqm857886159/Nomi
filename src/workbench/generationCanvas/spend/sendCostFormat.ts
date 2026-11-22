import type { TFunction } from 'i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { formatMoney } from '../../ai/v4/formatMoney'

/**
 * 发送键上的约价印成什么字——**唯一**的一处（键上的积分数、悬停那一句都从这里出）。
 * 以后加单位切换时只改这里，不在发送键或别的钩子里再格式化一遍（`sendCostFormat.test.ts` 守）。
 *
 * 数从哪来：主进程按 APIMart 公开价目算好的 `VendorPricePreview`（`usd` + `credits`，1 美元 = 10 积分）。
 * 小额不印成 0：一分以下按两位有效数字印。
 */
export function formatCreditValue(value: number, locale: string): string {
  return value.toLocaleString(locale, value !== 0 && Math.abs(value) < 0.01
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 })
}

export function publicEstimateUsd(quote: VendorPricePreview, locale: string): string {
  const precision = quote.usd > 0 && quote.usd < 0.001
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 3 }
  return formatMoney(locale, 'USD', quote.usd, precision)
}

/** 键上的数字：只估了输出部分的（按 token 结算的型号）前面加「≈」。 */
export function sendCostPillText(quote: VendorPricePreview, locale: string): string {
  return (quote.basis === 'output-estimate' ? '≈' : '') + formatCreditValue(quote.credits, locale)
}

/** 悬停 / 读屏那一句。`quote` 为 null = 这家走公开价、但这次估不出。 */
export function sendCostDescription(quote: VendorPricePreview | null, t: TFunction, locale: string): string {
  if (!quote) return t('generationCommon.composer.sendCost.priceUnknown')
  return t(quote.basis === 'output-estimate'
    ? 'generationCommon.composer.sendCost.outputEstimate'
    : 'generationCommon.composer.sendCost.estimate', {
    value: formatCreditValue(quote.credits, locale),
    usd: publicEstimateUsd(quote, locale),
  })
}
