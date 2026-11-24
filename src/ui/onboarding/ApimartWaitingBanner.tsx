import React from 'react'
import { IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

const storageKey = 'nomi:apimart:opened-at'

export function readApimartOpenedAt(): number {
  try {
    const at = Number(window.localStorage.getItem(storageKey))
    return Number.isFinite(new Date(at).getTime()) && at > 0 ? at : 0
  } catch { return 0 }
}

export function persistApimartOpenedAt(at: number): void {
  try {
    if (at) window.localStorage.setItem(storageKey, String(at))
    else window.localStorage.removeItem(storageKey)
  } catch { /* Keep the in-memory timestamp when storage is unavailable. */ }
}

export function ApimartWaitingBanner({ at, reopen, toggle, expanded }: {
  at: number
  reopen: () => void
  toggle: () => void
  expanded: boolean
}) {
  const { t } = useTranslation()
  const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <div data-apimart-waiting className="mt-4 flex items-start gap-2 rounded-field bg-nomi-accent-soft px-3 py-2 text-body-sm">
      <IconInfoCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-nomi-accent" />
      <span>{t('modelSetup.apimartVerification.opened', { time })}{' '}
        <button type="button" onClick={reopen} className="text-nomi-accent hover:underline">{t('modelSetup.apimartVerification.reopen')}</button>
        {' · '}
        <button type="button" onClick={toggle} aria-expanded={expanded} className="text-nomi-accent hover:underline">
          {t('onboardingProviders.apimartConnect.cantOpenTrigger')}
        </button>
      </span>
    </div>
  )
}
