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
    'inline-flex items-center justify-center',
    'size-8 rounded-workbench-control',
    'text-workbench-muted',
    'transition-[background,color] duration-150 ease-out',
    'hover:bg-workbench-hover hover:text-workbench-ink',
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

// DesignButton 的尺寸真相源。原先包装层把 `h-8 px-3 text-body-sm` 写死，而生成的 CSS 里
// Tailwind 整段排在 `@mantine/core/styles.css` 之后（scripts/build-tailwind.mjs:42-51），
// 同特异度下后来者胜 —— Mantine 按 `size` 生成的 `--button-height/-padding-x/-fz` 全被盖掉，
// `size` prop 是死的。改成本地映射后 `size` 真正生效；`md`(h-9 px-3) 就是各处
// `className="h-9"` 绕行写法的正主。默认档 `sm` 与历史渲染逐像素一致。
const DESIGN_BUTTON_SIZE = {
  xs: 'h-7 px-3 text-caption', // 与 WorkbenchButton 的紧凑档同一根尺寸轴
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-9 px-3 text-body-sm',
} as const

/**
 * Mantine `Button` 的合法 variant 八值。收窄它的理由是实测：写一个**不存在**的值
 * （`BrowserAssetPopoverView` 曾写 `variant="primary"`——那是 `WorkbenchButton` 的词表，
 * 两个组件容易混）不会报错、也不会裸奔，Mantine 对未知 variant 不设 `--button-bg`，
 * CSS 回落到主题 `primaryColor`；而本仓 `primaryColor: 'dark'`（nomiTheme.ts:122）
 * 恰好与 `filled` 同一块深底，于是**碰巧渲染正确**。
 * 下一个人写 `variant="ghost"` 就不一定有这个运气——所以让编译器拦，别赌回落。
 */
type DesignButtonVariant = 'filled' | 'light' | 'outline' | 'subtle' | 'default' | 'gradient' | 'transparent' | 'white'

export type DesignButtonProps =
  Omit<ButtonProps, 'size' | 'variant'>
  & Omit<ComponentPropsWithoutRef<'button'>, 'size'>
  & {
    size?: keyof typeof DESIGN_BUTTON_SIZE
    variant?: DesignButtonVariant
  }

export const DesignButton = forwardRef<HTMLButtonElement, DesignButtonProps>(function DesignButton({
  children,
  className,
  disabled,
  leftSection,
  loading = false,
  radius = 'sm',
  size = 'sm',
  variant = 'light',
  ...props
}, ref): JSX.Element {
  const rootClassName = cn(
    'inline-flex items-center justify-center gap-1.5',
    'rounded-nomi-sm font-medium',
    DESIGN_BUTTON_SIZE[size],
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
        // 唯一还活着的 `tc-` 钩子：它不是样式钩子，是走查锚点——
        // tests/ux/design-fidelity.e2e.mjs:57 与 tests/ux/cold-start.e2e.mjs:63 靠它定位动作卡。
        // 同族另外 20 个 `tc-*` 已于 2026-09-07 删除（全仓零 CSS 定义、零选择器）。
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
