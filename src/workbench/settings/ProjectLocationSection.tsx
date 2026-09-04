import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconCircleCheck, IconFolderOpen, IconRefresh, IconSettings } from '@tabler/icons-react'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type {
  DesktopProjectLocation,
  DesktopProjectLocationError,
  DesktopProjectLocationResult,
} from '../../desktop/settingsBridge'
import { toast } from '../../ui/toast'

const ERROR_KEY: Record<DesktopProjectLocationError, string> = {
  'not-directory': 'settings.file.projectLocationErrorNotDirectory',
  'not-writable': 'settings.file.projectLocationErrorNotWritable',
  'open-failed': 'settings.file.projectLocationErrorOpenFailed',
  'managed-by-environment': 'settings.file.projectLocationManaged',
}

type CheckFeedback = {
  tone: 'success' | 'error'
  messageKey: string
}

export function ProjectLocationSection(): JSX.Element {
  const { t } = useTranslation()
  const [location, setLocation] = React.useState<DesktopProjectLocation | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const [showSyncSteps, setShowSyncSteps] = React.useState(false)
  const [checkFeedback, setCheckFeedback] = React.useState<CheckFeedback | null>(null)

  React.useEffect(() => {
    let active = true
    const api = getDesktopBridge()?.settings?.projectLocation
    if (!api) {
      setLoading(false)
      return () => { active = false }
    }
    void api.get()
      .then((result) => {
        if (active && result.ok) setLocation(result.location)
      })
      .catch(() => {
        if (active) toast(t('settings.file.projectLocationErrorUnknown'), 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t])

  const run = async (action: () => Promise<DesktopProjectLocationResult>): Promise<void> => {
    setBusy(true)
    try {
      const result = await action()
      if (result.ok) {
        if (!result.canceled) setLocation(result.location)
      } else {
        toast(t(ERROR_KEY[result.error]), 'error')
      }
    } catch {
      toast(t('settings.file.projectLocationErrorUnknown'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const api = getDesktopBridge()?.settings?.projectLocation
  const managed = location?.source === 'environment'
  const unavailable = loading || busy || !api

  const checkDirectory = async (): Promise<void> => {
    if (!api) return
    setChecking(true)
    setCheckFeedback(null)
    try {
      const result = await api.check()
      if (result.ok) {
        setLocation(result.location)
        setCheckFeedback({ tone: 'success', messageKey: 'settings.file.projectLocationCheckSuccess' })
        toast(t('settings.file.projectLocationCheckSuccess'), 'success')
      } else {
        setCheckFeedback({ tone: 'error', messageKey: ERROR_KEY[result.error] })
        toast(t(ERROR_KEY[result.error]), 'error')
      }
    } catch {
      setCheckFeedback({ tone: 'error', messageKey: 'settings.file.projectLocationErrorUnknown' })
      toast(t('settings.file.projectLocationErrorUnknown'), 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="border-t border-nomi-line pt-4" data-settings-project-location aria-busy={loading || busy}>
      <section aria-labelledby="settings-project-location-title">
        <div id="settings-project-location-title" className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.file.projectLocation')}</div>
        <div
          className="truncate rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 font-mono text-caption text-nomi-ink-60"
          data-project-location-path
          title={location?.path || undefined}
        >
          {location?.path || (loading ? t('settings.file.projectLocationLoading') : t('settings.file.projectLocationUnavailable'))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <DesignButton
            type="button"
            variant="filled"
            disabled={unavailable || managed}
            leftSection={<IconSettings size={14} stroke={1.7} aria-hidden="true" />}
            onClick={() => { if (api) void run(api.pick) }}
          >
            {t('settings.file.projectLocationChange')}
          </DesignButton>
          <DesignButton
            type="button"
            variant="default"
            disabled={unavailable || !location}
            leftSection={<IconFolderOpen size={14} stroke={1.7} aria-hidden="true" />}
            onClick={() => { if (api) void run(api.reveal) }}
          >
            {t('settings.file.projectLocationReveal')}
          </DesignButton>
          {location?.source === 'custom' ? (
            <DesignButton
              type="button"
              variant="subtle"
              disabled={unavailable}
              leftSection={<IconRefresh size={14} stroke={1.7} aria-hidden="true" />}
              onClick={() => { if (api) void run(api.reset) }}
            >
              {t('settings.file.projectLocationReset')}
            </DesignButton>
          ) : null}
        </div>
        <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">
          {managed ? t('settings.file.projectLocationManaged') : t('settings.file.projectLocationHint')}
        </div>
      </section>

      <section className="mt-5 border-t border-nomi-line pt-4" data-settings-project-sync aria-labelledby="settings-project-sync-title">
        <div className="flex items-center justify-between gap-3">
          <div id="settings-project-sync-title" className="text-body-sm text-nomi-ink">{t('settings.file.projectLocationSyncTitle')}</div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 border-0 bg-transparent p-0 text-caption text-nomi-ink-60 cursor-pointer hover:text-nomi-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={showSyncSteps}
            aria-controls="settings-project-sync-steps"
            onClick={() => setShowSyncSteps((current) => !current)}
          >
            {showSyncSteps ? t('settings.file.projectLocationSyncStepsClose') : t('settings.file.projectLocationSyncSteps')}
            <IconChevronDown size={14} stroke={1.7} className={showSyncSteps ? 'rotate-180' : undefined} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-1 text-caption leading-relaxed text-nomi-ink-40">{t('settings.file.projectLocationSyncShortHint')}</div>
        {showSyncSteps ? (
          <ol id="settings-project-sync-steps" className="mt-3 grid gap-3 text-body-sm leading-relaxed text-nomi-ink-60">
            <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span className="text-nomi-ink-40">1</span>
              <span>
                {t('settings.file.projectLocationSyncStepInstallPrefix')}{' '}
                <a href="https://www.verysync.com/" target="_blank" rel="noreferrer" className="text-nomi-accent underline underline-offset-2">{t('settings.file.projectLocationSyncToolVerySync')}</a>{' '}
                {t('settings.file.projectLocationSyncOr')}{' '}
                <a href="https://www.jianguoyun.com/s/downloads" target="_blank" rel="noreferrer" className="text-nomi-accent underline underline-offset-2">{t('settings.file.projectLocationSyncToolNutstore')}</a>
                {t('settings.file.projectLocationSyncStepInstallSuffix')}
              </span>
            </li>
            <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span className="text-nomi-ink-40">2</span>
              <span>{t('settings.file.projectLocationSyncStepAdd')}</span>
            </li>
            <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span className="text-nomi-ink-40">3</span>
              <span>{t('settings.file.projectLocationSyncStepWait')}</span>
            </li>
          </ol>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-nomi-sm bg-workbench-success-soft px-2.5 py-2" aria-live="polite">
          <div className="flex min-w-0 items-center gap-1.5 text-caption text-workbench-success">
            <IconCircleCheck size={14} stroke={1.8} aria-hidden="true" />
            <span className="truncate">{t('settings.file.projectLocationConfigured')}</span>
          </div>
          <button
            type="button"
            className="shrink-0 border-0 bg-transparent p-0 text-caption text-workbench-success cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            disabled={unavailable || checking}
            onClick={() => { void checkDirectory() }}
           >
             {checking ? t('settings.file.projectLocationChecking') : t('settings.file.projectLocationCheck')}
           </button>
         </div>
         <div
           className="mt-2 text-caption text-nomi-ink-60"
           data-project-location-check-feedback
           data-feedback-state={checking ? 'checking' : checkFeedback?.tone || 'idle'}
           data-feedback-tone={checkFeedback?.tone || 'idle'}
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-busy={checking}
         >
           {checking ? t('settings.file.projectLocationChecking') : checkFeedback ? t(checkFeedback.messageKey) : null}
         </div>
       </section>
     </div>
  )
}
