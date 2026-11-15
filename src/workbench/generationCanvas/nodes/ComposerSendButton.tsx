import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowUp, IconCoin, IconLoader2 } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { ICON_TIERS } from '../../../design'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { ComposerBarYieldContext } from './composerBarYield'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../design/tooltip'

/**
 * 生成底栏最右的「走」钮——画布节点、画布列表详情、分镜行、分镜参考卡四处同一颗。
 *
 * 只有一处不同，由宿主说：分镜行 / 参考卡今天就是带字的「生成 ↑」（一屏十几行，字比图标好认；2026-11-14 协调裁决：
 * 今天主线就有的样子不改），画布是圆形 ↑。忙态同时是闸：`disabled` 让第二下点不进去（2026-09-11 用户实测连点三下 = 排队三次）。
 */
export function ComposerSendButton({
  label, busy = false, disabled = false, ariaLabel, title, onClick, attrs, cost, description,
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
  /**
   * 圆钮左边并进去的花费（板 ModelSurfaces cost.send-pill）：`coin` = 硬币 + 积分数；不带 coin = 换成的一句（「去充值」）。
   * 不传 = 圆钮原样。只有画布圆钮用；带字钮（分镜）这一刀不接。
   */
  cost?: { text: string; coin: boolean }
  /** 读屏补充说明（悬停那一句估价）。 */
  description?: string
}): JSX.Element {
  const { t } = useTranslation()
  // 底栏窄时第①步让法：带字钮只剩「↑」。让到第几步只在 InlineParameterBar 算一次、经 context 发来；不在底栏里 = 默认不收。
  const { sendIconOnly } = React.useContext(ComposerBarYieldContext)
  const button = label && sendIconOnly ? (
    <TooltipProvider delayDuration={120}>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-bar-segment="generate"
            data-icon-only=""
            onClick={onClick}
            disabled={busy || disabled}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-nomi-sm bg-nomi-ink text-nomi-paper',
              busy || disabled ? 'cursor-default opacity-60' : 'hover:opacity-90 active:opacity-80',
            )}
            aria-label={ariaLabel}
            aria-busy={busy}
            {...attrs}
          >
            {busy
              ? <IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden />
              : <IconArrowUp size={12} stroke={2} aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : label ? (
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
      className={cn(GENERATE_BUTTON_CLASS, cost && !busy && '!w-auto min-w-8 gap-1 px-2')}
      aria-label={ariaLabel}
      aria-description={description}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
      {...attrs}
    >
      {cost && !busy ? (
        <span data-send-cost={cost.coin ? 'credits' : 'action'} className="inline-flex items-center gap-1 whitespace-nowrap text-micro">
          {cost.coin ? <IconCoin size={13} aria-hidden /> : null}{cost.text}
        </span>
      ) : null}
      {busy ? '···' : <IconArrowUp size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />}
    </button>
  )
  return title ? <span title={title} style={{ display: 'contents' }}>{button}</span> : button
}
