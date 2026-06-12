import type { CSSProperties } from 'react'
import { cn } from '../utils/cn'

type NomiBrandProps = {
  markSize?: number
  wordSize?: number
  className?: string
}

type NomiLogoMarkProps = {
  size?: number
  className?: string
}

type NomiLoadingMarkProps = {
  size?: number
  className?: string
  label?: string
}

type NomiAILabelProps = {
  markSize?: number
  wordSize?: number
  className?: string
  suffix?: string
}

type NomiStepperProps = {
  value: 'creation' | 'generation' | 'preview'
  onChange: (mode: 'creation' | 'generation' | 'preview') => void
}

export function NomiBrand({ markSize = 26, wordSize = 17, className }: NomiBrandProps): JSX.Element {
  const rx = Math.round((markSize / 28) * 7)

  return (
    <div className={cn('nomi-brand', 'inline-flex items-center gap-2 shrink-0', className)} aria-label="Nomi">
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="28" height="28" rx={rx} fill="oklch(0.22 0.01 80)" />
        <rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
        <rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
        <polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white" />
      </svg>
      <span className={cn('nomi-brand__word', 'font-nomi-display font-normal tracking-[-0.02em] text-nomi-ink leading-none')} style={{ fontSize: wordSize }} aria-hidden="true">
        No<span className={cn('nomi-brand__accent', 'text-nomi-accent')}>m</span>i
      </span>
    </div>
  )
}

export function NomiLogoMark({ size = 24, className }: NomiLogoMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={cn('nomi-logo-mark', 'block shrink-0', className)}
    >
      <rect width="28" height="28" rx="7" fill="oklch(0.22 0.01 80)" />
      <rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white" />
    </svg>
  )
}

export function NomiLoadingMark({ size = 18, className, label = '加载中' }: NomiLoadingMarkProps): JSX.Element {
  return (
    <span
      className={cn('nomi-loading-mark', 'inline-grid place-items-center flex-none leading-none animate-spin motion-reduce:animate-none', className)}
      aria-label={label}
      role="status"
      style={{ '--nomi-loading-size': `${size}px`, width: `${size}px`, height: `${size}px` } as CSSProperties}
    >
      <NomiLogoMark size={size} className={cn('nomi-loading-mark__logo', 'block')} />
    </span>
  )
}

export function NomiAILabel({ markSize = 22, wordSize = 14, className, suffix = 'AI' }: NomiAILabelProps): JSX.Element {
  return (
    <div className={cn('nomi-ai-label', 'inline-flex items-center gap-2 shrink-0', className)} aria-label={`Nomi ${suffix}`}>
      <NomiLogoMark size={markSize} />
      <span className={cn('nomi-ai-label__text', 'font-nomi-display font-normal tracking-[-0.02em] text-nomi-ink leading-none')} style={{ fontSize: wordSize }}>
        No<span className={cn('nomi-ai-label__accent', 'text-nomi-accent')}>m</span>i
        <span className={cn('nomi-ai-label__suffix', 'text-nomi-ink-60 tracking-[-0.01em]')}> {suffix}</span>
      </span>
    </div>
  )
}

const NOMI_TABS: { mode: NomiStepperProps['value']; label: string }[] = [
  { mode: 'creation', label: '创作' },
  { mode: 'generation', label: '生成' },
  { mode: 'preview', label: '预览' },
]

export function NomiStepper({ value, onChange }: NomiStepperProps): JSX.Element {
  return (
    <nav className={cn('nomi-stepper', 'inline-flex items-center gap-0.5 p-1 border border-nomi-line-soft rounded-full bg-[var(--nomi-ink-05)]')} aria-label="工作区切换">
      {NOMI_TABS.map((tab) => (
        <button
          key={tab.mode}
          className={cn(
            'nomi-stepper__step',
            'inline-flex items-center px-3.5 py-[5px] border-0 rounded-full bg-transparent text-nomi-ink-60 font-inherit text-[13px] font-medium cursor-pointer',
            'transition-[background,color,box-shadow] ease-nomi-fast',
            'hover:text-nomi-ink',
            'data-[state=active]:bg-nomi-paper data-[state=active]:text-nomi-ink data-[state=active]:shadow-nomi-sm',
          )}
          type="button"
          aria-current={value === tab.mode ? 'page' : undefined}
          data-state={value === tab.mode ? 'active' : 'idle'}
          data-mode={tab.mode}
          onClick={() => onChange(tab.mode)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
