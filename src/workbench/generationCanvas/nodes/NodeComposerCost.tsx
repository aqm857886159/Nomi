import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCoin } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { PlanCostEstimate } from '../spend/planCostEstimate'
import { SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS } from '../spend/spendConfirm'

const creditsFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/**
 * 生成钮 ↑ 左边那一小段只读点数（2026-09-25 用户拍板：单个节点生成不弹窗，花费写在发送按钮旁，像 LibTV 的「⚡ 18」）。
 *
 * 它是「点之前就知道要花多少」的那个承诺（卡点 ②）——不弹确认卡的前提就是它常驻。
 * 数来自目录价的唯一算式（`estimatePlanCost` → `deriveShotPrice`，与主进程报价同一份），× 这一下跑几份。
 * 三态：
 *   - 已标价 → `🪙 0.3`；
 *   - 目录未标价 → `🪙 未标价`（不挡生成，2026-09-21「未知价不许挡生成」）；
 *   - 达到确认门槛 → 同一个数换成 warning 字色，hover 说明「生成前会再确认一次」。
 * 图标用语义词典里「付费 / 消耗额度」那一枚 `IconCoin`（§6），不另起 ⚡。
 * 本地 ComfyUI 不花钱时调用方不渲染它（`generationSpendsCredits`）。
 */
export function NodeComposerCost({ estimate }: { estimate: PlanCostEstimate }): JSX.Element {
  const { t } = useTranslation()
  const amount = estimate.known ? creditsFormat.format(estimate.credits) : null
  const overThreshold = estimate.known && estimate.credits >= SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS
  const title = amount === null
    ? t('generationCommon.spend.catalogUnpriced')
    : overThreshold
      ? t('generationCommon.composer.costWillConfirm', { amount, threshold: SINGLE_RUN_CONFIRM_THRESHOLD_CREDITS })
      : t('generationCommon.spend.catalogCredits', { amount })
  return (
    <span
      data-composer-cost={amount === null ? 'unpriced' : overThreshold ? 'over-threshold' : 'priced'}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-caption tabular-nums',
        amount === null ? 'text-nomi-ink-40' : overThreshold ? 'text-nomi-warning-ink' : 'text-nomi-ink-60',
      )}
    >
      <IconCoin size={14} stroke={1.6} aria-hidden="true" />
      {amount ?? t('generationCommon.composer.costUnpriced')}
    </span>
  )
}
