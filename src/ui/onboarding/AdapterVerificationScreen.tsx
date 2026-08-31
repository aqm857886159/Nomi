import React from 'react'
import { MODEL_ACCESS_ENTRY } from '../../../electron/shared/modelAccessCapabilities'
import { Group, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconLoader2, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { DesktopAdapterModeResult, DesktopProviderAdapterRun } from '../../desktop/bridge'
import { DesignButton } from '../../design'
import { cn } from '../../utils/cn'
import { adapterRunProgress, isAdapterRunTerminal } from './adapterVerificationViewModel'
import { adapterFailureAdvice } from './adapterFailureAdvice'

const MODE_LABEL_KEYS: Record<string, string> = {
  chat: 'chat',
  prompt_refine: 'prompt_refine',
  text_to_image: 'text_to_image',
  image_edit: 'image_edit',
  text_to_video: 'text_to_video',
  image_to_video: 'image_to_video',
  text_to_audio: 'text_to_audio',
  image_to_audio: 'image_to_audio',
  transcribe: 'transcribe',
  text_to_3d: 'text_to_3d',
  image_to_3d: 'image_to_3d',
}
function modeTone(mode: DesktopAdapterModeResult): string {
  if (mode.state === 'verified') return 'bg-workbench-success-soft text-workbench-success'
  if (mode.state === 'failed') return 'bg-[var(--workbench-danger-soft)] text-workbench-danger'
  return 'bg-nomi-ink-05 text-nomi-ink-60'
}

function modelState(model: DesktopProviderAdapterRun['models'][number]): 'working' | 'verified' | 'partial' | 'failed' {
  if (model.modes.some(mode => mode.state === 'testing' || mode.state === 'repairing' || mode.state === 'queued')) return 'working'
  const passed = model.modes.filter(mode => mode.state === 'verified').length
  if (passed === model.modes.length && passed > 0) return 'verified'
  if (passed > 0) return 'partial'
  return model.modes.length > 0 ? 'failed' : 'working'
}

/** 一个模型里最值得解释的那条失败（多模式失败时只讲第一条，别把三段红字堆给用户）。 */
function primaryFailure(model: DesktopProviderAdapterRun['models'][number]): DesktopAdapterModeResult | null {
  return model.modes.find((mode) => mode.state === 'failed') ?? null
}

export function AdapterVerificationScreen({
  run,
  onClose,
  onBack,
  onSelfConnect,
  onRetry,
}: {
  run: DesktopProviderAdapterRun
  onClose: () => void
  onBack: () => void
  /** 打开该模型的自定义调用编辑器（终极逃生口）。 */
  onSelfConnect?: (modelKey: string, label: string) => void
  /** 重新跑一次验证。缺省时不渲染重验按钮（宿主没接就别给死按钮，设计系统 C1）。 */
  onRetry?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const progress = adapterRunProgress(run)
  const terminal = isAdapterRunTerminal(run.stage)
  const progressWidth = progress.total > 0 ? `${Math.round((progress.completed / progress.total) * 100)}%` : '0%'
  const success = run.stage === 'completed' || run.stage === 'partial'
  const failedCount = run.models.filter((model) => modelState(model) === 'failed' || modelState(model) === 'partial').length

  return (
    <Stack gap={12} data-model-access-entry={MODEL_ACCESS_ENTRY.providerAdapter}>
      <Group gap={10} wrap="nowrap" align="center">
        <span
          className={cn(
            'size-9 rounded-full grid place-items-center shrink-0',
            success
              ? 'bg-workbench-success-soft text-workbench-success'
              : terminal
                ? 'bg-[var(--workbench-danger-soft)] text-workbench-danger'
                : 'bg-nomi-accent-soft text-nomi-accent',
          )}
        >
          {success ? <IconCheck size={19} stroke={2} /> : terminal ? <IconAlertTriangle size={18} stroke={1.8} /> : <IconLoader2 size={18} stroke={1.8} className="animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          {/*
            结果页把立场翻过来（2026-08-12）：模型**已经加进来了**，自检只是我们的自查。
            旧文案首行是「模型接入结果 / N 个已有可用能力」，失败时用户读到的是「你的东西错了」——
            而多数情况是我们没猜对这家的接法。放行改动之后这也是事实：没通过照样能用。
          */}
          <Text size="md" fw={600} c="var(--nomi-ink)">
            {terminal
              ? t('onboardingProviders.adapterVerification.addedTitle', { count: run.models.length })
              : t('onboardingProviders.adapterVerification.title.running')}
          </Text>
          <Text size="xs" c="var(--nomi-ink-60)">
            {terminal
              ? failedCount > 0
                ? t('onboardingProviders.adapterVerification.addedSomeFailed', { failed: failedCount })
                : t('onboardingProviders.adapterVerification.addedAllPassed')
              : t(`onboardingProviders.adapterVerification.stage.${run.stage}`, { model: run.currentModelKey || '' })}
          </Text>
        </div>
      </Group>

      {terminal && failedCount > 0 ? (
        <div className="rounded-nomi bg-nomi-accent-soft px-3 py-2 text-caption leading-relaxed text-nomi-ink-80">
          {t('onboardingProviders.adapterVerification.selfCheckMeaning')}
        </div>
      ) : null}

      <div>
        <Group justify="space-between" align="center" mb={5}>
          <Text size="xs" c="var(--nomi-ink-60)">
            {t('onboardingProviders.adapterVerification.progress', { completed: progress.completed, total: progress.total })}
          </Text>
          {!terminal && run.repairAttempt > 0 ? (
            <Group gap={4} wrap="nowrap">
              <IconRefresh size={12} stroke={1.8} className="text-nomi-accent" />
              <Text size="xs" c="var(--nomi-accent)">
                {t('onboardingProviders.adapterVerification.repairing', { attempt: run.repairAttempt })}
              </Text>
            </Group>
          ) : null}
        </Group>
        <div className="h-1.5 rounded-full bg-nomi-ink-10 overflow-hidden">
          <div className="h-full rounded-full bg-nomi-accent transition-[width] duration-300" style={{ width: progressWidth }} />
        </div>
      </div>

      <Stack gap={6} mah={300} style={{ overflowY: 'auto' }}>
        {run.models.map(model => {
          const state = modelState(model)
          const passed = model.modes.filter(mode => mode.state === 'verified').length
          return (
            <div key={model.modelKey} className="rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-2.5">
              <Group justify="space-between" wrap="nowrap" align="center" gap={8}>
                <div className="min-w-0 flex-1">
                  <Text size="sm" fw={600} c="var(--nomi-ink)" truncate>{model.labelZh}</Text>
                  <Text size="xs" c="var(--nomi-ink-40)" truncate>{model.modelKey}</Text>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-micro font-semibold shrink-0',
                    state === 'verified'
                      ? 'bg-workbench-success-soft text-workbench-success'
                      : state === 'failed'
                        // 琥珀不用血红：放行之后「没通过」不等于「不能用」，红色会骗人（2026-08-12）。
                        ? 'bg-[color-mix(in_srgb,var(--nomi-warning)_14%,var(--nomi-paper))] text-[color:var(--nomi-warning)]'
                        : state === 'partial'
                          ? 'bg-nomi-accent-soft text-nomi-accent'
                          : 'bg-nomi-ink-05 text-nomi-ink-60',
                  )}
                >
                  {state === 'working' ? <IconLoader2 size={11} className="animate-spin" /> : null}
                  {state === 'failed'
                    ? t('onboardingProviders.adapterVerification.failedBadge')
                    : t(`onboardingProviders.adapterVerification.modelState.${state}`, { passed, total: model.modes.length })}
                </span>
              </Group>
              {model.modes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {model.modes.map(mode => (
                    <span key={mode.taskKind} title={mode.error} className={cn('px-2 py-1 rounded-full text-micro', modeTone(mode))}>
                      {t(`onboardingProviders.adapterVerification.mode.${MODE_LABEL_KEYS[mode.taskKind] || mode.taskKind}`)}
                    </span>
                  ))}
                </div>
              ) : null}
              {/*
                失败时讲清「发生了什么 + 该怎么办」。原因由归类映射而来（adapterFailureAdvice），
                归类是抛出点查表定好的，不在这里猜措辞。原始报错折叠起来备查——它对普通用户是噪音，
                对来求助的人是唯一线索，两边都不能丢。
              */}
              {terminal && state === 'failed' ? (() => {
                const failure = primaryFailure(model)
                if (!failure) return null
                const advice = adapterFailureAdvice({
                  errorCategory: failure.errorCategory,
                  httpStatus: failure.httpStatus,
                  stage: failure.stage,
                })
                const status = failure.httpStatus
                  ? String(failure.httpStatus)
                  : t('onboardingProviders.adapterVerification.whyStatusUnknown')
                return (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <Text size="xs" c="var(--nomi-ink-80)" className="leading-relaxed">
                      {t(`onboardingProviders.adapterVerification.why.${advice.reasonKey}` as 'onboardingProviders.adapterVerification.why.unknown', { status })}
                    </Text>
                    <Group gap={8} wrap="wrap">
                      {advice.action === 'retry' && onRetry ? (
                        <DesignButton size="xs" variant="light" onClick={onRetry}>
                          {t('onboardingProviders.adapterVerification.retryOne')}
                        </DesignButton>
                      ) : null}
                      {advice.action === 'fixUrl' || advice.action === 'fixKey' ? (
                        <DesignButton size="xs" variant="light" onClick={onBack}>
                          {t(`onboardingProviders.adapterVerification.action.${advice.action}`)}
                        </DesignButton>
                      ) : null}
                      {onSelfConnect ? (
                        <DesignButton
                          size="xs"
                          variant={advice.action === 'selfConnect' ? 'light' : 'subtle'}
                          onClick={() => onSelfConnect(model.modelKey, model.labelZh)}
                        >
                          {t('onboardingProviders.adapterVerification.action.selfConnect')}
                        </DesignButton>
                      ) : null}
                    </Group>
                    {failure.error ? (
                      <details className="text-micro text-nomi-ink-40">
                        <summary className="cursor-pointer select-none">
                          {t('onboardingProviders.adapterVerification.rawErrorToggle')}
                        </summary>
                        <div className="mt-1 select-text break-words rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-60">
                          {failure.error}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )
              })() : null}
            </div>
          )
        })}
      </Stack>

      {run.error ? (
        <Text size="xs" c="var(--workbench-danger)" className="rounded-nomi bg-[var(--workbench-danger-soft)] px-3 py-2">
          {run.error}
        </Text>
      ) : !terminal ? (
        <Text size="xs" c="var(--nomi-ink-40)">
          {t('onboardingProviders.adapterVerification.backgroundHint')}
        </Text>
      ) : run.stage === 'partial' ? (
        <Text size="xs" c="var(--nomi-ink-60)">
          {t('onboardingProviders.adapterVerification.partialHint')}
        </Text>
      ) : null}

      <Group justify="flex-end" gap={8}>
        {terminal && !success ? <DesignButton variant="subtle" onClick={onBack}>{t('modelSetup.retryEdit')}</DesignButton> : null}
        {terminal && failedCount > 0 && onRetry ? (
          <DesignButton variant="subtle" onClick={onRetry}>
            {t('onboardingProviders.adapterVerification.retryAll')}
          </DesignButton>
        ) : null}
        <DesignButton variant={terminal ? 'filled' : 'subtle'} onClick={onClose}>
          {terminal ? t('modelSetup.done') : t('onboardingProviders.adapterVerification.runInBackground')}
        </DesignButton>
      </Group>
    </Stack>
  )
}
