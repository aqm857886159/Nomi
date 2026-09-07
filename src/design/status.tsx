import { Alert, Badge, Progress, type AlertProps, type BadgeProps, type ProgressProps } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'

type StatusBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const toneColorMap: Record<StatusBadgeTone, string> = {
  neutral: 'gray',
  info: 'blue',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
}

export type StatusBadgeProps = Omit<BadgeProps, 'color'> & {
  tone?: StatusBadgeTone
}

export function StatusBadge({
  tone = 'neutral',
  className,
  variant = 'light',
  ...props
}: StatusBadgeProps): JSX.Element {
  const rootClassName = cn('tc-status-badge', 'tracking-[0.03em]', className)

  return (
    <Badge
      {...props}
      className={rootClassName}
      color={toneColorMap[tone]}
      radius="md"
      size={props.size ?? 'sm'}
      variant={variant}
    />
  )
}

/**
 * `DesignBadge` 与 `StatusBadge` 共用同一套 tone 词表——语义只有这五个，
 * 谁也不许再引第六种色。曾经 `DesignBadge` 直接透传 Mantine 的 `color`，
 * 于是 `color="grape"` 能绕过整套 token 上一块 Mantine 自带的紫（设计实验室的
 * PRO 徽章因此在四套候选配色下岿然不变）。收敛成封闭词表后，类型层就拦住了。
 */
export type DesignBadgeProps = Omit<BadgeProps, 'color'> & {
  tone?: StatusBadgeTone
}

export function DesignBadge({
  tone = 'neutral',
  className,
  radius = 'sm',
  variant = 'light',
  ...props
}: DesignBadgeProps): JSX.Element {
  const rootClassName = cn('tc-design-badge', className)

  return <Badge {...props} className={rootClassName} color={toneColorMap[tone]} radius={radius} variant={variant} />
}

export type DesignAlertProps = AlertProps

export function DesignAlert({ className, radius = 'sm', variant = 'light', ...props }: DesignAlertProps): JSX.Element {
  const rootClassName = cn('tc-design-alert', className)

  return <Alert {...props} className={rootClassName} radius={radius} variant={variant} />
}

export type DesignProgressProps = ProgressProps

export function DesignProgress({ className, radius = 'sm', ...props }: DesignProgressProps): JSX.Element {
  const rootClassName = cn('tc-design-progress', className)

  return <Progress {...props} className={rootClassName} radius={radius} />
}

export type NomiSkeletonProps = {
  /** 占位条数(列表/多行用);默认 1。 */
  lines?: number
  /** 每条高度 token class,默认 h-4。 */
  className?: string
}

/**
 * 内容骨架屏(pending 规范 #3):列表/面板数据 async 加载期的占位,替代「空白色块 /
 * return null / 空态文字」。token-only pulse 块;motion-reduce 不闪。
 */
export function NomiSkeleton({ lines = 1, className }: NomiSkeletonProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('flex flex-col gap-2')} role="status" aria-label={t('common.loading')} aria-busy="true">
      {Array.from({ length: Math.max(1, lines) }).map((_, index) => (
        <div
          key={index}
          className={cn(
            'h-4 rounded-nomi-sm bg-nomi-ink-10 animate-pulse motion-reduce:animate-none',
            // 多行时末行短一截,更像真实文本块
            lines > 1 && index === lines - 1 ? 'w-3/5' : 'w-full',
            className,
          )}
        />
      ))}
    </div>
  )
}
