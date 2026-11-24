import React from 'react'
import { IconAlertTriangle, IconCheck, IconCircleDashed } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { VendorReportedBalance } from '../../../electron/shared/contracts/vendorAccountBalance'
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
  const rows = [
    { key: 'valid', detail: '' },
    { key: 'account', detail: credits(account), snapshot: account ?? null },
    { key: 'limit', detail: credits(token), snapshot: token },
    { key: 'models', detail: t('modelSetup.apimartVerification.counts', counts) },
  ]
  return <>
    <ul aria-live="polite" data-apimart-checks className="space-y-2 rounded-field border border-nomi-line p-3">
      {rows.map(({ key, detail, snapshot }) => {
        const known = complete && snapshot !== null
        const empty = known && snapshot?.remainCredits === 0
        const Mark = empty ? IconAlertTriangle : known ? IconCheck : IconCircleDashed
        return <li key={key} className="flex items-center gap-2 text-body-sm">
          <Mark size={14} aria-hidden className={empty ? 'text-nomi-warning' : known ? 'text-workbench-success' : 'text-nomi-ink-40'} />
          <span>{t(`modelSetup.apimartVerification.${key}`)}</span>
          {complete && <span className="text-nomi-ink-60">{detail}</span>}
        </li>
      })}
    </ul>
    {account?.remainCredits !== 0 && <p className="text-caption text-nomi-ink-60">{t('modelSetup.apimartVerification.afterPaste')}</p>}
  </>
}
