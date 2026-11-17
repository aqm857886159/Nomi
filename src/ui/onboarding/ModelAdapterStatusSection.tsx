import React, { type JSX } from 'react'
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
import type { ModelStatusState, ModelStatusTone } from '../../../electron/shared/modelStatusPresentation'
import type { ChipModel } from './ModelChipGroups'
import { ModelStatusMark } from './ModelStatusMark'
import { resolveModelAdapterDetailState, type ModelAdapterDetailState } from './modelAdapterDetailState'

const TONE_CLASS: Record<ModelStatusTone, string> = {
  neutral: 'border-nomi-line bg-nomi-ink-05',
  active: 'border-transparent bg-nomi-accent-soft',
  success: 'border-workbench-success bg-workbench-success-soft',
  warning: 'border-nomi-warning bg-[color-mix(in_oklch,var(--nomi-warning)_9%,var(--nomi-paper))]',
}

/** 正文按「接下来做什么」说；没事可做时按五个状态词之一说现状。键写全，不拼字符串。 */
const STEP_BODY_KEY = {
  adapting: 'onboardingProviders.workspace.adapter.body.adapting',
  needsCapability: 'onboardingProviders.workspace.adapter.body.needsCapability',
  needsTransport: 'onboardingProviders.workspace.adapter.body.needsTransport',
} as const
const STATUS_BODY_KEY = {
  ready: 'onboardingProviders.workspace.adapter.body.ready',
  // 格式任务在跑时状态区走 adapting 那一档；这一格只为穷尽。
  configuring: 'onboardingProviders.workspace.adapter.body.adapting',
  needsSetup: 'onboardingProviders.workspace.adapter.body.needsSetup',
  disabled: 'onboardingProviders.workspace.adapter.body.disabled',
  notConnected: 'onboardingProviders.workspace.adapter.body.notConnected',
} as const satisfies Record<ModelStatusState, string>

function StatusIcon({ state }: { state: ModelAdapterDetailState }): JSX.Element {
  if (state.state === 'adapting') return <NomiLoadingMark size={16} />
  if (state.state === 'needsCapability' || state.state === 'needsTransport') {
    return <IconSettings size={16} stroke={1.8} aria-hidden="true" />
  }
  if (state.status.state === 'ready') return <IconCheck size={16} stroke={2} aria-hidden="true" />
  return <IconInfoCircle size={16} stroke={1.8} aria-hidden="true" />
}

export function ModelAdapterStatusSection({
  model,
  canAutoAdapt,
  canUseScript,
  hasActiveRun,
  hasTask,
  capabilityKnown,
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
  starting: boolean
  onStartAdapt: () => void
  onOpenTask: () => void
  onOpenScript: () => void
  onEditCapability: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const state = resolveModelAdapterDetailState({
    availability: model.availability,
    formatInProgress: hasActiveRun || model.formatInProgress === true,
    capabilityKnown,
    hasTask,
    canAutoAdapt,
    canUseScript,
  })
  const bodyKey = state.state === 'status' ? STATUS_BODY_KEY[state.status.state] : STEP_BODY_KEY[state.state]

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
              <ModelStatusMark status={state.status} variant="text" />
            </h3>
            <p className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">
              {t(bodyKey)}
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
