import type { CSSProperties, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
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
  value: 'creation' | 'storyboard' | 'generation' | 'preview'
  onChange: (mode: 'creation' | 'storyboard' | 'generation' | 'preview') => void
}

type NomiWordmarkProps = {
  /** 字号 px；缺省则继承父级 font-size（如放进 h1 用 text-display）。 */
  fontSize?: number
  className?: string
} & HTMLAttributes<HTMLSpanElement>

/**
 * Nomi 文字标志「No·m·i」的**唯一真相源**（P1）：中间的 m 永远 accent 色、Fraunces 字体。
 * No/i 颜色由 className/父级控制（品牌处 text-nomi-ink、消息标签处可灰）；m 的 accent 是品牌不变量。
 * 任何要显示「Nomi」字标的地方都用它，别再手写 `No<span>m</span>i`。
 */
export function NomiWordmark({ fontSize, className, ...rest }: NomiWordmarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn('nomi-wordmark', 'font-nomi-display font-normal tracking-[-0.02em] leading-none', className)}
      style={fontSize ? { fontSize } : undefined}
      {...rest}
    >
      {t('brand.wordStart')}
      <span className={cn('nomi-wordmark__accent', 'text-nomi-accent')}>{t('brand.wordAccent')}</span>
      {t('brand.wordEnd')}
    </span>
  )
}

/**
 * 品牌标记的**唯一几何真相源**(P1):圆角方底 + 双竖 + 斜杠,viewBox 恒 28×28。
 *
 * 圆角 rx **恒为 7**(= 边长 25%),与 public/nomi-logo.svg、build/icon.png 同一形状。
 * **千万别按渲染尺寸再算一次 rx**:rx 是 viewBox 单位,缩放本来就由 viewBox 负责,
 * 乘 markSize 等于双重缩放——markSize≥56 时 rx 超过半边长(14),被 SVG 截断成**正圆**。
 * 2026-09-02 实测:开屏标版 markSize=75 → rx=19 → 屏幕上是个圆,而 README/系统图标是圆角方。
 * 两个组件共用这一份,就是为了这个 bug 不会再从另一个调用方回来。
 */
const NOMI_MARK_VIEWBOX = '0 0 28 28'

function NomiMarkShapes(): JSX.Element {
  return (
    <>
      <rect width="28" height="28" rx="7" fill="var(--nomi-logo-ground)" />
      <rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white" />
    </>
  )
}

export function NomiBrand({ markSize = 26, wordSize = 17, className }: NomiBrandProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className={cn('nomi-brand', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.name')}
    >
      <svg width={markSize} height={markSize} viewBox={NOMI_MARK_VIEWBOX} fill="none" aria-hidden="true" className="shrink-0">
        <NomiMarkShapes />
      </svg>
      <NomiWordmark fontSize={wordSize} className="nomi-brand__word text-nomi-ink" aria-hidden="true" />
    </div>
  )
}

export function NomiLogoMark({ size = 24, className }: NomiLogoMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={NOMI_MARK_VIEWBOX}
      fill="none"
      aria-hidden="true"
      className={cn('nomi-logo-mark', 'block shrink-0', className)}
    >
      <NomiMarkShapes />
    </svg>
  )
}

export function NomiLoadingMark({ size = 18, className, label }: NomiLoadingMarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'nomi-loading-mark',
        'inline-grid place-items-center flex-none leading-none animate-spin motion-reduce:animate-none',
        className,
      )}
      aria-label={label ?? t('common.loading')}
      role="status"
      style={{ '--nomi-loading-size': `${size}px`, width: `${size}px`, height: `${size}px` } as CSSProperties}
    >
      <NomiLogoMark size={size} className={cn('nomi-loading-mark__logo', 'block')} />
    </span>
  )
}

export function NomiAILabel({ markSize = 22, wordSize = 14, className, suffix = 'AI' }: NomiAILabelProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn('nomi-ai-label', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.aiLabel', { suffix })}
    >
      <NomiLogoMark size={markSize} />
      <span className={cn('nomi-ai-label__text', 'leading-none')} style={{ fontSize: wordSize }}>
        <NomiWordmark className="nomi-ai-label__word text-nomi-ink" />
        <span className={cn('nomi-ai-label__suffix', 'font-nomi-display text-nomi-ink-60 tracking-[-0.01em]')}>
          {' '}
          {suffix}
        </span>
      </span>
    </div>
  )
}

export function NomiStepper({ value, onChange }: NomiStepperProps): JSX.Element {
  const { t } = useTranslation()
  const visibleValue = value === 'storyboard' ? 'creation' : value
  const tabs: { mode: NomiStepperProps['value']; label: string }[] = [
    { mode: 'creation', label: t('workspace.creationTab') },
    { mode: 'generation', label: t('workspace.generationTab') },
    { mode: 'preview', label: t('workspace.previewTab') },
  ]
  return (
    <nav
      className={cn(
        'nomi-stepper',
        'inline-flex items-center gap-0.5 p-1 border border-nomi-line-soft rounded-full bg-[var(--nomi-ink-05)]',
      )}
      aria-label={t('workspace.switchLabel')}
    >
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          className={cn(
            'nomi-stepper__step',
            'inline-flex items-center px-3.5 py-[5px] border-0 rounded-full bg-transparent text-nomi-ink-60 font-inherit text-body-sm font-medium cursor-pointer',
            'transition-[background,color,box-shadow] ease-nomi-fast',
            'hover:text-nomi-ink',
            'data-[state=active]:bg-nomi-paper data-[state=active]:text-nomi-ink data-[state=active]:shadow-nomi-sm',
          )}
          type="button"
          aria-current={visibleValue === tab.mode ? 'page' : undefined}
          data-state={visibleValue === tab.mode ? 'active' : 'idle'}
          data-mode={tab.mode}
          onClick={() => onChange(tab.mode)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
