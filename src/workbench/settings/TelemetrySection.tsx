import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconEye, IconTrash } from '@tabler/icons-react'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { TelemetrySettingsView, TelemetrySummary } from '../../../electron/shared/contracts/telemetry'

export function TelemetrySection(): JSX.Element {
  const { t } = useTranslation()
  const api = getDesktopBridge()?.settings?.telemetry
  const [settings, setSettings] = React.useState<TelemetrySettingsView | null>(null)
  const [summary, setSummary] = React.useState<TelemetrySummary | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [viewingSummary, setViewingSummary] = React.useState(false)

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!api) return
    try {
      const [next, local] = await Promise.all([api.get(), api.summary()])
      setSettings(next)
      setSummary(local)
    } catch { /* old preload or unavailable settings: remain quiet */ }
  }, [api])

  React.useEffect(() => { void refresh() }, [refresh])

  const toggle = async (enabled: boolean): Promise<void> => {
    if (!api) return
    setBusy(true)
    try {
      const next = await api.set({ enabled })
      setSettings(next)
      const local = await api.summary()
      setSummary(local)
    } finally { setBusy(false) }
  }

  const removeAll = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    try {
      await api.deleteAll()
      await refresh()
    } finally { setBusy(false) }
  }

  if (!api) return <></>
  const statusKey = settings?.status === 'configured' ? 'statusConfigured' : settings?.status === 'unconfigured' ? 'statusUnconfigured' : 'statusDisabled'
  return (
    <section className="mt-5 border-t border-nomi-line pt-4" data-settings-section="telemetry" data-telemetry-state={settings?.status || 'loading'}>
      <div className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.general.telemetry.title')}</div>
      <p className="mb-3 text-caption leading-relaxed text-nomi-ink-40">{t('settings.general.telemetry.description')}</p>
      <label className="flex min-h-9 items-center justify-between gap-3 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-body-sm text-nomi-ink">{t('settings.general.telemetry.toggle')}</span>
          <span className="block text-micro text-nomi-ink-40">{t(`settings.general.telemetry.${statusKey}`)}</span>
        </span>
        <input
          type="checkbox"
          aria-label={t('settings.general.telemetry.toggle')}
          checked={settings?.enabled === true}
          disabled={busy || !settings}
          onChange={(event) => { void toggle(event.target.checked) }}
          className="size-4 accent-nomi-accent"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <DesignButton type="button" variant="default" disabled={busy || !settings} leftSection={<IconEye size={14} aria-hidden="true" />} onClick={() => { setViewingSummary(true); void refresh() }}>
          {t('settings.general.telemetry.viewSummary')}
        </DesignButton>
        {confirmingDelete ? (
          <div className="flex items-center gap-2 rounded-nomi-sm border border-nomi-line px-2 py-1.5" data-telemetry-delete-confirm>
            <span className="text-micro text-nomi-ink-60">{t('settings.general.telemetry.deleteConfirm')}</span>
            <button type="button" className="border-0 bg-transparent px-1 text-micro text-nomi-accent cursor-pointer" onClick={() => { setConfirmingDelete(false); void removeAll() }}>{t('common.confirm')}</button>
            <button type="button" className="border-0 bg-transparent px-1 text-micro text-nomi-ink-60 cursor-pointer" onClick={() => setConfirmingDelete(false)}>{t('common.cancel')}</button>
          </div>
        ) : (
          <DesignButton type="button" variant="subtle" disabled={busy || !summary || (summary.pendingCount + summary.sentCount === 0)} leftSection={<IconTrash size={14} aria-hidden="true" />} onClick={() => setConfirmingDelete(true)}>
            {t('settings.general.telemetry.deleteAll')}
          </DesignButton>
        )}
      </div>
      {summary ? <div className="mt-2 text-micro text-nomi-ink-40" data-telemetry-summary>
        {t('settings.general.telemetry.summary', { pending: summary.pendingCount, sent: summary.sentCount })}
        {viewingSummary ? <div className="mt-2 grid gap-1 text-micro text-nomi-ink-60" data-telemetry-summary-list>
          {[...summary.pending.map((item) => ({ ...item, state: 'pending' })), ...summary.sent.map((item) => ({ ...item, state: 'sent' }))].slice(-20).map((item, index) => (
            <div key={`${item.timestamp}-${item.eventName}-${index}`} className="flex items-center justify-between gap-2">
              <span>{item.eventName}</span><span>{item.state === 'pending' ? t('settings.general.telemetry.pending') : t('settings.general.telemetry.sent')}</span>
            </div>
          ))}
        </div> : null}
      </div> : null}
    </section>
  )
}
