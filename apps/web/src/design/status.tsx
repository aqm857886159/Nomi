import { Alert, Badge, Progress, type AlertProps, type BadgeProps, type ProgressProps } from '@mantine/core'

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

export function StatusBadge({ tone = 'neutral', className, variant = 'light', ...props }: StatusBadgeProps): JSX.Element {
  const rootClassName = className ? `tc-status-badge ${className}` : 'tc-status-badge'

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

export type DesignBadgeProps = BadgeProps

export function DesignBadge({
  className,
  radius = 'sm',
  variant = 'light',
  ...props
}: DesignBadgeProps): JSX.Element {
  const rootClassName = className ? `tc-design-badge ${className}` : 'tc-design-badge'

  return (
    <Badge
      {...props}
      className={rootClassName}
      radius={radius}
      variant={variant}
    />
  )
}

export type DesignAlertProps = AlertProps

export function DesignAlert({ className, radius = 'sm', variant = 'light', ...props }: DesignAlertProps): JSX.Element {
  const rootClassName = className ? `tc-design-alert ${className}` : 'tc-design-alert'

  return <Alert {...props} className={rootClassName} radius={radius} variant={variant} />
}

export type DesignProgressProps = ProgressProps

export function DesignProgress({ className, radius = 'sm', ...props }: DesignProgressProps): JSX.Element {
  const rootClassName = className ? `tc-design-progress ${className}` : 'tc-design-progress'

  return <Progress {...props} className={rootClassName} radius={radius} />
}
