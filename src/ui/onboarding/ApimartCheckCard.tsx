import React from 'react'
import { IconAlertTriangle, IconCheck, IconCircleDashed } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { VendorReportedBalance } from '../../../electron/shared/contracts/vendorAccountBalance'
import { isExhaustedBalance } from './useApimartVerification'
import type { ApimartCatalogCounts } from './onboardingModelAvailability'

export function ApimartCheckCard({ complete, token, account, counts }: {
  complete: boolean
  token: VendorReportedBalance | null
  account?: VendorReportedBalance | null
  counts: ApimartCatalogCounts
}) {
  const { t } = useTranslation()
  const credits = (snapshot?: VendorReportedBalance | null) => {
    if (!snapshot) return t('modelSetup.apimartVerification.unknown')
    if (snapshot.unlimited) return t('modelSetup.apimartVerification.unlimited')
    if (snapshot.remainCredits !== null) return t('modelSetup.apimartVerification.credits', { value: snapshot.remainCredits })
    return t('modelSetup.apimartVerification.unspecifiedUnit', { value: snapshot.reportedBalance })
  }
  const accountEmpty = isExhaustedBalance(account)
  const keyEmpty = isExhaustedBalance(token)
  const rows = [
    { key: 'valid', detail: '' },
    { key: 'account', detail: credits(account), snapshot: account ?? null, exhausted: accountEmpty },
    { key: 'limit', detail: credits(token), snapshot: token, exhausted: keyEmpty },
    { key: 'models', detail: t('modelSetup.apimartVerification.counts', counts) },
  ]
  return <>
    <ul aria-live="polite" data-apimart-checks className="space-y-2 rounded-field border border-nomi-line p-3">
      {rows.map(({ key, detail, snapshot, exhausted }) => {
        const known = complete && snapshot !== null
        const empty = known && exhausted
        const Mark = empty ? IconAlertTriangle : known ? IconCheck : IconCircleDashed
        return <li key={key} className="flex items-center gap-2 text-body-sm">
          <Mark size={14} aria-hidden className={empty ? 'text-nomi-warning' : known ? 'text-workbench-success' : 'text-nomi-ink-40'} />
          <span>{t(`modelSetup.apimartVerification.${key}`)}</span>
          {complete && <span className={empty ? 'text-nomi-warning-ink' : 'text-nomi-ink-60'}>{detail}</span>}
        </li>
      })}
    </ul>
    {!accountEmpty && !keyEmpty && <p className="text-caption text-nomi-ink-60">{t('modelSetup.apimartVerification.afterPaste')}</p>}
  </>
}
