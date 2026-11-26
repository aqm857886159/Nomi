import type { TFunction } from 'i18next'
import type { VendorAccountBalance } from '../../../../electron/shared/contracts/vendorAccountBalance'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { formatCreditValue } from './sendCostFormat'

export type SendCostLowBalance = {
  shortfallCredits: number
  shortfallText: string
  topUpLabel: string
  topUpAriaLabel: string
  description: string
  topUpUrl: string
}

/**
 * 纯函数：根据公开约价与当前有效余额快照判断是否余额不足（板 ModelSurfaces `cost.low-balance`）。
 * - 余额未知、过期（`balance === null`）、无限额度（`unlimited === true`）或余额足够：返回 null（照常显示发送键，绝不误拦）。
 * - 余额明确小于本次约价：返回精确缺额文案「还差 N 积分」与「去充值」跳转地址。
 */
export function resolveSendCostLowBalance(
  quote: VendorPricePreview | undefined | null,
  balance: VendorAccountBalance | null,
  t: TFunction,
  locale: string,
): SendCostLowBalance | null {
  if (!quote || !Number.isFinite(quote.credits) || quote.credits <= 0) return null
  if (!balance || balance.unlimited || balance.remainCredits === null || !Number.isFinite(balance.remainCredits)) return null
  if (!balance.topUpUrl) return null
  const rawShortfall = quote.credits - balance.remainCredits
  // 浮点精度容差：差值小于 1e-6 视为余额足够。
  if (rawShortfall <= 1e-6) return null
  const shortfallValue = formatCreditValue(rawShortfall, locale)
  const balanceValue = formatCreditValue(Math.max(0, balance.remainCredits), locale)
  const needValue = formatCreditValue(quote.credits, locale)
  return {
    shortfallCredits: rawShortfall,
    shortfallText: t('generationCommon.composer.sendCostLowBalance.shortfall', { value: shortfallValue }),
    topUpLabel: t('generationCommon.composer.sendCostLowBalance.topUp'),
    topUpAriaLabel: t('generationCommon.composer.sendCostLowBalance.topUpAria', { value: shortfallValue }),
    description: t('generationCommon.composer.sendCostLowBalance.description', {
      balance: balanceValue,
      need: needValue,
      shortfall: shortfallValue,
    }),
    topUpUrl: balance.topUpUrl,
  }
}
