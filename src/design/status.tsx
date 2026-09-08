import { Badge, Progress, type BadgeProps, type ProgressProps } from '@mantine/core'
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

/**
 * ⚠️ **采纳现状（2026-09-07 实测）：生产代码 0 个调用点。**
 * 保留理由不是「以后可能用得上」，而是有**具体的迁移对象**：画布侧另有 5 份手写徽章
 * （`nodes/NodeQueuedBadge.tsx` / `NodeLockBadge.tsx` / `NodeDeconstructionBadge.tsx` /
 * `TechnicalReviewBadge.tsx` / `render/ShotMountBadges.tsx`）——「状态徽章」这件事一直在
 * 做，只是没走这个组件。
 * 与 `NomiSkeleton` 同一类情形（那件本轮已被项目库 loading 态接走）。
 * 该走的路是**推广**（把画布侧那批手写徽章迁过来），不是删。迁移归属：D 档刀 4。
 * 在那之前，这里与 `DesignBadge` 的近重复也一并留着——先合并再迁移会让两件事纠缠。
 */
export function StatusBadge({
  tone = 'neutral',
  className,
  variant = 'light',
  ...props
}: StatusBadgeProps): JSX.Element {
  const rootClassName = cn('tracking-[0.03em]', className)

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
 *
 * ⚠️ 采纳现状同 `StatusBadge`：生产代码 0 个调用点，保留理由见上。
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
  return <Badge {...props} className={className} color={toneColorMap[tone]} radius={radius} variant={variant} />
}

export type DesignProgressProps = ProgressProps

export function DesignProgress({ className, radius = 'sm', ...props }: DesignProgressProps): JSX.Element {
  return <Progress {...props} className={className} radius={radius} />
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
