// 更新后第一次打开出一次的「已更新到 x」卡：标题句 + 最多 3 条 + 完整说明 + ✕，只出一次。
// 跳了几版就合成一张（「从 0.22.5 更新到 0.24.0」）。外壳线把它摆进项目库通知位：`<UpdatedCard />`。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCircleCheck, IconX } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { buildReleaseNotesUrl, deriveUpdatedCard } from '../../../electron/shared/updateReminder'
import { LIBRARY_STRIP_SURFACE } from './HotfixBanner'
import { FullNotesLink } from './UpdateDialog'
import { useUpdateLocale } from './useUpdateLocale'
import { useUpdater } from './useUpdater'
import { dismissUpdatedCard, useUpdateStore } from './updateStore'

export function UpdatedCardView({ fromVersion, toVersion, headline, items, releaseUrl, onDismiss }: {
  /** 跳了几版才给：标题写「从 A 更新到 B」。 */
  fromVersion?: string | null
  toVersion: string
  headline: string | null
  items: readonly string[]
  releaseUrl: string
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const title = fromVersion
    ? t('updateReminder.updated.titleRange', { from: fromVersion, to: toVersion })
    : t('updateReminder.updated.title', { version: toVersion })
  return (
    <section className={cn('shrink-0 flex items-start gap-3 px-4 py-3', LIBRARY_STRIP_SURFACE)} data-update-updated-card={toVersion}>
      <IconCircleCheck size={18} stroke={1.8} className="mt-0.5 shrink-0 text-nomi-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body-sm font-semibold text-nomi-ink">{title}</span>
          {headline ? <span className="text-body-sm text-nomi-ink-60">{headline}</span> : null}
        </div>
        {items.length ? (
          <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
            {items.map((item) => (
              <li key={item} className="flex items-center gap-2 text-caption text-nomi-ink-80">
                <span className="size-1 shrink-0 rounded-full bg-nomi-ink-40" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5"><FullNotesLink href={releaseUrl} /></div>
      </div>
      <WorkbenchIconButton size="sm" label={t('common.close')} icon={<IconX size={14} stroke={1.8} />} onClick={onDismiss} className="shrink-0 border-0 bg-transparent" />
    </section>
  )
}

export function UpdatedCard(): JSX.Element | null {
  useUpdater() // 保持对主进程的订阅
  const card = useUpdateStore((state) => state.memory.updatedCard)
  const locale = useUpdateLocale()
  const view = deriveUpdatedCard(card, locale)
  if (!view) return null
  return (
    <UpdatedCardView
      fromVersion={view.fromVersion}
      toVersion={view.toVersion}
      headline={view.headline}
      items={view.items}
      releaseUrl={buildReleaseNotesUrl(view.toVersion)}
      onDismiss={dismissUpdatedCard}
    />
  )
}
