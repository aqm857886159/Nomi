import React from 'react'
import { useTranslation } from 'react-i18next'
import { useVendorAccountFacts } from '../../../ui/onboarding/useVendorAccountFacts'
import { apimartBillingUrl, formatCreditValue, priceBalanceStatus, publicEstimateUsd } from '../../common/apimartAccountDisplay'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import type { ComposerSendButton } from '../nodes/ComposerSendButton'
import { useNodePricePreview } from './useNodePricePreview'
import type { VendorAccountFacts } from '../../../../electron/shared/contracts/vendorAccountFacts'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'

type SendCostSlot = NonNullable<React.ComponentProps<typeof ComposerSendButton>['cost']>

/** 发送键那一格要说的：胶囊上的积分数 / 余额不够时换成的「还差 N 积分 · 去充值」，以及悬停那一句。 */
export type SendCost = {
  /** 交给共用发送钮的花费槽；算不出价、忙着 = undefined（钮上只剩 ↑，不印数、不印 0）。 */
  slot?: SendCostSlot
  /** 悬停 / 读屏那一句：「这次约 N 积分（$x）。按 APIMart 公开价估…」或「暂时估不出这次用量」。不走这家估价时 undefined。 */
  description?: string
  /** 估价从哪来（走查锚点）。 */
  source?: string
}

/**
 * 生成框发送键旁的公开估价（板 ModelSurfaces：cost.send-pill / cost.hover / cost.low-balance）。
 * 只给走公开价的那家估；忙着 / 要先备齐参考时不印数（那时钮的意思不是「花这么多发出去」）。
 * 余额不够那一态只在「余额是刚查到的真数、且低于估价」时出现（`priceBalanceStatus` 只认 30 秒内、Key 有效的读数）；
 * 余额为零和它是同一个样子。查不到余额 → 平常的胶囊。
 */
export function useSendCost(node: GenerationCanvasNode, graph: ComposerGraph, { idle }: { idle: boolean }): SendCost {
  const { t, i18n } = useTranslation()
  const { quote, vendorKey } = useNodePricePreview(node, graph)
  const { facts, refresh } = useVendorAccountFacts(quote ? vendorKey : undefined)
  const description = quote ? t(quote.basis === 'output-estimate' ? 'onboardingProviders.account.outputEstimate' : 'onboardingProviders.account.estimate', {
    value: formatCreditValue(quote.credits, i18n.language),
    usd: publicEstimateUsd(quote, i18n.language),
  }) : vendorKey ? t('onboardingProviders.account.priceUnknown') : undefined
  const onBilling = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // 换成「去充值」之后余额读数可能已过期：过期就只重读，不把人送去充值页。
    const now = priceBalanceStatus(quote, facts, Date.now())
    if (!now.zero && now.estimatedGap <= 0) { refresh(); return }
    window.open(apimartBillingUrl(i18n.language), '_blank', 'noopener,noreferrer')
  }, [quote, facts, refresh, i18n.language])
  const state = sendCostState(quote, facts, { idle, now: Date.now() })
  const slot: SendCostSlot | undefined = state.kind === 'none' ? undefined
    : state.kind === 'shortfall'
      ? {
        kind: 'shortfall',
        text: t('onboardingProviders.account.shortBy', { value: formatCreditValue(state.credits, i18n.language) }),
        actionLabel: t('onboardingProviders.account.billing'),
        onAction: onBilling,
      }
      : { kind: 'credits', text: (state.approximate ? '≈' : '') + formatCreditValue(state.credits, i18n.language) }
  return { slot, description, source: quote?.source }
}

/**
 * 发送键那一格该是哪一态（纯函数，单测钉住）：
 * - `none`：忙着 / 要先备齐参考 / 算不出价 —— 钮上只剩 ↑，不印数、不印 0；
 * - `shortfall`：余额是刚查到的真数（30 秒内、Key 有效）且低于估价，或可用额度为零 —— 「还差 N 积分 · 去充值」；
 * - `credits`：其余（含余额查不到）—— 硬币 + 积分数的胶囊。
 */
export function sendCostState(
  quote: VendorPricePreview | null,
  facts: VendorAccountFacts | null,
  { idle, now }: { idle: boolean; now: number },
): { kind: 'none' } | { kind: 'shortfall'; credits: number } | { kind: 'credits'; credits: number; approximate: boolean } {
  if (!idle || !quote || !(quote.credits > 0)) return { kind: 'none' }
  const { zero, estimatedGap } = priceBalanceStatus(quote, facts, now)
  // 余额为零时「还差」就是整笔估价（按输出估的也一样：那是下限，差的只多不少）。
  const shortfall = zero ? Math.max(estimatedGap, quote.credits) : estimatedGap
  if (shortfall > 0) return { kind: 'shortfall', credits: shortfall }
  return { kind: 'credits', credits: quote.credits, approximate: quote.basis === 'output-estimate' }
}
