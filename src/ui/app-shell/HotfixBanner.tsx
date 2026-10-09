// 项目库顶部的一次性热修横幅：版本号第三位变的热修，除顶栏胶囊外多这一条，写「修好了什么」那句。
// ✕ 后不再出；只修某平台的热修不在别的平台出；攒批版没有横幅；画布里从不出。
// 外壳线把它摆进项目库通知位：`<HotfixBanner />`，没有要出的内容时自己渲染 null。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { deriveHotfixBanner } from '../../../electron/shared/updateReminder'
import { dismissHotfixBanner, useUpdateStore } from './updateStore'
import { useUpdateLocale } from './useUpdateLocale'
import { useUpdater } from './useUpdater'

/** 表面 = 项目库「缺文本模型」状态条那一组 token（ProjectLibraryPage 的 data-model-banner）。 */
export const LIBRARY_STRIP_SURFACE = 'border border-nomi-line rounded-nomi bg-nomi-paper shadow-nomi-sm'

export function HotfixBannerView({ version, headline, onView, onDismiss }: {
  version: string
  headline: string
  onView?: () => void
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      className={cn('shrink-0 flex items-center gap-3 px-4 py-2.5', LIBRARY_STRIP_SURFACE)}
      aria-label={t('updateReminder.hotfix.label', { version })}
      data-update-hotfix-banner={version}
    >
      <span className="inline-flex h-5 shrink-0 items-center rounded-pill bg-nomi-accent-soft px-2 text-micro font-medium text-nomi-accent tabular-nums">
        {t('updateReminder.hotfix.label', { version })}
      </span>
      <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-nomi-ink">{headline}</span>
      <WorkbenchButton size="sm" className="shrink-0" onClick={onView}>{t('updateReminder.hotfix.view')}</WorkbenchButton>
      <WorkbenchIconButton size="sm" label={t('common.close')} icon={<IconX size={14} stroke={1.8} />} onClick={onDismiss} className="shrink-0 border-0 bg-transparent" />
    </section>
  )
}

export function HotfixBanner(): JSX.Element | null {
  const updater = useUpdater()
  const memory = useUpdateStore((state) => state.memory)
  const locale = useUpdateLocale()
  const platform = updater.appInfo?.platform
  if (!updater.supported || !updater.canCheckUpdates || !platform) return null
  const banner = deriveHotfixBanner(updater, memory, platform, locale)
  if (!banner) return null
  return <HotfixBannerView version={banner.version} headline={banner.headline} onView={updater.openDialog} onDismiss={() => dismissHotfixBanner(banner.version)} />
}
