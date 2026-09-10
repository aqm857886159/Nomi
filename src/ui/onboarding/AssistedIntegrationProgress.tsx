/**
 * 外部 Agent 正在接模型时，模型页顶部那张卡的下半——五步进度与失败态。
 *
 * 只读投影：stage 来自主进程的接入会话（`integrationSessionGet`），这里一格状态都不自己存。
 * 设计定稿 docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Progress。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCircleDashed, IconLoader2 } from '@tabler/icons-react'

import { cn } from '../../utils/cn'
import type {
  AssistedProgressOutcome,
  AssistedProgressRowState,
  AssistedProgressStep,
  AssistedProgressView,
} from './assistedProgressProjection'

export type AssistedIntegrationProgressProps = {
  view: AssistedProgressView
  /** 会话里那家供应商的名字（`config.name`）。 */
  name: string
  /** 驱动这次接入的宿主显示名；未签名的外部客户端拿不到名字，给 null。 */
  hostLabel: string | null
  /** 主进程给的原始阻塞原因码（`blockingReason.code`），失败时原样显示。 */
  reasonCode?: string | null
}

/**
 * `halted` = 这次接入已经停了（失败/取消）。停了还画一颗转圈的圈 = 界面在说「还在跑」，
 * 而它已经不跑了——这一格是 2026-09-11 看基线截图时抓到的（断言看不见转不转）。
 *
 * 图标只能从 `src/vendor/tablerIcons.ts` 那份**白名单**里挑：`@tabler/icons-react` 在
 * vite.config.ts:231 被 alias 到它，而 tsc 解析的是 node_modules 里的真包——所以引一个
 * 没登记的图标**类型检查照样绿**，运行时才 undefined、整页白屏（2026-09-11 实测：
 * IconCircleX 让设计实验室整趟 warmup-unreachable）。加新图标先往那份白名单里登记。
 */
function StepIcon({ state, outcome }: { state: AssistedProgressRowState; outcome: AssistedProgressOutcome }): JSX.Element {
  const halted = outcome === 'failed' || outcome === 'cancelled'
  if (state === 'done') {
    return <IconCircleCheck size={16} stroke={1.7} className="mt-0.5 shrink-0 text-workbench-success-ink" aria-hidden="true" />
  }
  if (state === 'active') {
    if (halted) {
      return (
        <IconAlertCircle
          size={16}
          stroke={1.7}
          className={cn('mt-0.5 shrink-0', outcome === 'failed' ? 'text-workbench-danger' : 'text-nomi-ink-40')}
          aria-hidden="true"
        />
      )
    }
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
          {/* 停了就别再说「正在接入」——标题和它右边那颗胶囊会互相打脸。 */}
          <span className="min-w-0 text-body-sm font-semibold text-nomi-ink">
            {view.outcome === 'running'
              ? (hostLabel
                ? t('onboardingProviders.assistedOnboarding.progress.title', { host: hostLabel, name })
                : t('onboardingProviders.assistedOnboarding.progress.titleUnknownHost', { name }))
              : (hostLabel
                ? t('onboardingProviders.assistedOnboarding.progress.titleStopped', { host: hostLabel, name })
                : name)}
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
        {/* 「这个窗口可以关，进度会留着」只在真的还在跑的时候才成立。 */}
        {view.outcome === 'running' ? (
          <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-40">
            {t('onboardingProviders.assistedOnboarding.progress.hint')}
          </div>
        ) : null}
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
            <StepIcon state={row.state} outcome={view.outcome} />
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
