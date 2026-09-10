/**
 * 外部 Agent 正在接模型时，模型页顶部那张卡的下半——五步进度与失败态。
 *
 * 只读投影：stage 来自主进程的接入会话（`integrationSessionGet`），这里一格状态都不自己存。
 * 设计定稿 docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Progress。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCircleCheck, IconCircleDashed, IconLoader2 } from '@tabler/icons-react'

import { cn } from '../../utils/cn'
import type { AssistedProgressRowState, AssistedProgressStep, AssistedProgressView } from './assistedProgressProjection'

export type AssistedIntegrationProgressProps = {
  view: AssistedProgressView
  /** 会话里那家供应商的名字（`config.name`）。 */
  name: string
  /** 驱动这次接入的宿主显示名；未签名的外部客户端拿不到名字，给 null。 */
  hostLabel: string | null
  /** 主进程给的原始阻塞原因码（`blockingReason.code`），失败时原样显示。 */
  reasonCode?: string | null
}

function StepIcon({ state }: { state: AssistedProgressRowState }): JSX.Element {
  if (state === 'done') {
    return <IconCircleCheck size={16} stroke={1.7} className="mt-0.5 shrink-0 text-workbench-success-ink" aria-hidden="true" />
  }
  if (state === 'active') {
    return <IconLoader2 size={16} stroke={1.7} className="mt-0.5 shrink-0 animate-spin text-nomi-accent" aria-hidden="true" />
  }
  return <IconCircleDashed size={16} stroke={1.7} className="mt-0.5 shrink-0 text-nomi-ink-30" aria-hidden="true" />
}

export function AssistedIntegrationProgress({
  view,
  name,
  hostLabel,
  reasonCode,
}: AssistedIntegrationProgressProps): JSX.Element {
  const { t } = useTranslation()
  const stepTitle = (step: AssistedProgressStep): string => t(`onboardingProviders.assistedOnboarding.progress.steps.${step}.title`)
  const bad = view.outcome === 'failed' || view.outcome === 'cancelled'
  // 两个终态各写全键：动态拼接会让死键门岗对整棵 progress 子树失明，为两个字面量不值当。
  const badTitle = view.outcome === 'cancelled'
    ? t('onboardingProviders.assistedOnboarding.progress.cancelledTitle')
    : t('onboardingProviders.assistedOnboarding.progress.failedTitle')

  return (
    <div data-assisted-onboarding-progress={view.outcome} className="flex flex-col gap-2.5">
      <div className="min-w-0">
        {/* 状态胶囊紧跟标题，不推到右缘（2026-09-09 用户拍板的通用行规则）。 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-body-sm font-semibold text-nomi-ink">
            {hostLabel
              ? t('onboardingProviders.assistedOnboarding.progress.title', { host: hostLabel, name })
              : t('onboardingProviders.assistedOnboarding.progress.titleUnknownHost', { name })}
          </span>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold',
          view.outcome === 'completed'
            ? 'bg-[var(--workbench-success-soft)] text-workbench-success-ink'
            : bad
              ? 'bg-[var(--workbench-danger-soft)] text-workbench-danger'
              : 'bg-nomi-accent-soft text-nomi-accent',
        )}>
          {view.outcome === 'completed'
            ? t('onboardingProviders.assistedOnboarding.progress.done')
            : bad
              ? badTitle
              : t('onboardingProviders.assistedOnboarding.progress.running')}
        </span>
        </div>
        <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-40">
          {t('onboardingProviders.assistedOnboarding.progress.hint')}
        </div>
      </div>

      {/* 失败/取消不复用「进行中」的壳：标题直说结果，原因给原始错误码 + 一句人话，
          Key 不丢（重试在助手那边发生，卡上不放一颗按不动的「重试」）。 */}
      {bad ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-3 py-2.5">
          <IconAlertTriangle size={16} stroke={1.7} className="mt-0.5 shrink-0 text-workbench-danger" aria-hidden="true" />
          <div className="min-w-0 text-caption leading-relaxed text-nomi-ink-80">
            <div className="font-semibold text-nomi-ink">{badTitle}</div>
            <div className="mt-0.5">
              {t('onboardingProviders.assistedOnboarding.progress.stoppedAt', { step: stepTitle(view.currentStep) })}
              {reasonCode ? ` ${t('onboardingProviders.assistedOnboarding.progress.reason', { code: reasonCode })}` : ''}
            </div>
            <div className="mt-0.5 text-nomi-ink-60">
              {t('onboardingProviders.assistedOnboarding.progress.retryHint')}
            </div>
          </div>
        </div>
      ) : null}

      <ol className="flex flex-col gap-1.5">
        {view.rows.map((row) => (
          <li key={row.step} data-assisted-progress-step={row.step} data-assisted-progress-state={row.state} className="flex items-start gap-2">
            <StepIcon state={row.state} />
            <span className="min-w-0 flex-1">
              <span className={cn(
                'block text-caption font-semibold',
                row.state === 'pending' ? 'text-nomi-ink-40' : 'text-nomi-ink',
              )}>
                {stepTitle(row.step)}
              </span>
              <span className="mt-0.5 block text-micro leading-relaxed text-nomi-ink-40">
                {t(`onboardingProviders.assistedOnboarding.progress.steps.${row.step}.body`)}
                {' · '}
                {/* 灰字是**真实 stage 名**（integrationContract.ts 的词表），排错时对得上日志。 */}
                <code className="font-mono">{row.stages.join(' → ')}</code>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
