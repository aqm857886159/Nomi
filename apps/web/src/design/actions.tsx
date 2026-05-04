import { ActionIcon, Button, type ActionIconProps, type ButtonProps } from '@mantine/core'
import { forwardRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type ReactNode } from 'react'
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
  const rootClassName = className ? `tc-icon-action-button ${className}` : 'tc-icon-action-button'
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

export function DesignButton({
  children,
  className,
  disabled,
  leftSection,
  loading = false,
  radius = 'sm',
  variant = 'light',
  ...props
}: DesignButtonProps): JSX.Element {
  const rootClassName = className ? `tc-design-button ${className}` : 'tc-design-button'
  const isLoading = Boolean(loading)

  return (
    <Button
      {...props}
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
}

export type WorkbenchIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode
  label: string
}

export function WorkbenchIconButton({
  icon,
  label,
  className,
  type = 'button',
  ...props
}: WorkbenchIconButtonProps): JSX.Element {
  const rootClassName = className ? `tc-workbench-icon-button ${className}` : 'tc-workbench-icon-button'

  return (
    <button
      {...props}
      className={rootClassName}
      type={type}
      aria-label={props['aria-label'] ?? label}
      title={props.title ?? label}
    >
      {icon}
    </button>
  )
}

export type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
}

export function WorkbenchButton({
  children,
  className,
  type = 'button',
  ...props
}: WorkbenchButtonProps): JSX.Element {
  const rootClassName = className ? `tc-workbench-button ${className}` : 'tc-workbench-button'

  return (
    <button
      {...props}
      className={rootClassName}
      type={type}
    >
      {children}
    </button>
  )
}
