/**
 * 设置 · 通用 · 全局截图热键。
 *
 * 默认关（用户 2026-08-02 拍板）：全局热键会抢占用户在别的软件里的按键、macOS 还要「屏幕录制」系统权限，
 * 装完就默认占一组键 + 弹权限框太打扰。
 *
 * 这一块的诚实交付有两处，缺一不可：
 * ① **键没抢到要说**——Electron 的 globalShortcut.register 在键被别的应用占用时**只静默返回 false**，
 *    不说的话用户会一直按一直没反应；
 * ② **权限没给要指路**——macOS 的屏幕录制权限**没法程序化申请**（askForMediaAccess 只支持
 *    microphone/camera），只能带用户去系统设置，并说清「改完要重开 Nomi」。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconExternalLink } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignSwitch } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ScreenshotHotkeyStatus } from '../../desktop/bridge'

/** 可选的几组键：都刻意避开系统占死的（⌘⇧3/4/5 截图、⌘⇧Q 注销）。 */
const ACCELERATORS = ['Alt+Shift+Q', 'Alt+Shift+S', 'Alt+Shift+A', 'CommandOrControl+Alt+Q']

export function ScreenshotHotkeySection(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<ScreenshotHotkeyStatus | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    void getDesktopBridge()?.screenshot?.get?.().then((next) => setStatus(next ?? null)).catch(() => undefined)
  }, [])

  const apply = React.useCallback((enabled: boolean, accelerator: string) => {
    setBusy(true)
    void getDesktopBridge()
      ?.screenshot?.set?.({ enabled, accelerator })
      .then((next) => { if (next) setStatus(next) })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [])

  const enabled = status?.enabled ?? false
  const accelerator = status?.accelerator ?? ACCELERATORS[0] ?? 'Alt+Shift+Q'
  const needsPermission = enabled && status !== null && status.screenAccess !== 'granted'
  const keyTaken = enabled && status !== null && status.screenAccess === 'granted' && !status.registered

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-body-sm text-nomi-ink">{t('settings.general.screenshot')}</span>
        <DesignSwitch
          checked={enabled}
          disabled={busy}
          onChange={(event) => apply(event.currentTarget.checked, accelerator)}
          aria-label={t('settings.general.screenshot')}
        />
      </div>
      <div className="mb-3 text-caption leading-relaxed text-nomi-ink-40">{t('settings.general.screenshotHint')}</div>

      <div className={cn('mb-3', !enabled && 'pointer-events-none opacity-45')}>
        <div className="mb-1.5 text-caption text-nomi-ink-60">{t('settings.general.screenshotKey')}</div>
        <div className="flex flex-wrap gap-1.5">
          {ACCELERATORS.map((option) => (
            <button
              key={option}
              type="button"
              data-screenshot-accelerator={option}
              disabled={busy || !enabled}
              onClick={() => apply(enabled, option)}
              className={cn(
                'rounded-nomi-sm border px-2.5 py-1.5 font-mono text-caption cursor-pointer',
                'transition-colors duration-nomi-fast ease-nomi-fast',
                option === accelerator
                  ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                  : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
              )}
            >
              {option.replace('CommandOrControl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '')}
            </button>
          ))}
        </div>
      </div>

      {keyTaken ? (
        <div
          data-screenshot-warning="taken"
          className="mb-2 flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 text-caption leading-relaxed text-nomi-ink-80"
        >
          <IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 flex-none" aria-hidden />
          {t('settings.general.screenshotKeyTaken')}
        </div>
      ) : null}

      {needsPermission ? (
        <div
          data-screenshot-warning="permission"
          className="flex flex-col gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 text-caption leading-relaxed text-nomi-ink-80"
        >
          <div className="flex items-start gap-2">
            <IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 flex-none" aria-hidden />
            {t('settings.general.screenshotNeedsPermission')}
          </div>
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-1.5 text-caption text-nomi-ink cursor-pointer hover:bg-nomi-ink-05"
            onClick={() => void getDesktopBridge()?.screenshot?.openPermissionSettings?.().catch(() => undefined)}
          >
            <IconExternalLink size={13} stroke={1.7} aria-hidden /> {t('settings.general.screenshotOpenSettings')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
