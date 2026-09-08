import React from 'react'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconInfoCircle,
  IconSettings,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { DesignButton, NomiLoadingMark } from '../../design'
import { cn } from '../../utils/cn'
import type { ChipModel } from './ModelChipGroups'
import { resolveModelAdapterDetailState } from './modelAdapterDetailState'

const TONE_CLASS = {
  neutral: 'border-nomi-line bg-nomi-ink-05',
  active: 'border-nomi-accent bg-nomi-accent-soft',
  success: 'border-workbench-success bg-workbench-success-soft',
  warning: 'border-nomi-warning bg-[color-mix(in_oklch,var(--nomi-warning)_9%,var(--nomi-paper))]',
  danger: 'border-workbench-danger bg-[var(--workbench-danger-soft)]',
} as const

function StatusIcon({ state }: { state: ReturnType<typeof resolveModelAdapterDetailState> }): JSX.Element {
  if (state.state === 'adapting') return <NomiLoadingMark size={16} />
  if (state.state === 'readyVerified') return <IconCheck size={16} stroke={2} aria-hidden="true" />
  if (state.state === 'failed') return <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
  if (state.state === 'needsCapability' || state.state === 'needsTransport') {
    return <IconSettings size={16} stroke={1.8} aria-hidden="true" />
  }
  return <IconInfoCircle size={16} stroke={1.8} aria-hidden="true" />
}

export function ModelAdapterStatusSection({
  model,
  canAutoAdapt,
  canUseScript,
  hasActiveRun,
  hasTask,
  capabilityKnown,
  transportAvailable,
  starting,
  onStartAdapt,
  onOpenTask,
  onOpenScript,
  onEditCapability,
}: {
  model: ChipModel
  canAutoAdapt: boolean
  canUseScript: boolean
  hasActiveRun: boolean
  hasTask: boolean
  capabilityKnown: boolean
  transportAvailable: boolean
  starting: boolean
  onStartAdapt: () => void
  onOpenTask: () => void
  onOpenScript: () => void
  onEditCapability: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const state = resolveModelAdapterDetailState({
    kind: model.kind,
    enabled: model.enabled,
    adapterState: model.adapterState,
    hasCustomCall: Boolean(model.hasCustomCall),
    hasActiveRun,
    hasTask,
    canAutoAdapt,
    canUseScript,
    capabilityKnown,
    transportAvailable,
  })

  const action = (() => {
    if (state.primaryAction === 'openTask') {
      return {
        label: t(state.state === 'adapting'
          ? 'onboardingProviders.workspace.adapter.action.openProgress'
          : 'onboardingProviders.workspace.adapter.action.openTask'),
        Icon: state.state === 'adapting' ? IconInfoCircle : IconAlertTriangle,
        run: onOpenTask,
      }
    }
    if (state.primaryAction === 'editCapability') {
      return { label: t('onboardingProviders.workspace.adapter.action.editCapability'), Icon: IconSettings, run: onEditCapability }
    }
    if (state.primaryAction === 'writeScript') {
      return { label: t('onboardingProviders.workspace.adapter.action.writeScript'), Icon: IconCode, run: onOpenScript }
    }
    if (state.primaryAction === 'autoConfigure') {
      return { label: t('onboardingProviders.workspace.adapter.action.autoConfigure'), Icon: IconSettings, run: onStartAdapt }
    }
    return null
  })()
  const secondaryAction = state.secondaryAction === 'autoConfigure'
    ? {
        label: t('onboardingProviders.workspace.adapter.action.start'),
        run: onStartAdapt,
      }
    : null

  return (
    <section
      data-model-adapter-state={state.state}
      className={cn('border-l-2 px-3 py-3', TONE_CLASS[state.tone])}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center text-nomi-ink-60">
            <StatusIcon state={state} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-body-sm font-semibold text-nomi-ink">
              {t(`onboardingProviders.workspace.adapter.title.${state.state}` as 'onboardingProviders.workspace.adapter.title.readyVerified')}
            </h3>
            <p className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">
              {t(`onboardingProviders.workspace.adapter.body.${state.state}` as 'onboardingProviders.workspace.adapter.body.readyVerified')}
            </p>
          </div>
        </div>
        {action || secondaryAction ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
            {secondaryAction ? (
              <DesignButton
                variant="light"
                disabled={starting}
                loading={starting}
                onClick={secondaryAction.run}
                size="md"
              >
                {secondaryAction.label}
              </DesignButton>
            ) : null}
            {action ? (
              <DesignButton
                variant="filled"
                disabled={starting}
                loading={starting}
                onClick={action.run}
                leftSection={!starting ? <action.Icon size={14} stroke={1.8} aria-hidden="true" /> : undefined}
                size="md"
              >
                {action.label}
                {!starting && (state.primaryAction === 'editCapability' || state.primaryAction === 'writeScript' || state.primaryAction === 'openTask') ? (
                  <IconChevronRight size={14} stroke={1.8} aria-hidden="true" />
                ) : null}
              </DesignButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
