// 顶栏上的「新版本」胶囊：发现更新的唯一常驻入口（画布里不出任何提示）。
// 外壳线把它摆进顶栏 / 项目库窗口栏：`<UpdatePill host="appbar" />` 或 `host="library"`，不用传别的。
// 窄屏（< 900px）自动收成带点的图标，点开是同一个弹窗。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { shortVersion } from '../../../electron/shared/updateReminder'
import { useUpdater } from './useUpdater'

export type UpdatePillPhase = 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * 宿主顶栏两种：项目库窗口栏（h-7 胶囊、text-caption）与项目顶栏右簇（nomi-appbar__ghost：h-30 方角、
 * text-body-sm）。胶囊照抄宿主那一族的骨架，不在两个顶栏里长成两种陌生控件。
 */
export type UpdatePillHost = 'library' | 'appbar'

const HOST_CLASS: Record<UpdatePillHost, string> = {
  library: cn(
    'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
    'text-caption font-medium transition-colors',
  ),
  appbar: cn(
    'inline-flex items-center gap-1.5 h-[30px] px-2.5',
    'border border-transparent rounded-[var(--nomi-radius-sm)]',
    'bg-transparent font-inherit text-body-sm font-medium cursor-pointer',
    'transition-[background,color] duration-nomi-fast ease-nomi-fast',
    'hover:bg-[var(--nomi-ink-05)]',
  ),
}

export function UpdatePillView({ phase, version, percent = 0, failedStage = 'download', host, compact = false, onClick }: {
  phase: UpdatePillPhase
  version: string
  percent?: number
  failedStage?: 'download' | 'install'
  host: UpdatePillHost
  /** 强制收成图标态（外壳按自己的断点传）；不传时 < 900px 视口自动收。 */
  compact?: boolean
  onClick?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const iconSize = host === 'library' ? 14 : 15
  const label = phase === 'downloading'
    ? t('updateReminder.badge.downloading', { percent })
    : phase === 'downloaded'
      ? t('updateReminder.badge.ready')
      : phase === 'error'
        ? t(failedStage === 'install' ? 'updateReminder.badge.installFailed' : 'updateReminder.badge.failed')
        : t('updateReminder.badge.available', { version: shortVersion(version) })
  const Icon = phase === 'error' ? IconAlertTriangle : phase === 'downloaded' ? IconRefresh : IconDownload
  return (
    <button
      type="button"
      data-update-badge={phase}
      aria-label={label}
      title={label}
      className={cn(HOST_CLASS[host], phase === 'error' ? 'text-nomi-danger' : 'text-nomi-accent', 'relative hover:text-nomi-ink')}
      onClick={onClick}
    >
      <Icon size={iconSize} stroke={1.8} aria-hidden="true" />
      <span className={cn('tabular-nums', compact ? 'hidden' : 'max-[899px]:hidden')}>{label}</span>
      {/* 窄屏标签收起后，靠这个点告诉人「有新东西」。 */}
      <span className={cn('absolute right-0.5 top-0.5 size-1.5 rounded-full', compact ? 'block' : 'hidden max-[899px]:block', phase === 'error' ? 'bg-nomi-danger' : 'bg-nomi-accent')} aria-hidden="true" />
    </button>
  )
}

/** 有可展示的更新状态时才渲染；预览版 / 开发版 / 没桥的网页预览不出。 */
export function UpdatePill({ host }: { host: UpdatePillHost }): JSX.Element | null {
  const updater = useUpdater()
  const { phase } = updater
  if (!updater.supported || !updater.canCheckUpdates || !updater.latestVersion) return null
  // 手动检查失败（stage=check）不占顶栏：错误只在设置→关于里说。
  const failed = phase === 'error' && (updater.errorStage === 'download' || updater.errorStage === 'install')
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'downloaded' && !failed) return null
  return (
    <UpdatePillView
      phase={phase as UpdatePillPhase}
      version={updater.latestVersion}
      percent={updater.percent}
      failedStage={updater.errorStage === 'install' ? 'install' : 'download'}
      host={host}
      onClick={updater.openDialog}
    />
  )
}
