import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../utils/cn'
import { productionPlaybookLabelKey, productionStageLabelKey } from './productionRunLabels'
import type { ProductionRunView } from './productionRunView'

type Props = {
  details: ProductionRunView['details']
}

// 界面不谈钱：这里原有四个金额格（已授权 / 已预留 / 已结算 / 待结算），值是把账本合计现算成货币。
// 账本合计只加已知价，算不出价的镜头不在里面，实付也从不回写——四格印出来的零金额没有依据（2026-10-27 删，
// 方向检查 docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md）。视图里也不再带预算，
// 界面上新写金额格式化由 ESLint 的 ui-money 规则拦（scripts/ui-money-format.mjs）。
export function ProductionDetails({ details }: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const updatedAt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(details.updatedAt))

  return (
    <div className={cn('grid gap-3 pt-3')}>
      <div className={cn('flex items-center justify-between gap-3 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.stages')}</span>
        <span className={cn('font-medium tabular-nums text-nomi-ink')}>
          {t('generationCommon.production.runDetails.stageCount', {
            completed: details.completedStages,
            total: details.totalStages,
          })}
        </span>
      </div>
      <div className={cn('grid gap-1.5')}>
        {details.stages.map((stage) => (
          <div key={stage.stageId} className={cn('flex items-center justify-between gap-3 text-caption')}>
            <span className={cn('truncate text-nomi-ink-80')}>{t(productionStageLabelKey(stage.stageId))}</span>
            <span className={cn('shrink-0 text-micro text-nomi-ink-60')}>
              {t(`generationCommon.production.runDetails.stageStatus.${stage.status}`)}
            </span>
          </div>
        ))}
      </div>
      <div className={cn('grid gap-1 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.skills')}</span>
        <span className={cn('text-nomi-ink-80')}>
          {/* 技能证据记的是流程身份（name@version），上屏只给人话名。 */}
          {details.skills.length > 0
            ? [...new Set(details.skills.map((skill) => t(productionPlaybookLabelKey(skill.name))))].join(' · ')
            : t('generationCommon.production.runDetails.noSkills')}
        </span>
      </div>
      <div className={cn('flex items-center justify-between gap-3 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.updatedAt')}</span>
        <time dateTime={details.updatedAt} className={cn('text-right tabular-nums text-nomi-ink-80')}>{updatedAt}</time>
      </div>
    </div>
  )
}
