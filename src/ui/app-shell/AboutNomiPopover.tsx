import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconMap } from '@tabler/icons-react'
import { BodyPortal, DesignProgress, NomiLoadingMark, NomiLogoMark, NomiSelect, NomiWordmark, WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import { useNomiColorScheme } from '../../theme/colorScheme'
import { getAppLocale, isAppLocale, setAppLocale } from '../../i18n'
import { ThemeToggleButton } from '../theme/ThemeToggleButton'
import { useUpdater } from './useUpdater'

type AboutNomiPopoverProps = {
  anchorEl: HTMLElement | null
  onClose: () => void
}

const PANEL_WIDTH = 360
const VIEWPORT_MARGIN = 12

function platformLabel(info: { platform: string; arch: string } | null): string {
  if (!info) return ''
  const os = info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : info.platform
  return `${os} · ${info.arch}`
}

export function AboutNomiPopover({ anchorEl, onClose }: AboutNomiPopoverProps): JSX.Element {
  const { t } = useTranslation()
  const updater = useUpdater()
  const { isDark } = useNomiColorScheme()
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  React.useLayoutEffect(() => {
    if (!anchorEl) return
    const compute = (): void => {
      const rect = anchorEl.getBoundingClientRect()
      const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
      const top = rect.bottom + 8
      setPos({ top, left: Math.max(VIEWPORT_MARGIN, left) })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [anchorEl])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 z-[200]"
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'about-nomi-popover',
          'fixed z-[201] w-[360px] p-4',
          'bg-[var(--nomi-paper)] border border-[var(--nomi-line)] rounded-nomi shadow-nomi-lg',
        )}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        role="dialog"
        aria-label={t('about.dialogLabel')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 品牌头：真实 Nomi logo（圆角方块 mark）+ 文字标志 No·m·i + 版本号 */}
        <div className="flex items-center gap-3 mb-3.5">
          <NomiLogoMark size={40} />
          <div className="min-w-0">
            <NomiWordmark fontSize={17} className="text-nomi-ink" />
            <p className="mt-0.5 text-micro text-[var(--nomi-ink-60)]">
              {t('about.currentVersion', { version: updater.appInfo?.version ?? '…' })}
              {updater.appInfo ? ` · ${platformLabel(updater.appInfo)}` : ''}
            </p>
          </div>
        </div>

        {/* 上手手册入口：永久家（顶栏已删按钮，挪到这里，语义贴「关于/帮助」、不挤工具栏）。
            点 → 派 nomi-open-handbook（NomiStudioApp 监听挂面板）+ 关掉本气泡。 */}
        <button
          type="button"
          className="mb-3.5 flex w-full min-h-9 items-center gap-2.5 rounded-nomi-sm border-0 bg-[var(--nomi-ink-05)] px-3 py-2 cursor-pointer text-left transition-colors hover:bg-[var(--nomi-ink-10)]"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('nomi-open-handbook'))
            onClose()
          }}
        >
          <IconMap size={18} stroke={1.6} className="shrink-0 text-[var(--nomi-accent)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm text-[var(--nomi-ink)]">{t('about.handbook')}</span>
            <span className="block text-micro text-[var(--nomi-ink-40)]">{t('about.handbookDescription')}</span>
          </span>
          <IconChevronRight size={16} stroke={1.8} className="shrink-0 text-[var(--nomi-ink-40)]" />
        </button>

        <div className="mb-3.5 flex min-h-9 items-center justify-between gap-3 rounded-nomi-sm bg-[var(--nomi-ink-05)] px-3 py-2">
          <div className="min-w-0">
            <div className="text-body-sm text-[var(--nomi-ink)]">{t('theme.appearance')}</div>
            <div className="mt-0.5 text-micro text-[var(--nomi-ink-40)]">
              {isDark ? t('theme.dark') : t('theme.light')}
            </div>
          </div>
          <ThemeToggleButton className="shrink-0 border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)]" />
        </div>

        <div className="mb-3.5 flex min-h-9 items-center justify-between gap-3 rounded-nomi-sm bg-[var(--nomi-ink-05)] px-3 py-2">
          <div className="text-body-sm text-[var(--nomi-ink)]">{t('common.language')}</div>
          <NomiSelect
            size="xs"
            ariaLabel={t('common.language')}
            value={getAppLocale()}
            options={[
              { value: 'zh-CN', label: t('common.chinese') },
              { value: 'en', label: t('common.english') },
            ]}
            onChange={(value) => {
              if (isAppLocale(value)) setAppLocale(value)
            }}
          />
        </div>

        <div className="pt-3.5 border-t border-[var(--nomi-line-soft)]">
          {!updater.supported ? (
            <p className="text-body-sm text-[var(--nomi-ink-60)]">{t('about.desktopUpdateUnsupported')}</p>
          ) : (
            <UpdateBody updater={updater} />
          )}
        </div>
      </div>
    </BodyPortal>
  )
}

function UpdateBody({ updater }: { updater: ReturnType<typeof useUpdater> }): JSX.Element {
  const { t } = useTranslation()
  const { phase } = updater

  if (phase === 'checking') {
    return (
      <div className="flex items-center gap-2 min-h-8 text-body-sm text-[var(--nomi-ink-80)]">
        <NomiLoadingMark size={16} label={t('about.checking')} />
        {t('about.checkingEllipsis')}
      </div>
    )
  }

  if (phase === 'up-to-date') {
    return (
      <div className="flex items-center gap-1.5 min-h-8 text-body-sm text-[var(--nomi-ink)]">
        <IconCircleCheck size={16} className="text-[var(--workbench-success)]" />
        {t('about.upToDate')}
      </div>
    )
  }

  if (phase === 'available') {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 min-h-8">
          <span className="text-body-sm text-[var(--nomi-ink)]">
            {t('about.available')} <b className="font-medium">{updater.latestVersion}</b>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <WorkbenchButton variant="default" onClick={updater.reset}>{t('common.later')}</WorkbenchButton>
            {updater.canAutoInstall ? (
              <WorkbenchButton variant="primary" onClick={updater.download}>{t('about.downloadUpdate')}</WorkbenchButton>
            ) : (
              <WorkbenchButton variant="primary" onClick={updater.openRelease}>{t('about.openDownload')}</WorkbenchButton>
            )}
          </div>
        </div>
        {!updater.canAutoInstall ? (
          <p className="mt-2 text-micro text-[var(--nomi-ink-40)]">
            {t('about.macManualUpdate')}
          </p>
        ) : null}
        {updater.notes ? (
          <div className="mt-2.5 p-3 rounded-[var(--nomi-radius-sm)] bg-[var(--nomi-ink-05)] text-micro text-[var(--nomi-ink-60)] leading-relaxed whitespace-pre-line max-h-[120px] overflow-auto">
            {updater.notes}
          </div>
        ) : null}
      </div>
    )
  }

  if (phase === 'downloading') {
    return (
      <div>
        <p className="text-body-sm text-[var(--nomi-ink)] mb-2">{t('about.downloading')}</p>
        <DesignProgress value={updater.percent} size="sm" />
        <p className="mt-1.5 text-micro text-[var(--nomi-ink-40)]">
          {t('about.downloadingHint', { percent: updater.percent })}
        </p>
      </div>
    )
  }

  if (phase === 'downloaded') {
    return (
      <div className="flex items-center justify-between gap-3 min-h-8">
        <span className="flex items-center gap-1.5 text-body-sm text-[var(--nomi-ink)]">
          <IconCircleCheck size={16} className="text-[var(--workbench-success)]" />
          {t('about.downloaded')}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <WorkbenchButton variant="default" onClick={updater.reset}>{t('common.later')}</WorkbenchButton>
          <WorkbenchButton variant="primary" onClick={updater.install}>{t('about.restartInstall')}</WorkbenchButton>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div>
        <div className="flex items-start gap-1.5 text-body-sm text-[var(--workbench-danger)]">
          <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{updater.errorMessage || t('about.updateError')}</span>
        </div>
        <div className="mt-2.5 flex justify-end">
          <WorkbenchButton variant="default" onClick={updater.check}>{t('common.retry')}</WorkbenchButton>
        </div>
      </div>
    )
  }

  // idle
  return (
    <div className="flex items-center justify-between gap-3 min-h-8">
      <span className="text-body-sm text-[var(--nomi-ink-60)]">{t('about.checkAvailable')}</span>
      <WorkbenchButton variant="primary" onClick={updater.check}>{t('about.checkUpdate')}</WorkbenchButton>
    </div>
  )
}
