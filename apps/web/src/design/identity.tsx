import type { CSSProperties } from 'react'

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
    <div className={`nomi-brand${className ? ` ${className}` : ''}`} aria-label="Nomi">
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <rect width="28" height="28" rx={rx} fill="oklch(0.22 0.01 80)" />
        <rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
        <rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
        <polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white" />
      </svg>
      <span className="nomi-brand__word" style={{ fontSize: wordSize }} aria-hidden="true">
        No<span className="nomi-brand__accent">m</span>i
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
      className={className}
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
      className={`nomi-loading-mark${className ? ` ${className}` : ''}`}
      aria-label={label}
      role="status"
      style={{ '--nomi-loading-size': `${size}px` } as CSSProperties}
    >
      <NomiLogoMark size={size} className="nomi-loading-mark__logo" />
    </span>
  )
}

export function NomiAILabel({ markSize = 22, wordSize = 14, className, suffix = 'AI' }: NomiAILabelProps): JSX.Element {
  return (
    <div className={`nomi-ai-label${className ? ` ${className}` : ''}`} aria-label={`Nomi ${suffix}`}>
      <NomiLogoMark size={markSize} />
      <span className="nomi-ai-label__text" style={{ fontSize: wordSize }}>
        No<span className="nomi-ai-label__accent">m</span>i
        <span className="nomi-ai-label__suffix"> {suffix}</span>
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
    <nav className="nomi-stepper" aria-label="工作区切换">
      {NOMI_TABS.map((tab) => (
        <button
          key={tab.mode}
          className="nomi-stepper__step"
          type="button"
          aria-current={value === tab.mode ? 'page' : undefined}
          data-state={value === tab.mode ? 'active' : 'idle'}
          onClick={() => onChange(tab.mode)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
