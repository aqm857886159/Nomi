import React from 'react'
import { cn } from '../../../utils/cn'
import { NomiSelect } from '../../../design'
import { formatVideoOptionLabel, type ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionLabel,
  optionValue,
} from './controls/parameterControlModel'
import { resolveArchetypeForOption } from './nodeModelArchetype'

type InlineParameterBarProps = {
  modelOptions: readonly ModelOption[]
  modelCatalogStatus: { message: string }
  renderedControls: DynamicModelControl[]
  selectedModelOption: ModelOption | null
  archetype: ReturnType<typeof resolveArchetypeForOption> // kept for prop compat, no longer used in render
  meta: Record<string, unknown>
  onModelChange: (value: string) => void
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
}

// section="parameters"：底栏 = 模型芯片 + 该模型**所有参数横排内联**（每个带小标签的 pill）。
// 参数不再藏进弹层——一眼可见、点一下就调；卡宽内容驱动(w-fit)，参数多则卡变宽、触上限在卡内换行。
export default function InlineParameterBar({
  modelOptions,
  modelCatalogStatus,
  renderedControls,
  selectedModelOption,
  meta,
  onModelChange,
  onCatalogControlChange,
  onParameterControlChange,
}: InlineParameterBarProps): JSX.Element {
  if (modelOptions.length === 0) {
    return (
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-nomi-accent/30',
          'bg-nomi-accent-soft text-nomi-accent font-medium text-caption',
          'hover:bg-nomi-accent hover:text-nomi-paper transition-colors cursor-pointer',
        )}
        aria-label="去配置模型"
        title="点击打开模型接入页"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')) }}
      >
        <span className="truncate">{modelCatalogStatus.message}</span>
        <span className="shrink-0">去配置 →</span>
      </button>
    )
  }
  // 内联参数：统一用 NomiSelect（设计语言一致、对勾在右）；自由数值/文本无候选项的才保留输入 pill。
  const renderInlineParam = (control: DynamicModelControl): JSX.Element => {
    if (!isParameterControl(control)) {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={catalogControlInitialValue(control, meta)}
          options={control.options.map((o) => ({ value: optionValue(o), label: optionLabel(o) }))}
          onChange={(v) => onCatalogControlChange(control, v)}
        />
      )
    }
    if (control.type === 'boolean') {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={controlInitialValue(control, meta) || 'false'}
          options={[{ value: 'true', label: '开' }, { value: 'false', label: '关' }]}
          onChange={(v) => onParameterControlChange(control, v)}
        />
      )
    }
    if (control.options.length > 0) {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={controlInitialValue(control, meta)}
          options={control.options.map((o) => ({ value: controlValueToString(o.value), label: formatVideoOptionLabel(o.label, o.priceLabel) }))}
          onChange={(v) => onParameterControlChange(control, v)}
        />
      )
    }
    // 自由数值/文本（无候选项，如步数/seed）：保留小输入 pill（非下拉）。
    return (
      <label key={control.key} className={cn('inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full border border-nomi-line bg-nomi-paper min-w-0 focus-within:border-nomi-accent')}>
        <span className={cn('shrink-0 text-micro leading-none text-nomi-ink-40')}>{control.label}</span>
        <input
          className={cn('appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 min-w-0 w-[56px]')}
          aria-label={control.label}
          type={control.type === 'number' ? 'number' : 'text'}
          value={controlInitialValue(control, meta)}
          min={control.min}
          max={control.max}
          step={control.step}
          placeholder={control.placeholder}
          onChange={(e) => onParameterControlChange(control, e.target.value)}
        />
      </label>
    )
  }
  return (
    <div className={cn('generation-canvas-v2-node__params--parameters', 'flex flex-nowrap items-center gap-2')}>
      <NomiSelect
        ariaLabel="模型"
        placeholder="选择模型"
        triggerMaxWidth={150}
        value={selectedModelOption?.value || ''}
        options={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(v) => onModelChange(v)}
      />
      {/* 该模型的标量参数：横排内联，每个带标签，全可见 */}
      {renderedControls.map((control) => renderInlineParam(control))}
    </div>
  )
}
