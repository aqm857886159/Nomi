import React from 'react'
import { IconMoonStars, IconSun } from '../../vendor/tablerIcons'
import { cn } from '../../utils/cn'
import { useNomiColorScheme } from '../../theme/colorScheme'

type ThemeToggleButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export function ThemeToggleButton({ className, ...props }: ThemeToggleButtonProps): JSX.Element {
  const { isDark, toggleColorScheme } = useNomiColorScheme()
  const label = isDark ? '切换到浅色模式' : '切换到深色模式'
  const Icon = isDark ? IconSun : IconMoonStars

  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      aria-label={props['aria-label'] ?? label}
      aria-pressed={isDark}
      title={props.title ?? label}
      onClick={(event) => {
        props.onClick?.(event)
        if (!event.defaultPrevented) toggleColorScheme()
      }}
      className={cn(
        'inline-grid place-items-center size-8 rounded-nomi-sm border border-transparent',
        'bg-transparent text-[var(--nomi-ink-60)] cursor-pointer',
        'transition-[background,border-color,color] duration-[var(--nomi-transition-fast)]',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
        'focus-visible:outline-2 focus-visible:outline-[var(--nomi-accent)] focus-visible:outline-offset-2',
        className,
      )}
    >
      <Icon size={16} stroke={1.8} aria-hidden="true" />
    </button>
  )
}
