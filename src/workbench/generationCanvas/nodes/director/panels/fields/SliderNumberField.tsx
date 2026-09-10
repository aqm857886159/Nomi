/**
 * [INPUT]: 依赖 react、../../../../../../utils/cn、./useNumberDraft
 * [OUTPUT]: 对外提供 SliderNumberField：标签 + 滑条 + 数字输入；滚轮按 step 微调（wheelAdjust）；onChangeStart 给撤销快照用
 * [POS]: director/panels/fields 的数值字段原语（清单 §4 检查器通用：滑条 + 输入 + 滚轮微调）；沿用 V1 检查器的原生 range 先例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { cn } from '../../../../../../utils/cn'
import { useNumberDraft } from './useNumberDraft'

export type SliderNumberFieldProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  digits?: number
  disabled?: boolean
  wheelAdjust?: boolean
  tip?: string
  onChange: (value: number) => void
  onChangeStart?: () => void
  className?: string
}

function snap(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value
  return Number((Math.round(value / step) * step).toFixed(6))
}

export function SliderNumberField({ label, value, min, max, step = 1, unit, digits, disabled, wheelAdjust = true, tip, onChange, onChangeStart, className }: SliderNumberFieldProps): JSX.Element {
  const decimals = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  const draft = useNumberDraft(value, decimals, (next) => {
    const clamped = clamp(next)
    if (clamped === value) return
    onChangeStart?.()
    onChange(clamped)
  })
  const changing = React.useRef(false)

  return (
    <label className={cn('mb-2 grid grid-cols-[52px_1fr_64px] items-center gap-2 text-caption', disabled ? 'pointer-events-none opacity-50' : '', className)} title={tip}>
      <span className="truncate text-nomi-ink-60">{label}</span>
      <input
        type="range"
        className="h-1 w-full cursor-pointer rounded-full accent-nomi-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={() => { changing.current = false }}
        onPointerUp={() => { changing.current = false }}
        onKeyDown={(event) => { if (!event.repeat) changing.current = false }}
        onKeyUp={() => { changing.current = false }}
        onBlur={() => { changing.current = false }}
        onChange={(event) => {
          if (!changing.current) { onChangeStart?.(); changing.current = true }
          onChange(clamp(snap(Number(event.target.value), step)))
        }}
        onWheel={(event) => {
          if (!wheelAdjust || disabled) return
          event.preventDefault()
          onChangeStart?.()
          const delta = (event.deltaY < 0 ? 1 : -1) * step
          onChange(clamp(snap(value + delta, step)))
        }}
      />
      <span className="inline-flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          className="w-full rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1.5 py-0.5 text-right font-nomi-mono text-caption text-nomi-ink"
          disabled={disabled}
          {...draft}
        />
        {unit ? <span className="text-micro text-nomi-ink-40">{unit}</span> : null}
      </span>
    </label>
  )
}
