import React from 'react'
import { IconAlertTriangle, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { openModelSettingsHome } from './apimartConnectRoute'
import { WorkbenchButton } from '../../design'

export function ApimartStatusNotice({ kind, onAction, id }: {
  kind: 'format' | 'keychain' | 'invalid' | 'offline'
  onAction: () => void
  id: string
}) {
  const { t } = useTranslation()
  const official = kind === 'format' || kind === 'invalid'
  return (
    <div role="alert" id={id} data-apimart-key-error={kind} className={`space-y-1 rounded-field px-3 py-2 text-body-sm ${kind === 'offline' ? 'bg-nomi-warning/10 text-nomi-ink' : 'bg-workbench-danger-soft text-workbench-danger'}`}>
      <div className="flex items-center gap-2 font-semibold"><IconAlertTriangle size={16} aria-hidden />
        {t(`modelSetup.apimartVerification.${kind}Title`)}
      </div>
      <p>{t(`modelSetup.apimartVerification.${kind}Body`)}</p>
      <WorkbenchButton size="sm" variant="primary" iconTier="corner" onClick={onAction}>
        {official ? <>{t('onboardingProviders.apimartConnect.openSite')}<IconExternalLink aria-hidden /></> : t(kind === 'offline' ? 'modelSetup.apimartVerification.recheck' : 'modelSetup.apimartVerification.retry')}
      </WorkbenchButton>
      {kind === 'offline' && <button type="button" className="ml-2 text-nomi-accent" onClick={() => openModelSettingsHome({ scrollToNetwork: true })}>
        {t('modelSetup.apimartVerification.network')}
      </button>}
    </div>
  )
}
