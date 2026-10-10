// 顶栏上的「新版本」胶囊：发现更新的唯一常驻入口（画布里不出任何提示）。
// 外壳顶栏右簇里摆一份：`<UpdatePill host="appbar" />`。
// 窄屏（< 900px）自动收成带点的图标，点开是同一个弹窗。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { shortVersion, type UpdaterErrorStage } from '../../../electron/shared/updateReminder'
import { useUpdater } from './useUpdater'

export type UpdatePillPhase = 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * 宿主只有外壳那一条 40px 合一顶栏（项目库与项目内共用，旧的项目库窗口栏 / NomiAppBar 已随外壳重设计删除）。
 * 胶囊照抄顶栏右簇那一族的骨架，不长成陌生控件。
 */
export type UpdatePillHost = 'appbar'

const HOST_CLASS: Record<UpdatePillHost, string> = {
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
  failedStage?: Exclude<UpdaterErrorStage, 'check'>
  host: UpdatePillHost
  /** 强制收成图标态（外壳按自己的断点传）；不传时 < 900px 视口自动收。 */
  compact?: boolean
  onClick?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const iconSize = 15
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
