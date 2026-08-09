import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock } from '@tabler/icons-react'

import { DesignSwitch, NomiSegmented } from '../../design'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import { buildAutomationSettingsView, type SettingsHostKey } from './settingsAutomationView'

type Props = {
  settings: AutomationPolicySettings
  onChange: (patch: Partial<AutomationPolicySettings>) => void
}

function SettingRow({
  title,
  hint,
  section,
  children,
}: {
  title: string
  hint: string
  section?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div data-settings-section={section} className="flex min-h-12 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-body-sm text-nomi-ink">{title}</div>
        <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function LockedRule({ title, hint }: { title: string; hint: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <SettingRow title={title} hint={hint}>
      <span className="inline-flex items-center gap-1 rounded-full bg-nomi-ink-05 px-2 py-1 text-micro text-nomi-ink-60">
        <IconLock size={12} stroke={1.7} aria-hidden="true" />
        {t('settings.automation.always')}
      </span>
    </SettingRow>
  )
}

export function AutomationPermissionsSection({ settings, onChange }: Props): JSX.Element {
  const { t } = useTranslation()
  const view = buildAutomationSettingsView(settings)
  const toggleHost = (host: SettingsHostKey, enabled: boolean): void => {
    if (host === 'nomi') return
    const next = new Set(settings.trustedHosts)
    if (enabled) next.add(host)
    else next.delete(host)
    onChange({ trustedHosts: ['nomi', ...[...next].filter((item) => item !== 'nomi')] })
  }

  return (
    <div data-settings-section="automation">
      <h2 className="mb-5 text-title font-medium text-nomi-ink">{t('settings.automation.title')}</h2>

      <section className="mb-6" aria-labelledby="settings-mode-title">
        <h3 id="settings-mode-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.mode.title')}
        </h3>
        <NomiSegmented
          value={view.mode}
          ariaLabel={t('settings.automation.mode.title')}
          onChange={(value) => onChange({ mode: value as AutomationPolicySettings['mode'] })}
          options={[
            { value: 'guided', label: t('settings.automation.mode.guided') },
            { value: 'balanced', label: t('settings.automation.mode.balanced') },
            { value: 'policy-auto', label: t('settings.automation.mode.policyAuto') },
          ]}
        />
        <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">
          {t(`settings.automation.mode.hint.${view.mode}`)}
        </div>
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-risk-title">
        <h3 id="settings-risk-title" className="text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.risk.title')}
        </h3>
        <LockedRule title={t('settings.automation.risk.firstSpend')} hint={t('settings.automation.risk.firstSpendHint')} />
        <SettingRow title={t('settings.automation.risk.continue')} hint={t('settings.automation.risk.continueHint')}>
          <DesignSwitch
            checked={settings.autoContinueWithinBudget}
            onChange={(event) => onChange({ autoContinueWithinBudget: event.currentTarget.checked })}
            aria-label={t('settings.automation.risk.continue')}
          />
        </SettingRow>
        <LockedRule title={t('settings.automation.risk.irreversible')} hint={t('settings.automation.risk.irreversibleHint')} />
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-hosts-title">
        <h3 id="settings-hosts-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.hosts.title')}
        </h3>
        {view.hosts.map((host) => (
          <SettingRow
            key={host.key}
            section={host.key === 'cursor' ? 'cursor-host' : undefined}
            title={t(`settings.automation.hosts.${host.key}.name`)}
            hint={t(`settings.automation.hosts.${host.key}.hint`)}
          >
            {host.locked ? (
              <span className="text-caption text-nomi-success">{t('settings.automation.hosts.local')}</span>
            ) : (
              <DesignSwitch
                checked={host.enabled}
                onChange={(event) => toggleHost(host.key, event.currentTarget.checked)}
                aria-label={t(`settings.automation.hosts.${host.key}.name`)}
              />
            )}
          </SettingRow>
        ))}
      </section>

      <section className="border-t border-nomi-line pt-4" aria-labelledby="settings-notifications-title">
        <h3 id="settings-notifications-title" className="text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.notifications.title')}
        </h3>
        <SettingRow title={t('settings.automation.notifications.system')} hint={t('settings.automation.notifications.systemHint')}>
          <DesignSwitch
            checked={settings.systemNotifications}
            onChange={(event) => onChange({ systemNotifications: event.currentTarget.checked })}
            aria-label={t('settings.automation.notifications.system')}
          />
        </SettingRow>
        <SettingRow title={t('settings.automation.notifications.sound')} hint={t('settings.automation.notifications.soundHint')}>
          <DesignSwitch
            checked={settings.notificationSound}
            onChange={(event) => onChange({ notificationSound: event.currentTarget.checked })}
            aria-label={t('settings.automation.notifications.sound')}
          />
        </SettingRow>
      </section>
    </div>
  )
}
