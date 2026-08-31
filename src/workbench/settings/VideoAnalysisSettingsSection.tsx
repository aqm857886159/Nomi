import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertCircle, IconCheck, IconRefresh, IconTrash } from '@tabler/icons-react'

import { DesignSwitch, NomiSegmented } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopSettingsBridge } from '../../desktop/settingsBridge'
import type { VideoAnalysisSettings } from '../../../electron/settings/videoAnalysisSettings'
import type { VideoAnalysisHealthProjection } from '../../../electron/videoAnalysis/ipc'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'

const DEFAULT_SETTINGS: VideoAnalysisSettings = {
  schemaVersion: 1,
  engineOrigin: 'http://127.0.0.1:8931',
  hasApiToken: false,
  externalInference: false,
  engineSourceRetention: 'delete_after_analysis',
}

export function VideoAnalysisSettingsSection(): JSX.Element {
  const { t } = useTranslation()
  const [settings, setSettings] = React.useState(DEFAULT_SETTINGS)
  const [originDraft, setOriginDraft] = React.useState(DEFAULT_SETTINGS.engineOrigin)
  const [tokenDraft, setTokenDraft] = React.useState('')
  const [health, setHealth] = React.useState<VideoAnalysisHealthProjection | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [cleanupMessage, setCleanupMessage] = React.useState('')

  const refreshHealth = React.useCallback(async (): Promise<void> => {
    const probe = getDesktopBridge()?.videoAnalysis?.health
    if (!probe) return
    setBusy(true)
    try {
      setHealth(await probe())
    } catch (cause) {
      setHealth(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  React.useEffect(() => {
    const bridge = getDesktopBridge()?.settings?.videoAnalysis
    if (!bridge) return
    void bridge.get()
      .then((stored) => {
        setSettings(stored)
        setOriginDraft(stored.engineOrigin)
        void refreshHealth()
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [refreshHealth])

  const persist = async (patch: Parameters<DesktopSettingsBridge['videoAnalysis']['set']>[0]): Promise<void> => {
    const bridge = getDesktopBridge()?.settings?.videoAnalysis
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      const stored = await bridge.set(patch)
      setSettings(stored)
      setOriginDraft(stored.engineOrigin)
      await refreshHealth()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const statusKey = !settings.hasApiToken
    ? 'unconfigured'
    : health?.reachable
      ? 'connected'
      : health
        ? 'unreachable'
      : 'checking'

  const cleanupSources = async (): Promise<void> => {
    const projectId = getActiveWorkbenchProjectId()
    const cleanup = getDesktopBridge()?.videoAnalysis?.cleanup
    if (!projectId || !cleanup) return
    setBusy(true)
    setError('')
    setCleanupMessage('')
    try {
      const result = await cleanup(projectId)
      setCleanupMessage(t('settings.automation.videoAnalysis.cleanupResult', result))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-6 scroll-mt-4 border-t border-nomi-line pt-4"
      aria-labelledby="settings-video-analysis-title"
      data-settings-section="video-analysis"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="settings-video-analysis-title" className="text-caption font-medium text-nomi-ink-60">
            {t('settings.automation.videoAnalysis.title')}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-caption text-nomi-ink-60" aria-live="polite">
            <span
              className={health?.reachable ? 'size-1.5 rounded-full bg-nomi-success' : 'size-1.5 rounded-full bg-nomi-ink-20'}
              aria-hidden="true"
            />
            {t(`settings.automation.videoAnalysis.status.${statusKey}`)}
            {health?.version ? <span className="font-mono text-micro text-nomi-ink-40">{health.version}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05 disabled:opacity-40"
          aria-label={t('settings.automation.videoAnalysis.refresh')}
          title={t('settings.automation.videoAnalysis.refresh')}
          disabled={busy}
          onClick={() => void refreshHealth()}
        >
          <IconRefresh size={15} stroke={1.8} aria-hidden="true" />
        </button>
      </div>

      <label htmlFor="video-analysis-origin" className="mb-1 block text-micro text-nomi-ink-40">
        {t('settings.automation.videoAnalysis.origin')}
      </label>
      <input
        id="video-analysis-origin"
        value={originDraft}
        onChange={(event) => setOriginDraft(event.currentTarget.value)}
        onBlur={() => {
          if (originDraft.trim() !== settings.engineOrigin) void persist({ engineOrigin: originDraft })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        spellCheck={false}
        className="mb-3 h-9 w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 font-mono text-caption text-nomi-ink outline-none focus:border-nomi-accent"
      />

      <label htmlFor="video-analysis-token" className="mb-1 block text-micro text-nomi-ink-40">
        {t('settings.automation.videoAnalysis.token')}
      </label>
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <input
          id="video-analysis-token"
          type="password"
          value={tokenDraft}
          onChange={(event) => setTokenDraft(event.currentTarget.value)}
          placeholder={settings.hasApiToken
            ? t('settings.automation.videoAnalysis.tokenConfigured')
            : t('settings.automation.videoAnalysis.tokenPlaceholder')}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-caption text-nomi-ink outline-none focus:border-nomi-accent"
        />
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-nomi-sm bg-nomi-ink px-3 text-caption text-nomi-paper disabled:opacity-40"
          disabled={!tokenDraft.trim() || busy}
          onClick={() => {
            void persist({ apiToken: tokenDraft }).then(() => setTokenDraft(''))
          }}
        >
          <IconCheck size={14} stroke={1.9} aria-hidden="true" />
          {t('settings.automation.videoAnalysis.saveToken')}
        </button>
        {settings.hasApiToken ? (
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-40 hover:text-nomi-danger"
            aria-label={t('settings.automation.videoAnalysis.clearToken')}
            title={t('settings.automation.videoAnalysis.clearToken')}
            onClick={() => void persist({ clearApiToken: true })}
          >
            <IconTrash size={15} stroke={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex min-h-12 items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <div className="text-body-sm text-nomi-ink">{t('settings.automation.videoAnalysis.externalInference')}</div>
          <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">
            {t('settings.automation.videoAnalysis.externalInferenceHint')}
          </div>
        </div>
        <DesignSwitch
          checked={settings.externalInference}
          onChange={(event) => void persist({ externalInference: event.currentTarget.checked })}
          aria-label={t('settings.automation.videoAnalysis.externalInference')}
        />
      </div>

      <div className="mt-2">
        <div className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.automation.videoAnalysis.retention')}</div>
        <NomiSegmented
          value={settings.engineSourceRetention}
          ariaLabel={t('settings.automation.videoAnalysis.retention')}
          onChange={(value) => void persist({ engineSourceRetention: value as VideoAnalysisSettings['engineSourceRetention'] })}
          options={[
            { value: 'delete_after_analysis', label: t('settings.automation.videoAnalysis.retentionDelete') },
            { value: 'keep', label: t('settings.automation.videoAnalysis.retentionKeep') },
          ]}
        />
        <div className="mt-1.5 text-caption leading-relaxed text-nomi-ink-40">
          {t('settings.automation.videoAnalysis.retentionHint')}
        </div>
        <button
          type="button"
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 disabled:opacity-40"
          disabled={busy || !getActiveWorkbenchProjectId()}
          onClick={() => { void cleanupSources() }}
        >
          <IconTrash size={14} stroke={1.8} aria-hidden="true" />
          {t('settings.automation.videoAnalysis.cleanup')}
        </button>
        {cleanupMessage ? <div className="mt-1.5 text-caption text-nomi-ink-60" aria-live="polite">{cleanupMessage}</div> : null}
      </div>

      {settings.externalInference ? (
        <div className="mt-3 flex items-start gap-2 border-l-2 border-nomi-warning pl-2.5 text-caption leading-relaxed text-nomi-ink-60">
          <IconAlertCircle className="mt-0.5 shrink-0 text-nomi-warning" size={14} stroke={1.8} aria-hidden="true" />
          {t('settings.automation.videoAnalysis.externalWarning')}
        </div>
      ) : null}
      {error ? <div className="mt-2 break-words text-caption text-nomi-danger">{error}</div> : null}
    </section>
  )
}
