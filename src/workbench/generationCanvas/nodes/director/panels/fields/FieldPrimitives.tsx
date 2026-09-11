/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../utils/cn、../../../../../vendor/tablerIcons 的 IconRefresh、../../scene/sceneTheme 的 CHARACTER_COLOR_PRESETS、./useNumberDraft
 * [OUTPUT]: 对外提供 SectionHeader（分区标题 + 可选重置）、Vec3Fields（XYZ 三数字输入）、ColorField（色板 + 自定义 + 清除）、
 *           TextField、ToggleField、InspectorCard
 * [POS]: director/panels/fields 的检查器原语集：所有属性面板只用这些拼装，保证字段密度/重置/单位表现一致（清单 §4 通用）。
 *        外观规格来自获批样张（2026-09-09 导演台重设计）：分区无边框、靠 1px 分隔线断句；标签列 52px；
 *        数字框 h28 圆角描边 + ink05 底、轴名压在盒内左侧；开关是有文案的 chip 不是裸复选框；色板 22px 圆点。
 *        **改这里等于改全部检查器** —— 角色 / 机位 / 灯光 / 几何体 / 场景图层 / 时间轴七卡都只拼装这些原语。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../../utils/cn'
import { IconRefresh } from '../../../../../../vendor/tablerIcons'
import type { Vec3 } from '../../model/directorTypes'
import { CHARACTER_COLOR_PRESETS } from '../../scene/sceneTheme'
import { useNumberDraft } from './useNumberDraft'

export function InspectorCard({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  // 样张的 .sec：无边框无底色，断句交给父层 divide-y（卡里再套卡会把密度压垮）
  return <section className={cn('px-3 pb-1 pt-3', className)}>{children}</section>
}

export function SectionHeader({ title, onReset, resetLabel, resetHint }: { title: string; onReset?: () => void; resetLabel?: string; resetHint?: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-caption font-semibold text-nomi-ink-60">{title}</span>
      {onReset ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded-nomi-sm p-0.5 text-nomi-ink-30 hover:bg-workbench-hover hover:text-nomi-ink"
          title={resetHint ?? resetLabel ?? t('director.fields.reset')}
          aria-label={resetLabel ?? t('director.fields.reset')}
          onClick={onReset}
        >
          <IconRefresh size={13} stroke={2} />
        </button>
      ) : null}
    </div>
  )
}

function NumberInput({ value, onCommit, digits = 2, className }: { value: number; onCommit: (next: number) => void; digits?: number; className?: string }): JSX.Element {
  const draft = useNumberDraft(value, digits, onCommit)
  return (
    <input
      type="text"
      inputMode="decimal"
      className={cn('h-7 w-full rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-2 text-right text-body-sm tabular-nums text-nomi-ink focus:border-nomi-accent', className)}
      {...draft}
      onWheel={(event) => {
        event.preventDefault()
        const step = digits === 0 ? 1 : digits === 1 ? 0.1 : 0.01
        onCommit(Number((value + (event.deltaY < 0 ? step : -step)).toFixed(digits)))
      }}
    />
  )
}

export function Vec3Fields({ label, value, onChange, onChangeStart, digits = 2, axisLabels }: { label: string; value: Vec3; onChange: (next: Vec3) => void; onChangeStart?: () => void; digits?: number; axisLabels?: [string, string, string] }): JSX.Element {
  const labels = axisLabels ?? ['X', 'Y', 'Z']
  return (
    <div className="mb-2 flex items-center gap-2 text-caption">
      <span className="w-[52px] shrink-0 truncate text-nomi-ink-60" title={label}>{label}</span>
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <span key={axis} className="relative min-w-0 flex-1" title={labels[index]}>
          {/* 轴名压在盒内左侧（样张 .n .ax）：省掉一整列标签，三轴才塞得进 306px 宽的卡 */}
          <span className="pointer-events-none absolute left-2 top-1/2 z-[1] -translate-y-1/2 text-micro font-semibold text-nomi-ink-40">{labels[index]}</span>
          <NumberInput
            value={value[axis]}
            digits={digits}
            className="pl-[26px]"
            onCommit={(next) => {
              onChangeStart?.()
              onChange({ ...value, [axis]: next })
            }}
          />
        </span>
      ))}
    </div>
  )
}

export function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (next: string) => void }): JSX.Element {
  const [draft, setDraft] = React.useState<string | null>(null)
  return (
    <label className="mb-2 flex items-center gap-2 text-caption">
      <span className="w-[52px] shrink-0 truncate text-nomi-ink-60">{label}</span>
      <input
        type="text"
        className="h-7 min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-2 text-body-sm text-nomi-ink focus:border-nomi-accent"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() && draft !== value) onCommit(draft.trim())
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    </label>
  )
}

export function ToggleField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (next: boolean) => void; hint?: string }): JSX.Element {
  const { t } = useTranslation()
  // 样张的 chip：开 / 关写成文字。裸复选框在暗色卡上又小又读不出状态，密度也和别的字段对不齐。
  return (
    <div className="mb-2 flex items-center gap-2 text-caption" title={hint}>
      <span className="min-w-0 flex-1 truncate text-nomi-ink-60">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn(
          'h-6 shrink-0 rounded-nomi-sm px-2.5 text-caption transition-colors',
          checked ? 'bg-nomi-accent-soft font-semibold text-nomi-accent' : 'border border-nomi-line bg-nomi-ink-05 text-nomi-ink-60 hover:text-nomi-ink',
        )}
        onClick={() => onChange(!checked)}
      >
        {checked ? t('director.fields.on') : t('director.fields.off')}
      </button>
    </div>
  )
}

export function ColorField({ label, value, onChange, onChangeStart, presets, allowClear }: { label: string; value: string; onChange: (next: string) => void; onChangeStart?: () => void; presets?: ReadonlyArray<{ id: string; value: string }>; allowClear?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const swatches = presets ?? CHARACTER_COLOR_PRESETS
  const changing = React.useRef(false)
  const commit = (next: string) => {
    if (next === value) return
    onChangeStart?.()
    onChange(next)
  }
  return (
    <div className="mb-2 flex items-start gap-2 text-caption">
      <span className="w-[52px] shrink-0 truncate pt-1 text-nomi-ink-60">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {swatches.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            title={t(`director.colorPreset.${swatch.id}`)}
            aria-label={t(`director.colorPreset.${swatch.id}`)}
            className={cn('size-[22px] rounded-full border border-nomi-line', value.toLowerCase() === swatch.value.toLowerCase() ? 'outline outline-2 outline-offset-2 outline-nomi-accent' : '')}
            style={{ backgroundColor: swatch.value }}
            onClick={() => commit(swatch.value)}
          />
        ))}
        <input
          type="color"
          aria-label={t('director.fields.customColor')}
          title={t('director.fields.customColor')}
          className="size-[22px] cursor-pointer rounded-full border border-nomi-line bg-transparent p-0"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onClick={() => { changing.current = false }}
          onBlur={() => { changing.current = false }}
          onChange={(event) => {
            if (!changing.current) { onChangeStart?.(); changing.current = true }
            onChange(event.target.value)
          }}
        />
        {allowClear ? (
          <button type="button" className="rounded-nomi-sm px-1 text-micro text-nomi-ink-40 hover:bg-workbench-hover hover:text-nomi-ink" onClick={() => commit('')}>
            {t('director.fields.clearColor')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
