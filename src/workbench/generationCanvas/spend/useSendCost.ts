import React from 'react'
import { useTranslation } from 'react-i18next'
import { useVendorAccountFacts } from '../../../ui/onboarding/useVendorAccountFacts'
import { apimartBillingUrl, formatCreditValue, priceBalanceStatus, publicEstimateUsd } from '../../common/apimartAccountDisplay'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import { useNodePricePreview } from './useNodePricePreview'

/** 发送键那颗胶囊上要说的：积分数（算出来才有）、悬停那一句、余额为 0 时换成「去充值」。 */
export type SendCost = {
  /** 胶囊上印的数（「≈」前缀 = 按输出估）；算不出 = undefined，钮上只剩 ↑。 */
  credits?: string
  /** 悬停 / 读屏那一句：「约 N 积分（$x）· 按公开价估」或「暂时估不出这次用量」。不走这家估价时 undefined。 */
  description?: string
  /** 估价从哪来（走查锚点）。 */
  source?: string
  /** 余额为 0：钮换成「去充值」。 */
  billing: boolean
  billingLabel: string
  onBilling: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** 钮下面那一行：余额为 0 /「还差 N 积分」；不缺时 undefined。 */
  notice?: { text: string; canRefresh: boolean }
  refresh: () => void
}

/**
 * 生成框发送键旁的公开估价（板 ModelSurfaces：cost.send-pill / cost.hover / cost.low-balance）。
 * 只给走公开价的那家估；忙着 / 要先备齐参考时不印数（那时钮的意思不是「花这么多发出去」）。
 */
export function useSendCost(node: GenerationCanvasNode, graph: ComposerGraph, { idle }: { idle: boolean }): SendCost {
  const { t, i18n } = useTranslation()
  const { quote, vendorKey } = useNodePricePreview(node, graph)
  const { facts, refresh } = useVendorAccountFacts(quote ? vendorKey : undefined)
  const { zero, estimatedGap } = priceBalanceStatus(quote, facts, Date.now())
  const description = quote ? t(quote.basis === 'output-estimate' ? 'onboardingProviders.account.outputEstimate' : 'onboardingProviders.account.estimate', {
    value: formatCreditValue(quote.credits, i18n.language),
    usd: publicEstimateUsd(quote, i18n.language),
  }) : vendorKey ? t('onboardingProviders.account.priceUnknown') : undefined
  const billing = zero && idle
  const onBilling = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // 钮画成「去充值」之后余额读数可能已过期：过期就只重读，不把人送去充值页。
    if (!priceBalanceStatus(quote, facts, Date.now()).zero) { refresh(); return }
    window.open(apimartBillingUrl(i18n.language), '_blank', 'noopener,noreferrer')
  }, [quote, facts, refresh, i18n.language])
  return {
    credits: idle && quote && !zero ? (quote.basis === 'output-estimate' ? '≈' : '') + formatCreditValue(quote.credits, i18n.language) : undefined,
    description,
    source: quote?.source,
    billing,
    billingLabel: t('onboardingProviders.account.billing'),
    onBilling,
    notice: idle && (zero || estimatedGap > 0)
      ? { text: zero ? t('onboardingProviders.account.zero') : t('onboardingProviders.account.shortfall', { value: formatCreditValue(estimatedGap, i18n.language) }), canRefresh: zero }
      : undefined,
    refresh,
  }
}
