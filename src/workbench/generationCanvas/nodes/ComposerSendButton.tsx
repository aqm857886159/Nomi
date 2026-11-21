import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowUp, IconCoin, IconLoader2 } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { ICON_TIERS } from '../../../design'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { ComposerBarYieldContext } from './composerBarYield'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../design/tooltip'

// 带字框 = 左右内边距 + 图标 + 间距；校准走查对照实际绘制，不能用它们反过来画 CSS。
// eslint-disable-next-line react-refresh/only-export-components -- 量宽必须复用绘制组件的定义，校准测试防止两者漂移。
export const COMPOSER_SEND_FRAME = { label: 36, icon: 28 } as const

/**
 * 生成底栏最右的「走」钮——画布节点、画布列表详情、分镜行、分镜参考卡四处同一颗。
 *
 * 只有一处不同，由宿主说：分镜行 / 参考卡今天就是带字的「生成 ↑」（一屏十几行，字比图标好认；2026-11-14 协调裁决：
 * 今天主线就有的样子不改），画布是圆形 ↑。
 *
 * 忙态的闸两处不一样，都是有意的（别把它们并成一个「能不能按」）：
 * - 带字两支（分镜行 / 参考卡）：`busy` 时 `disabled`，第二下点不进去（2026-09-11 用户实测连点三下 = 排队三次）。
 * - 圆形支（画布节点 / 画布列表详情）：生成中不置灰（3797fde0c，用户 2026-11-02「人亲手点不再被拒」）。按下去由
 *   `confirmAndRunNode` 先问「再发一次？上一次还没结束，可能再扣」，确认才发；同一次点击只发一次靠 `preparingSingleGeneration`。
 */
export function ComposerSendButton({
  label, busy = false, disabled = false, ariaLabel, title, onClick, attrs, cost,
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
   * 发送键上的约价（板 ModelSurfaces cost.send-pill / cost.hover）。只有画布圆钮用；带字钮（分镜行、镜头条）不接。
   * 不传 = 和没有约价时逐像素一样；忙着时也照原样（不印数）。
   * - `credits`：键上印的积分数（已格式化）。有 = 浅灰胶囊里硬币 + 数字，右端还是那颗黑圆 ↑；没有 = 只剩 ↑。
   * - `description`：悬停 / 读屏那一句（共用提示组件原样画，不自带定位、边框、圆角）。
   */
  cost?: { credits?: string; description: string }
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
  ) : cost && !busy ? (
    // 约价：整颗仍是一个钮。有数 = 胶囊从黑圆 ↑ 左边长出来（比圆钮高 4px，上下右各让 2px 外边距，黑圆大小和位置不变、底栏不长高）；
    // 估不出 = 只剩那颗黑圆 ↑。悬停那一句用共用提示组件；禁用时先说为什么点不了，再说约价。
    <TooltipProvider delayDuration={120}>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <span data-send-cost-trigger="" className="inline-flex shrink-0">
            {cost.credits !== undefined ? (
              <button
                type="button"
                data-bar-segment="generate"
                className="group -my-0.5 -mr-0.5 inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-nomi-ink-10 py-0 pl-2.5 pr-0.5 disabled:cursor-not-allowed"
                aria-label={ariaLabel}
                aria-description={cost.description}
                aria-busy={busy}
                disabled={disabled}
                onClick={onClick}
                {...attrs}
              >
                <span data-send-cost="credits" className="inline-flex items-center gap-1 whitespace-nowrap text-body-sm font-semibold tabular-nums text-nomi-ink-80">
                  <IconCoin size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />{cost.credits}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-nomi-ink text-nomi-paper transition-colors',
                    'group-hover:group-enabled:bg-nomi-accent group-disabled:bg-nomi-ink-20 group-disabled:text-nomi-ink-40',
                  )}
                >
                  <IconArrowUp size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />
                </span>
              </button>
            ) : (
              <button
                type="button"
                data-bar-segment="generate"
                className={GENERATE_BUTTON_CLASS}
                aria-label={ariaLabel}
                aria-description={cost.description}
                aria-busy={busy}
                disabled={disabled}
                onClick={onClick}
                {...attrs}
              >
                <IconArrowUp size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />
              </button>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent data-send-cost-hover="" className="max-w-56 whitespace-normal leading-snug">
          {disabled && title ? <>{title}<br /></> : null}{cost.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  // 带约价时悬停由共用提示组件说（原生 title 会和它叠成两层）；其余照旧原生 title。
  return title && !(cost && !busy) ? <span title={title} style={{ display: 'contents' }}>{button}</span> : button
}
