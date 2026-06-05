import React from 'react'
import { cn } from '../../../../utils/cn'
import { formatVideoOptionLabel, type ModelParameterControl } from '../../../../config/modelCatalogMeta'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionKey,
  optionLabel,
  optionValue,
} from './parameterControlModel'

// 紧凑设置弹层（样张 v3 .pop）：**只放标量参数**（比例/清晰度/时长/音频…），**每项带标签**，往下弹、
// 不盖卡片内容。这是修复「底栏一排裸值无标签」的核心——参数从底栏移进这里，底栏只留摘要芯片。
// 视觉逐项对齐样张：pop 容器 + .selectRow + .field(label .k + 控件) + select 样式 + 音频用 .seg。

const CHEVRON_BG = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a8a29e' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
} as const

// 样张 select：appearance-none + 自绘 chevron + 紧凑内边距，按内容收宽（min-w 72）。
const selectClass = cn(
  'appearance-none font-[inherit] text-[12px] text-nomi-ink cursor-pointer',
  'bg-nomi-paper border border-nomi-line rounded-[6px] pl-2 pr-6 py-[6px] min-w-[72px]',
  'focus:border-nomi-accent outline-0',
)

type SettingsPopoverProps = {
  open: boolean
  controls: DynamicModelControl[]
  meta: Record<string, unknown>
  onParameterChange: (control: ModelParameterControl, value: string) => void
  onCatalogChange: (control: DynamicCatalogControl, value: string) => void
}

export default function SettingsPopover({ open, controls, meta, onParameterChange, onCatalogChange }: SettingsPopoverProps): JSX.Element | null {
  if (!open) return null
  return (
    <div
      className={cn(
        'generation-canvas-v2-node__settings-pop',
        // 块级面板，展开在参数卡底部（往下展开、不盖参考/描述）。样张是「浮在卡片下方的卡」——
        // 实现成卡内底部块以避开 composer overflow 裁剪；视觉仍是独立面板（顶部分隔线 + 标签字段）。
        'flex flex-col gap-[12px] p-[12px] mt-[2px] max-h-[240px] overflow-auto',
        'bg-nomi-paper border-t border-nomi-line-soft',
      )}
      role="group"
      aria-label="生成设置"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={cn('flex flex-wrap gap-x-[12px] gap-y-[8px]')}>
        {controls.map((control) => (
          <label key={control.key} className={cn('flex flex-none flex-col gap-[4px]')}>
            <span className={cn('text-[11px] leading-none text-nomi-ink-40')}>{control.label}</span>
            {renderControlInput(control, meta, onParameterChange, onCatalogChange)}
          </label>
        ))}
      </div>
    </div>
  )
}

function renderControlInput(
  control: DynamicModelControl,
  meta: Record<string, unknown>,
  onParameterChange: (control: ModelParameterControl, value: string) => void,
  onCatalogChange: (control: DynamicCatalogControl, value: string) => void,
): JSX.Element {
  if (!isParameterControl(control)) {
    return (
      <select className={selectClass} style={CHEVRON_BG} aria-label={control.label} value={catalogControlInitialValue(control, meta)} onChange={(e) => onCatalogChange(control, e.target.value)}>
        {control.options.map((option) => (
          <option key={optionKey(option)} value={optionValue(option)}>{optionLabel(option)}</option>
        ))}
      </select>
    )
  }
  // 布尔（如 generate_audio）→ 开/关 segmented（样张 .seg 的音频形态）。
  if (control.type === 'boolean') {
    const current = controlInitialValue(control, meta)
    return (
      <div className={cn('inline-flex flex-none gap-[2px] p-[2px] rounded-[6px] bg-nomi-ink-05 self-start')} role="group" aria-label={control.label}>
        {[{ v: 'true', t: '开' }, { v: 'false', t: '关' }].map((opt) => {
          const active = current === opt.v
          return (
            <button
              key={opt.v}
              type="button"
              aria-pressed={active}
              data-active={active ? 'true' : 'false'}
              className={cn(
                'rounded-[4px] px-[12px] py-[4px] text-[12px] leading-none font-[inherit] text-nomi-ink-60 cursor-pointer',
                'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink data-[active=true]:font-semibold data-[active=true]:shadow-nomi-sm',
              )}
              onClick={(e) => { e.stopPropagation(); onParameterChange(control, opt.v) }}
            >{opt.t}</button>
          )
        })}
      </div>
    )
  }
  if (control.options.length > 0) {
    return (
      <select className={selectClass} style={CHEVRON_BG} aria-label={control.label} value={controlInitialValue(control, meta)} onChange={(e) => onParameterChange(control, e.target.value)}>
        {control.options.map((option) => (
          <option key={controlValueToString(option.value)} value={controlValueToString(option.value)}>
            {formatVideoOptionLabel(option.label, option.priceLabel)}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className={cn('font-[inherit] text-[12px] text-nomi-ink bg-nomi-paper border border-nomi-line rounded-[6px] px-2 py-[6px] min-w-[72px] outline-0 focus:border-nomi-accent')}
      aria-label={control.label}
      type={control.type === 'number' ? 'number' : 'text'}
      value={controlInitialValue(control, meta)}
      min={control.min}
      max={control.max}
      step={control.step}
      placeholder={control.placeholder}
      onChange={(e) => onParameterChange(control, e.target.value)}
    />
  )
}
