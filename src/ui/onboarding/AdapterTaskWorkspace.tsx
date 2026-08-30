import React from 'react'
import { IconAlertTriangle, IconCheck, IconChevronRight, IconPlayerStop } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { DesktopHttpCertificationRun } from '../../desktop/onboardingBridgeTypes'
import { IconActionButton, NomiLoadingMark } from '../../design'
import { cn } from '../../utils/cn'
import { AdapterVerificationScreen } from './AdapterVerificationScreen'
import { adapterRunProgress, isAdapterRunTerminal } from './adapterVerificationViewModel'
import { ModelSettingsPageHeader } from './ModelSettingsWorkspacePages'

function taskIcon(run: DesktopHttpCertificationRun): JSX.Element {
  if (!isAdapterRunTerminal(run.stage)) return <NomiLoadingMark size={16} />
  if (run.stage === 'completed') return <IconCheck size={16} stroke={1.8} aria-hidden="true" />
  return <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
}

export function AdapterTaskList({
  runs,
  onOpen,
  onCancel,
}: {
  runs: DesktopHttpCertificationRun[]
  onOpen: (run: DesktopHttpCertificationRun) => void
  onCancel: (run: DesktopHttpCertificationRun) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (runs.length === 0) return null

  return (
    <section className="border-y border-nomi-line bg-nomi-ink-05 px-3 py-2" data-adapter-task-list>
      <div className="mb-1 px-1 text-micro font-semibold text-nomi-ink-40">
        {t('onboardingProviders.workspace.tasks')}
      </div>
      <div className="divide-y divide-nomi-line">
        {runs.map((run) => {
          const progress = adapterRunProgress(run)
          const terminal = isAdapterRunTerminal(run.stage)
          return (
            <div key={run.id} className="flex min-h-11 items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(run)}
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-nomi-sm px-1 py-1.5 text-left hover:bg-nomi-paper"
                aria-label={t('onboardingProviders.workspace.openTask', { name: run.vendorName })}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full',
                    terminal
                      ? run.stage === 'completed'
                        ? 'bg-workbench-success-soft text-workbench-success'
                        : run.stage === 'partial'
                          ? 'bg-[color-mix(in_oklch,var(--nomi-warning)_12%,var(--nomi-paper))] text-[color:var(--nomi-warning)]'
                          : 'bg-[var(--workbench-danger-soft)] text-workbench-danger'
                      : 'bg-nomi-accent-soft text-nomi-accent',
                  )}
                >
                  {taskIcon(run)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-nomi-ink">{run.vendorName}</span>
                  <span className="block truncate text-micro text-nomi-ink-60">
                    {t(`onboardingProviders.adapterVerification.stage.${run.stage}`, { model: run.currentModelKey || '' })}
                    {' / '}
                    {t('onboardingProviders.adapterVerification.progress', { completed: progress.completed, total: progress.total })}
                  </span>
                </span>
                <IconChevronRight size={16} stroke={1.6} className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent" aria-hidden="true" />
              </button>
              {!terminal ? (
                <IconActionButton
                  onClick={() => onCancel(run)}
                  className="size-11 shrink-0 text-nomi-ink-40 hover:bg-nomi-paper hover:text-workbench-danger sm:size-8"
                  aria-label={t('onboardingProviders.workspace.cancelTask', { name: run.vendorName })}
                  title={t('onboardingProviders.workspace.cancelTask', { name: run.vendorName })}
                  icon={<IconPlayerStop size={16} stroke={1.8} aria-hidden="true" />}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function AdapterTaskWorkspace({
  run,
  onBack,
  onCancel,
  onRetry,
  onSelfConnect,
  onRecoverConnection,
}: {
  run?: DesktopHttpCertificationRun
  onBack: () => void
  onCancel: () => void
  onRetry: (modelKey?: string) => void
  onSelfConnect: (modelKey: string) => void
  onRecoverConnection: (target: 'baseUrl' | 'apiKey') => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 flex-col" data-model-settings-page="verification" data-adapter-run-id={run?.id}>
      <ModelSettingsPageHeader
        title={run?.vendorName || t('onboardingProviders.workspace.taskMissingTitle')}
        subtitle={run ? t('onboardingProviders.workspace.taskSubtitle') : undefined}
        backLabel={t('common.back')}
        onBack={onBack}
      />
      <div className="mx-auto w-full max-w-[760px] flex-1 overflow-y-auto p-5">
        {run ? (
          <AdapterVerificationScreen
            run={run}
            onClose={onBack}
            onCancel={onCancel}
            onRetry={onRetry}
            onSelfConnect={(modelKey) => onSelfConnect(modelKey)}
            onRecoverConnection={onRecoverConnection}
          />
        ) : (
          <div className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2 text-caption text-nomi-ink-60">
            {t('onboardingProviders.workspace.taskMissing')}
          </div>
        )}
      </div>
    </div>
  )
}
