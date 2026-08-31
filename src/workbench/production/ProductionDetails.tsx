import React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../utils/cn'
import type { ProductionRunView } from './productionRunView'

type Props = {
  details: ProductionRunView['details']
}

function formatAmount(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function ProductionDetails({ details }: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const budget = details.budget
  const amount = (value: number) => formatAmount(value, budget.currency, i18n.language)
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
            <span className={cn('truncate text-nomi-ink-80')}>{stage.title}</span>
            <span className={cn('shrink-0 text-micro text-nomi-ink-60')}>
              {t(`generationCommon.production.runDetails.stageStatus.${stage.status}`)}
            </span>
          </div>
        ))}
      </div>
      <dl className={cn('grid grid-cols-2 gap-x-3 gap-y-2 text-caption')}>
        <div>
          <dt className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.authorized')}</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums text-nomi-ink')}>{amount(budget.authorized)}</dd>
        </div>
        <div>
          <dt className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.reserved')}</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums text-nomi-ink')}>{amount(budget.reserved)}</dd>
        </div>
        <div>
          <dt className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.actual')}</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums text-nomi-ink')}>{amount(budget.actual)}</dd>
        </div>
        <div>
          <dt className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.unsettled')}</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums text-nomi-ink')}>{amount(budget.unsettled)}</dd>
        </div>
      </dl>
      <div className={cn('grid gap-1 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.skills')}</span>
        <span className={cn('text-nomi-ink-80')}>
          {details.skills.length > 0
            ? details.skills.map((skill) => `${skill.name} v${skill.version}`).join(' · ')
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
