import React from 'react'
import { IconAlertTriangle, IconCheck, IconCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { VendorAccountBalance } from '../../../electron/shared/contracts/vendorAccountBalance'
import type { ApimartCatalogCounts } from './onboardingModelAvailability'

export function ApimartCheckCard({ complete, token, account, counts }: {
  complete: boolean
  token: VendorAccountBalance | null
  account?: VendorAccountBalance | null
  counts: ApimartCatalogCounts
}) {
  const { t } = useTranslation()
  const limit = token?.unlimitedQuota || token?.unlimited ? t('modelSetup.apimartVerification.unlimited')
    : token?.remainCredits != null ? t('modelSetup.apimartVerification.credits', { value: token.remainCredits })
    : t('modelSetup.apimartVerification.unknown')
  const balance = account?.unlimited ? t('modelSetup.apimartVerification.unlimited')
    : account?.remainCredits != null ? t('modelSetup.apimartVerification.credits', { value: account.remainCredits })
    : t('modelSetup.apimartVerification.unknown')
  const usd = account?.remainCredits && account.remainUsd != null ? ` ($${account.remainUsd.toFixed(2)})` : ''
  const rows = [
    ['valid', ''], ['account', balance + usd], ['limit', limit],
    ['models', t('modelSetup.apimartVerification.counts', counts)],
  ]
  const Mark = complete ? IconCheck : IconCircle
  return <>
    <ul aria-live="polite" data-apimart-checks className="space-y-2 rounded-field border border-nomi-line p-3">
    {rows.map(([key, detail]) => <li key={key} className="flex items-center gap-2 text-body-sm">
      {key === 'account' && complete && account?.remainCredits === 0 && !account.unlimited
        ? <IconAlertTriangle size={14} aria-hidden className="text-nomi-warning" />
        : <Mark size={14} aria-hidden className={complete ? 'text-workbench-success' : 'text-nomi-ink-40'} />}
      <span>{t(`modelSetup.apimartVerification.${key}`)}</span>
      {complete && <span className="text-nomi-ink-60">{detail}</span>}
    </li>)}
    </ul>
    {account?.remainCredits !== 0 && <p className="text-caption text-nomi-ink-60">{t('modelSetup.apimartVerification.afterPaste')}</p>}
  </>
}
