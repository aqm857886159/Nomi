import React from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../design'
import { APIMART_REGISTER_URL } from './apimartConnectRoute'

export function ApimartTopUpNotice({ recheck }: { recheck: () => void }) {
  const { t } = useTranslation()
  const openBilling = () => {
    const url = new URL(APIMART_REGISTER_URL)
    url.pathname = '/billing'
    window.open(url.href, '_blank', 'noopener')
  }
  return <div role="status" data-apimart-topup className="space-y-2 rounded-field bg-nomi-warning/10 p-3 text-body-sm text-nomi-ink">
    <p>{t('modelSetup.apimartVerification.topupBody')}</p>
    <div className="flex flex-wrap items-center gap-2">
      <WorkbenchButton size="sm" variant="primary" iconTier="corner" onClick={openBilling}>
        {t('modelSetup.apimartVerification.topup')}<IconExternalLink aria-hidden />
      </WorkbenchButton>
      <WorkbenchButton size="sm" onClick={recheck}>{t('modelSetup.apimartVerification.recheck')}</WorkbenchButton>
    </div>
    <p className="text-caption text-nomi-ink-60">{t('modelSetup.apimartVerification.delayed')}</p>
  </div>
}
