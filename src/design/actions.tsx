import { ActionIcon, Button, type ActionIconProps, type ButtonProps } from '@mantine/core'
import { forwardRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '../utils/cn'
import { NomiLoadingMark } from './identity'

export type IconActionButtonProps = Omit<ActionIconProps, 'children'> & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  icon: ReactNode
}

export const IconActionButton = forwardRef<HTMLButtonElement, IconActionButtonProps>(function IconActionButton({
  icon,
  className,
  disabled,
  loading = false,
  variant = 'subtle',
  ...props
}, ref): JSX.Element {
  const rootClassName = cn(
    'tc-icon-action-button',
    'inline-flex items-center justify-center',
    'size-8 rounded-workbench-control',
    // 背景必须自己声明(哪怕就是透明)——Mantine 的 ActionIcon 基础样式给 :disabled/[data-disabled]
    // 铺了一块实色底(亮 gray-1 / 暗 dark-6),我们不写 bg-* 时那块灰底就是唯一生效的背景规则,
    // 禁用态反而比旁边可点的那颗更抢眼、读起来像「选中/悬停」而不是「点不了」(违背 §1.6 C1)。
    // 写成基类而不是 disabled: 变体:tailwind-merge 会让调用点自己的 bg-* 整体接管(如详情弹窗
    // 关闭钮的 bg-nomi-paper/95),而 disabled: 变体特异性更高会把调用点的底色一起吃掉。
    'bg-transparent text-workbench-muted',
    'transition-[background,color] duration-150 ease-out',
    // 禁用的 <button> 在 CSS 里照样匹配 :hover,所以 hover 反馈必须显式排除禁用态,否则鼠标
    // 移上去又铺一块底、字也提亮,同样在说「我可以点」。底色用基类的 disabled:hover:
    // (特异性 0,3,0)压住调用点自己的 hover:bg-*(0,2,0),各处不必重复写一遍;文字色只用
    // enabled: 收住本组件这一条,不去盖调用点自己的 hover:text-*(那是调用点的取舍)。
    'hover:bg-workbench-hover enabled:hover:text-workbench-ink',
    'disabled:hover:bg-transparent',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    className,
  )
  const isLoading = Boolean(loading)

  return (
    <ActionIcon
      {...props}
      ref={ref}
      className={rootClassName}
      disabled={disabled || isLoading}
      loading={false}
      radius="xs"
      variant={variant}
      aria-busy={isLoading || undefined}
    >
      {isLoading ? <NomiLoadingMark size={14} /> : icon}
    </ActionIcon>
  )
})

export type DesignButtonProps = ButtonProps & ComponentPropsWithoutRef<'button'>

export const DesignButton = forwardRef<HTMLButtonElement, DesignButtonProps>(function DesignButton({
  children,
  className,
  disabled,
  leftSection,
  loading = false,
  radius = 'sm',
  variant = 'light',
  ...props
}, ref): JSX.Element {
  const rootClassName = cn(
    'tc-design-button',
    'inline-flex items-center justify-center gap-1.5',
    'h-8 px-3 rounded-nomi-sm',
    'text-body-sm font-medium',
    'transition-[background,color,border-color] duration-150 ease-out',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    className,
  )
  const isLoading = Boolean(loading)

  return (
    <Button
      {...props}
      ref={ref}
      className={rootClassName}
      disabled={disabled || isLoading}
      leftSection={isLoading ? <NomiLoadingMark size={14} /> : leftSection}
      loading={false}
      radius={radius}
      variant={variant}
      aria-busy={isLoading || undefined}
    >
      {children}
    </Button>
  )
})

export type WorkbenchIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode
  label: string
  /** md = 32px (default), sm = 28px for compact canvas/tool surfaces. */
  size?: 'sm' | 'md'
}

const WORKBENCH_ICON_BUTTON_SIZE = {
  md: 'size-8',
  sm: 'size-7',
} as const

export const WorkbenchIconButton = forwardRef<HTMLButtonElement, WorkbenchIconButtonProps>(function WorkbenchIconButton({
  icon,
  label,
  size = 'md',
  className,
  type = 'button',
  ...props
}, ref): JSX.Element {
  const rootClassName = cn(
    'tc-workbench-icon-button',
    'inline-grid place-items-center',
    WORKBENCH_ICON_BUTTON_SIZE[size],
    'rounded-workbench-control border-0',
    'bg-transparent text-workbench-muted',
    'cursor-pointer',
    'transition-[background,color] duration-150 ease-out',
    'hover:bg-workbench-hover hover:text-workbench-ink',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    '[&>svg]:size-4 [&>svg]:stroke-2',
    className,
  )

  return (
    <button
      {...props}
      ref={ref}
      className={rootClassName}
      type={type}
      aria-label={props['aria-label'] ?? label}
      title={props.title ?? label}
    >
      {icon}
    </button>
  )
})

export type ActionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode
  title: string
  description: string
  variant?: 'primary' | 'default'
}

/**
 * 起始页主入口动作卡片（设计系统 §3.2）。
 * 比按钮大一个量级（280×88），用尺寸/形态/位置三重区隔承载页面级主操作；
 * 一页至多一张 primary。低频操作不要用它（用 WorkbenchButton）。
 */
export const ActionCard = forwardRef<HTMLButtonElement, ActionCardProps>(function ActionCard({
  icon,
  title,
  description,
  variant = 'default',
  className,
  type = 'button',
  ...props
}, ref): JSX.Element {
  const isPrimary = variant === 'primary'
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      data-variant={variant}
      className={cn(
        'tc-action-card',
        'flex items-center gap-3 w-[280px] h-[88px] px-5 text-left cursor-pointer font-inherit',
        'rounded-nomi border shadow-nomi-sm',
        'transition-[background,border-color,box-shadow,transform] duration-150 ease-out',
        'hover:-translate-y-0.5 hover:shadow-nomi-md active:translate-y-0 active:shadow-nomi-sm',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        isPrimary
          ? 'border-nomi-ink bg-nomi-ink text-nomi-paper hover:bg-nomi-accent hover:border-nomi-accent'
          : 'border-nomi-line bg-nomi-paper text-nomi-ink hover:border-nomi-ink-20',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 inline-grid place-items-center size-10 rounded-full',
          isPrimary
            ? 'bg-[color-mix(in_oklch,var(--nomi-paper)_14%,transparent)] text-nomi-paper'
            : 'bg-nomi-ink-05 text-nomi-ink-80',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        {/* 标题允许 2 行（line-clamp-2），不按最长中文标题定死单行截断——EN 标题（如
            "See how Nomi creates a video"）比中文长得多，单行 truncate 会截成「…a v…」。
            2 行 clamp 各 locale 通吃：短标题仍单行，长标题换行不外溢，卡片高度 88px 兜得住。 */}
        <span className="block text-body font-semibold line-clamp-2 leading-snug">{title}</span>
        <span
          className={cn(
            'block mt-0.5 text-caption truncate',
            isPrimary
              ? 'text-[color-mix(in_oklch,var(--nomi-paper)_72%,transparent)]'
              : 'text-nomi-ink-60',
          )}
        >
          {description}
        </span>
      </span>
    </button>
  )
})

// 变体/尺寸 = 工作区按钮的唯一真相源:卡片动作(确认/拒绝/整笔撤销/撤销这次改动/让AI修…)
// 一律走 variant+size,不再各处 ad-hoc className 各覆写一套(那是「明显不是一个设计风格」的根因)。
const WORKBENCH_BUTTON_SIZE = {
  md: 'h-8 px-3 text-body-sm',
  sm: 'h-7 px-3 text-caption', // 时间线卡片内的紧凑动作
} as const

const WORKBENCH_BUTTON_VARIANT = {
  // 次要/幽灵:边框 + 浅底,工作区默认。
  default: cn(
    'border border-workbench-border-soft bg-workbench-surface text-workbench-ink',
    'hover:bg-workbench-hover active:bg-workbench-pressed',
  ),
  // 主操作:深底反白,hover 转 accent(确认/撤销这次改动等强动作)。
  primary: cn(
    'border-0 bg-nomi-ink text-nomi-paper',
    'hover:bg-nomi-accent',
  ),
  // 强调文字:幽灵底 + accent 字(「让 AI 修一下」这类引导操作)。
  accent: cn(
    'border border-workbench-border-soft bg-workbench-surface text-nomi-accent',
    'hover:bg-workbench-hover',
  ),
} as const

export type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
  /** pending 规范 #2:点击触发 async 时置 true → 品牌 N 转圈占位 + 自动禁用 + aria-busy。 */
  loading?: boolean
  variant?: keyof typeof WORKBENCH_BUTTON_VARIANT
  size?: keyof typeof WORKBENCH_BUTTON_SIZE
}

export const WorkbenchButton = forwardRef<HTMLButtonElement, WorkbenchButtonProps>(function WorkbenchButton({
  children,
  className,
  type = 'button',
  loading = false,
  disabled,
  variant = 'default',
  size = 'md',
  ...props
}, ref): JSX.Element {
  const rootClassName = cn(
    'tc-workbench-button',
    // whitespace-nowrap:按钮文字永不逐字折行(根因治本)——窄容器里被挤压时宁可溢出/由
    // 调用处给 shrink-0,也绝不把「整笔撤销」这种 4 字标签折成竖排(2026-06-23 用户截图根因)。
    'inline-flex items-center justify-center gap-1.5 rounded-workbench-control font-medium whitespace-nowrap',
    'cursor-pointer',
    'transition-[background,border-color,color,box-shadow] duration-150 ease-out',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    '[&>svg]:size-4 [&>svg]:stroke-2',
    WORKBENCH_BUTTON_SIZE[size],
    WORKBENCH_BUTTON_VARIANT[variant],
    className,
  )

  return (
    <button
      {...props}
      ref={ref}
      className={rootClassName}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <NomiLoadingMark size={14} /> : null}
      {children}
    </button>
  )
})
