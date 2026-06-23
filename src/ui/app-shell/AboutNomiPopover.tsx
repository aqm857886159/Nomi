import React from 'react'
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import { BodyPortal, DesignProgress, NomiLoadingMark, NomiLogoMark, NomiWordmark, WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
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
  const updater = useUpdater()
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
        aria-label="关于 Nomi"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 品牌头：真实 Nomi logo（圆角方块 mark）+ 文字标志 No·m·i + 版本号 */}
        <div className="flex items-center gap-3 mb-3.5">
          <NomiLogoMark size={40} />
          <div className="min-w-0">
            <NomiWordmark fontSize={17} className="text-nomi-ink" />
            <p className="mt-0.5 text-micro text-[var(--nomi-ink-60)]">
              当前版本 {updater.appInfo?.version ?? '…'}
              {updater.appInfo ? ` · ${platformLabel(updater.appInfo)}` : ''}
            </p>
          </div>
        </div>

        <div className="pt-3.5 border-t border-[var(--nomi-line-soft)]">
          {!updater.supported ? (
            <p className="text-body-sm text-[var(--nomi-ink-60)]">桌面版支持检查更新与一键升级。</p>
          ) : (
            <UpdateBody updater={updater} />
          )}
        </div>
      </div>
    </BodyPortal>
  )
}

function UpdateBody({ updater }: { updater: ReturnType<typeof useUpdater> }): JSX.Element {
  const { phase } = updater

  if (phase === 'checking') {
    return (
      <div className="flex items-center gap-2 min-h-8 text-body-sm text-[var(--nomi-ink-80)]">
        <NomiLoadingMark size={16} label="检查中" />
        检查中…
      </div>
    )
  }

  if (phase === 'up-to-date') {
    return (
      <div className="flex items-center gap-1.5 min-h-8 text-body-sm text-[var(--nomi-ink)]">
        <IconCircleCheck size={16} className="text-[var(--workbench-success)]" />
        已是最新版本
      </div>
    )
  }

  if (phase === 'available') {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 min-h-8">
          <span className="text-body-sm text-[var(--nomi-ink)]">
            发现新版 <b className="font-medium">{updater.latestVersion}</b>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <WorkbenchButton variant="default" onClick={updater.reset}>稍后</WorkbenchButton>
            {updater.canAutoInstall ? (
              <WorkbenchButton variant="primary" onClick={updater.download}>下载更新</WorkbenchButton>
            ) : (
              <WorkbenchButton variant="primary" onClick={updater.openRelease}>前往下载</WorkbenchButton>
            )}
          </div>
        </div>
        {!updater.canAutoInstall ? (
          <p className="mt-2 text-micro text-[var(--nomi-ink-40)]">
            macOS 需手动下载安装包替换旧版（应用未签名，暂不支持就地自动更新）
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
        <p className="text-body-sm text-[var(--nomi-ink)] mb-2">正在下载更新…</p>
        <DesignProgress value={updater.percent} size="sm" />
        <p className="mt-1.5 text-micro text-[var(--nomi-ink-40)]">后台下载，可继续创作 · {updater.percent}%</p>
      </div>
    )
  }

  if (phase === 'downloaded') {
    return (
      <div className="flex items-center justify-between gap-3 min-h-8">
        <span className="flex items-center gap-1.5 text-body-sm text-[var(--nomi-ink)]">
          <IconCircleCheck size={16} className="text-[var(--workbench-success)]" />
          下载完成
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <WorkbenchButton variant="default" onClick={updater.reset}>稍后</WorkbenchButton>
          <WorkbenchButton variant="primary" onClick={updater.install}>重启并安装</WorkbenchButton>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div>
        <div className="flex items-start gap-1.5 text-body-sm text-[var(--workbench-danger)]">
          <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{updater.errorMessage || '更新出错'}</span>
        </div>
        <div className="mt-2.5 flex justify-end">
          <WorkbenchButton variant="default" onClick={updater.check}>重试</WorkbenchButton>
        </div>
      </div>
    )
  }

  // idle
  return (
    <div className="flex items-center justify-between gap-3 min-h-8">
      <span className="text-body-sm text-[var(--nomi-ink-60)]">检查是否有新版本可用</span>
      <WorkbenchButton variant="primary" onClick={updater.check}>检查更新</WorkbenchButton>
    </div>
  )
}
