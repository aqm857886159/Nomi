/**
 * 「AI 助手连接」卡顶部的迁移提示（MCP 第 3 段，画布 v5 拍板）。
 * 纯展示：问一句 / 改好了 / 部分没改成。读哪些宿主、点按钮后做什么由 ConnectAssistantCard 接，主进程在
 * electron/capabilityCore/mcpHostMigration.ts。文案里不出现协议名、口令、价格。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import type { McpMigrationFailure, McpMigrationResult } from '../../desktop/mcpBridgeTypes'
import { cn } from '../../utils/cn'
import { FAILURE_I18N } from './mcpMigrationFailureKeys'

/** 「新连接方式用不了」对所有宿主都一样，合成一行；其余失败各说各的（原因和下一步不同）。 */
function failureLines(
  failed: readonly Extract<McpMigrationResult, { ok: false }>[],
  labels: Readonly<Record<string, string>>,
  separator: string,
): { key: string; reason: McpMigrationFailure; clients: string }[] {
  const name = (client: string): string => labels[client] ?? client
  const shared = failed.filter((r) => r.reason === 'http-unavailable')
  const lines = failed.filter((r) => r.reason !== 'http-unavailable').map((r) => ({ key: r.client, reason: r.reason, clients: name(r.client) }))
  return shared.length > 0
    ? [{ key: 'http-unavailable', reason: 'http-unavailable' as const, clients: shared.map((r) => name(r.client)).join(separator) }, ...lines]
    : lines
}

export type McpMigrationPromptProps =
  | { phase: 'ask'; hosts: readonly string[]; busy: boolean; onDefer: () => void; onConfirm: () => void }
  | { phase: 'done'; labels: Readonly<Record<string, string>>; results: readonly McpMigrationResult[] }

export function McpMigrationPrompt(props: McpMigrationPromptProps): JSX.Element {
  const { t } = useTranslation()
  if (props.phase === 'ask') {
    return (
      <div data-assistant-migration="ask" className="flex flex-col gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
        <div className="text-body-sm font-semibold text-nomi-ink">
          {t('onboardingProviders.assistant.migration.ask', { clients: props.hosts.join(t('onboardingProviders.assistant.migration.separator')) })}
        </div>
        <div className="text-caption leading-relaxed text-nomi-ink-60">{t('onboardingProviders.assistant.migration.askHint')}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-assistant-migration-defer
            onClick={props.onDefer}
            disabled={props.busy}
            className="h-8 px-3 text-caption text-nomi-ink-60 hover:text-nomi-ink disabled:opacity-50"
          >
            {t('onboardingProviders.assistant.migration.defer')}
          </button>
          <button
            type="button"
            data-assistant-migration-confirm
            onClick={props.onConfirm}
            disabled={props.busy}
            className={cn(
              'h-8 px-4 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-caption font-semibold',
              'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {t('onboardingProviders.assistant.migration.confirm')}
          </button>
        </div>
      </div>
    )
  }
  const done = props.results.filter((r) => r.ok).length
  const failed = props.results.filter((r): r is Extract<McpMigrationResult, { ok: false }> => !r.ok)
  return (
    <div data-assistant-migration="done" className="flex flex-col gap-1.5 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
      {done > 0 ? (
        <div className="flex items-start gap-2 text-caption leading-relaxed text-nomi-ink-80">
          <IconCircleCheck size={15} className="mt-0.5 shrink-0 text-workbench-success-ink" aria-hidden="true" />
          <span>{t('onboardingProviders.assistant.migration.done', { count: done })}</span>
        </div>
      ) : null}
      {failureLines(failed, props.labels, t('onboardingProviders.assistant.migration.separator')).map((line) => (
        <div key={line.key} data-assistant-migration-failed={line.key} className="flex items-start gap-2 text-caption leading-relaxed text-nomi-ink-80">
          <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-nomi-warning" aria-hidden="true" />
          <span>{t(`onboardingProviders.assistant.migration.failed.${FAILURE_I18N[line.reason]}`, { client: line.clients })}</span>
        </div>
      ))}
    </div>
  )
}
