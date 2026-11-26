import React from 'react'
import { useTranslation } from 'react-i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { resolveSendCostLowBalance } from './sendCostLowBalance'
import { markTopUpOpened, useVendorBalance } from './useVendorBalance'

export type ComposerLowBalanceAction = {
  shortfallText: string
  topUpLabel: string
  topUpAriaLabel: string
  description: string
  onTopUp: () => void
}

/**
 * 画布发送键缺额态（板 ModelSurfaces `cost.low-balance`）：
 * 仅在公开约价已就绪且独立读取的账户余额明确不足时返回「还差 N 积分 · 去充值」动作；
 * 余额未知、过期、无限额度或忙着时返回 undefined（无缝退回正常发送键）。
 */
export function useSendCostLowBalance(
  vendorKey: string | undefined,
  quote: VendorPricePreview | undefined,
  { idle }: { idle: boolean },
): ComposerLowBalanceAction | undefined {
  const { t, i18n } = useTranslation()
  const balance = useVendorBalance(idle ? vendorKey : undefined)
  const lowBalance = React.useMemo(
    () => (idle ? resolveSendCostLowBalance(quote, balance, t, i18n.language) : null),
    [idle, quote, balance, t, i18n.language],
  )
  const onTopUp = React.useCallback(() => {
    if (!lowBalance) return
    if (vendorKey) markTopUpOpened(vendorKey)
    window.open(lowBalance.topUpUrl, '_blank', 'noopener,noreferrer')
  }, [lowBalance, vendorKey])

  if (!lowBalance) return undefined
  return {
    shortfallText: lowBalance.shortfallText,
    topUpLabel: lowBalance.topUpLabel,
    topUpAriaLabel: lowBalance.topUpAriaLabel,
    description: lowBalance.description,
    onTopUp,
  }
}
