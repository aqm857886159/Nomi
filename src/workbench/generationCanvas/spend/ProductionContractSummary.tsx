import { IconAlertTriangle, IconCheck } from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../../utils/cn'
import type { ProductionContractView } from './productionContractView'

function formatMoney(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function ProductionContractSummary({ view }: { view: ProductionContractView }): JSX.Element {
  const { t, i18n } = useTranslation()
  const specValues = [
    view.specs.durationSeconds === null ? null : t('generationCommon.production.contract.durationValue', { count: view.specs.durationSeconds }),
    view.specs.aspectRatio,
    view.specs.language,
    view.specs.shotCount === null ? null : t('generationCommon.production.contract.shotValue', { count: view.specs.shotCount }),
  ]
  const specLabels = ['duration', 'aspectRatio', 'language', 'shots'] as const

  return (
    <div className={cn('grid gap-4')} data-production-contract-summary>
      <div className={cn('grid grid-cols-4 border-y border-nomi-line-soft')}>
        {specLabels.map((label, index) => (
          <div key={label} className={cn('min-w-0 border-r border-nomi-line-soft px-3 py-2.5 last:border-r-0')}>
            <div className={cn('text-micro text-nomi-ink-40')}>{t(`generationCommon.production.contract.${label}`)}</div>
            <div className={cn('mt-1 truncate text-body-sm font-semibold text-nomi-ink')}>
              {specValues[index] ?? t('generationCommon.production.contract.notProvided')}
            </div>
          </div>
        ))}
      </div>

      <section className={cn('grid gap-2')}>
        <h3 className={cn('text-caption font-semibold text-nomi-ink')}>{t('generationCommon.production.contract.claims')}</h3>
        {view.claims.length ? view.claims.map((claim) => (
          <div key={claim.text} className={cn('grid grid-cols-[auto_1fr_auto] items-start gap-2 border-b border-nomi-line-soft py-2 last:border-b-0')}>
            {claim.verified
              ? <IconCheck size={14} stroke={1.8} className={cn('mt-0.5 text-workbench-success')} aria-hidden />
              : <IconAlertTriangle size={14} stroke={1.8} className={cn('mt-0.5 text-nomi-warning')} aria-hidden />}
            <span className={cn('text-caption text-nomi-ink-80')}>{claim.text}</span>
            <span className={cn('text-micro text-nomi-ink-40')}>
              {claim.verified
                ? t('generationCommon.production.contract.evidenceCount', { count: claim.evidenceCount })
                : t('generationCommon.production.contract.unverified')}
            </span>
          </div>
        )) : (
          <p className={cn('text-caption text-nomi-ink-40')}>{t('generationCommon.production.contract.noClaims')}</p>
        )}
      </section>

      <div className={cn('grid grid-cols-2 gap-x-5 gap-y-3 border-y border-nomi-line-soft py-3')}>
        <div>
          <div className={cn('text-micro text-nomi-ink-40')}>{t('generationCommon.production.contract.skills')}</div>
          <div className={cn('mt-1 flex flex-wrap gap-1.5')}>
            {view.skills.length ? view.skills.map((skill) => (
              <code key={`${skill.name}@${skill.version}`} className={cn('text-caption text-nomi-ink-80')}>{skill.name}@{skill.version}</code>
            )) : <span className={cn('text-caption text-nomi-ink-40')}>{t('generationCommon.production.contract.noneRecorded')}</span>}
          </div>
        </div>
        <div>
          <div className={cn('text-micro text-nomi-ink-40')}>{t('generationCommon.production.contract.models')}</div>
          <div className={cn('mt-1 grid gap-1')}>
            {view.providerModels.length ? view.providerModels.map((item) => (
              <span key={`${item.provider}:${item.model}`} className={cn('truncate text-caption text-nomi-ink-80')}>{item.provider} · {item.model}</span>
            )) : <span className={cn('text-caption text-nomi-ink-40')}>{t('generationCommon.production.contract.noneRecorded')}</span>}
          </div>
        </div>
      </div>

      <div className={cn('flex items-center justify-between gap-4 bg-nomi-ink-05 px-3 py-3')}>
        <div className={cn('min-w-0')}>
          <div className={cn('text-body-sm font-semibold text-nomi-ink')}>
            {view.cost.known
              ? t('generationCommon.production.contract.estimateKnown', {
                minimum: formatMoney(view.cost.minimum!, view.cost.currency, i18n.language),
                maximum: formatMoney(view.cost.maximum!, view.cost.currency, i18n.language),
              })
              : t('generationCommon.production.contract.estimateUnknown')}
          </div>
          <div className={cn('mt-1 text-caption text-nomi-ink-60')}>
            {t('generationCommon.production.contract.retryBoundary', { count: view.maxAttemptsPerJob })}
          </div>
        </div>
        <div className={cn('shrink-0 text-right')}>
          <div className={cn('text-micro text-nomi-ink-40')}>{t('generationCommon.production.contract.hardLimit')}</div>
          <div
            data-production-hard-budget={view.cost.hardLimit === null ? 'missing' : 'set'}
            className={cn(
              'mt-0.5 inline-flex items-center justify-end gap-1 text-body-sm font-semibold tabular-nums',
              view.cost.hardLimit === null ? 'text-nomi-warning' : 'text-nomi-ink',
            )}
          >
            {view.cost.hardLimit === null ? <><IconAlertTriangle size={15} stroke={1.7} aria-hidden />{t('generationCommon.production.contract.notSet')}</> : `≤ ${formatMoney(view.cost.hardLimit, view.cost.currency, i18n.language)}`}
          </div>
        </div>
      </div>

      <p className={cn('m-0 text-caption leading-relaxed text-nomi-ink-60')}>
        {t('generationCommon.production.contract.irreversibleNote')}
      </p>
      <div className={cn('text-micro text-nomi-ink-30')}>
        {t('generationCommon.production.contract.planIdentity', { version: view.planVersion, hash: view.planHash })}
      </div>
    </div>
  )
}
