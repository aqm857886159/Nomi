import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowUp, IconLoader2 } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { ICON_TIERS } from '../../../design'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'

/**
 * 生成底栏最右的「走」钮——画布节点、画布列表详情、分镜行、分镜参考卡四处同一颗。
 *
 * 只有一处不同，由宿主说：分镜行 / 参考卡今天就是带字的「生成 ↑」（一屏十几行，字比图标好认；2026-11-14 协调裁决：
 * 今天主线就有的样子不改），画布是圆形 ↑。忙态同时是闸：`disabled` 让第二下点不进去（2026-09-11 用户实测连点三下 = 排队三次）。
 */
export function ComposerSendButton({
  label, busy = false, disabled = false, ariaLabel, title, onClick, attrs,
}: {
  /** 钮上的字（分镜传「生成」）；不传 = 圆形 ↑。 */
  label?: string
  busy?: boolean
  disabled?: boolean
  ariaLabel: string
  /** 悬停说明（点不了时说清为什么）。禁用的 button 自己不触发 title，外层包一层。 */
  title?: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** 宿主的走查锚点（分镜行的 `data-storyboard-generate-state`）。 */
  attrs?: Readonly<Record<`data-${string}`, string>>
}): JSX.Element {
  const { t } = useTranslation()
  const button = label ? (
    <button
      type="button"
      data-bar-segment="generate"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-nomi-sm bg-nomi-ink px-2.5 text-caption font-medium text-nomi-paper',
        busy || disabled ? 'cursor-default opacity-60' : 'hover:opacity-90 active:opacity-80',
      )}
      aria-label={ariaLabel}
      aria-busy={busy}
      {...attrs}
    >
      {busy ? <IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /> : null}
      {busy ? t('storyboardEditor.frame.generating') : label}
      {busy ? null : <IconArrowUp size={12} stroke={2} aria-hidden />}
    </button>
  ) : (
    <button
      type="button"
      data-bar-segment="generate"
      className={GENERATE_BUTTON_CLASS}
      aria-label={ariaLabel}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
      {...attrs}
    >
      {busy ? '···' : <IconArrowUp size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />}
    </button>
  )
  return title ? <span title={title} style={{ display: 'contents' }}>{button}</span> : button
}
