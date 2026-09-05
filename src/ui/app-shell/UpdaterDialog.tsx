import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconDownload, IconRefresh, IconX } from '@tabler/icons-react'
import { NomiMarkdown } from '../../workbench/common/NomiMarkdown'
import { DesignProgress, WorkbenchButton } from '../../design'
import type { Updater } from './useUpdater'
import { shouldShowUpdaterDialog } from './useUpdater'
import { cn } from '../../utils/cn'

export function UpdaterDialog({ updater, hasRunningTask }: { updater: Updater; hasRunningTask: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = React.useState(false)
  const visible = shouldShowUpdaterDialog({ phase: updater.phase, hasRunningTask }) && !dismissed
  React.useEffect(() => {
    if (updater.phase === 'available' || updater.phase === 'downloaded') setDismissed(false)
  }, [updater.phase])

  const badgeVisible = hasRunningTask && (updater.phase === 'available' || updater.phase === 'downloaded' || updater.phase === 'error')
  if (!visible && !badgeVisible) return null

  const title = updater.phase === 'error' ? t('updaterDialog.errorTitle') : updater.phase === 'downloading' ? t('updaterDialog.downloadingTitle') : updater.phase === 'downloaded' ? t('updaterDialog.downloadedTitle') : t('updaterDialog.availableTitle')

  return (
    <>
      {badgeVisible ? (
        <button
          type="button"
          data-updater-badge="true"
          className="fixed right-4 top-[calc(var(--workbench-topbar-height)+0.75rem)] z-[140] inline-flex items-center gap-1.5 rounded-pill border border-nomi-accent bg-nomi-accent-soft px-3 py-1.5 text-caption font-medium text-nomi-accent shadow-nomi-sm"
          title={t('updaterDialog.runningHint')}
          onClick={() => setDismissed(false)}
        >
          <IconDownload size={14} stroke={1.8} aria-hidden="true" />
          {t('updaterDialog.badge')}
        </button>
      ) : null}
      {visible ? (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-nomi-ink/20 p-4" role="presentation" data-updater-dialog="true">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="updater-dialog-title"
            className="w-full max-w-[30rem] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-5 shadow-nomi-lg"
          >
            <header className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-nomi-accent text-nomi-paper" aria-hidden="true">
                <IconDownload size={18} stroke={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="updater-dialog-title" className="text-title font-semibold text-nomi-ink">{title}</h2>
                {updater.latestVersion ? <p className="mt-1 text-body-sm text-nomi-ink-60">{t('updaterDialog.version', { version: updater.latestVersion })}</p> : null}
              </div>
              <button type="button" aria-label={t('common.close')} title={t('common.close')} onClick={() => setDismissed(true)} className="grid size-8 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink">
                <IconX size={16} stroke={1.8} />
              </button>
            </header>

            {updater.phase === 'available' && updater.notes ? (
              <div className="mt-4 max-h-[15rem] overflow-auto rounded-nomi-sm bg-nomi-ink-05 p-3" data-updater-notes="true">
                <NomiMarkdown compact>{updater.notes}</NomiMarkdown>
              </div>
            ) : null}
            {updater.phase === 'downloading' ? (
              <div className="mt-5">
                <DesignProgress value={updater.percent} size="sm" />
                <p className="mt-2 text-caption text-nomi-ink-60">{t('updaterDialog.progress', { percent: updater.percent })}</p>
              </div>
            ) : null}
            {updater.phase === 'error' ? (
              <div className="mt-4 flex items-start gap-2 rounded-nomi-sm bg-workbench-danger-soft p-3 text-body-sm text-workbench-danger">
                <IconAlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{updater.errorMessage || t('updaterDialog.errorBody')}</span>
              </div>
            ) : null}

            <footer className={cn('mt-5 flex items-center justify-end gap-2', updater.phase === 'downloading' && 'hidden')}>
              <WorkbenchButton variant="default" onClick={() => setDismissed(true)}>{t('common.later')}</WorkbenchButton>
              {updater.phase === 'error' ? (
                <WorkbenchButton variant="primary" onClick={updater.check}><IconRefresh size={14} />{t('common.retry')}</WorkbenchButton>
              ) : updater.phase === 'downloaded' ? (
                <WorkbenchButton variant="primary" onClick={updater.install}>{t('updaterDialog.restartInstall')}</WorkbenchButton>
              ) : updater.phase === 'available' ? (
                updater.canAutoInstall
                  ? <WorkbenchButton variant="primary" onClick={updater.download}>{t('updaterDialog.updateAndRestart')}</WorkbenchButton>
                  : <WorkbenchButton variant="primary" onClick={updater.openDownload}>{t('about.openDownload')}</WorkbenchButton>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
