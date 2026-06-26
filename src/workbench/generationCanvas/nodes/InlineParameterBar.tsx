import React from 'react'
import { Popover } from '@mantine/core'
import { IconChevronDown, IconAdjustmentsHorizontal } from '@tabler/icons-react'
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
import { useDedupedModelSelect } from '../../common/useDedupedModelSelect'

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
  /** 变体（型号）小下拉：和模型芯片并排在底栏（用户拍板）。无变体的模型传空数组 → 不显示。 */
  variantChoices?: readonly { id: string; label: string }[]
  activeVariantId?: string
  onVariantSelect?: (id: string) => void
}

// section="parameters"：底栏 = 模型芯片 + 变体 + **前 N 个最常调参数内联** +「更多」弹层（其余参数 + 供应商）。
// 主次分层（方案 B，2026-06-25 用户拍板替代旧「全摊平横排」——多供应商 Seedance 8+ 控件横排会超长/截断/换行丑）：
// 最常调的（声明序前 2，如视频=比例+清晰度）一眼可见点一下就改；不常动的（时长/种子/音频/供应商）收进「更多」。
// 永远单行、宽度恒定，再加参数也只往「更多」塞。INLINE_PARAM_MAX 是这条分层线。
const INLINE_PARAM_MAX = 2
export default function InlineParameterBar({
  modelOptions,
  modelCatalogStatus,
  renderedControls,
  selectedModelOption,
  meta,
  onModelChange,
  onCatalogControlChange,
  onParameterControlChange,
  variantChoices,
  activeVariantId,
  onVariantSelect,
}: InlineParameterBarProps): JSX.Element {
  // 去重选择 view-model（hook 必须在任何早返回前调用）。
  const modelSelect = useDedupedModelSelect(modelOptions, selectedModelOption?.value || '', onModelChange)
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
    // 自由数值/文本（无候选项）：小输入 pill（非下拉）。文本（如负向提示）给更宽输入，数值（步数/seed）窄。
    const inputWidth = control.type === 'number' ? 'w-[56px]' : 'w-[140px]'
    return (
      <label key={control.key} className={cn('inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full border border-nomi-line bg-nomi-paper min-w-0 focus-within:border-nomi-accent')}>
        <span className={cn('shrink-0 text-micro leading-none text-nomi-ink-40')}>{control.label}</span>
        <input
          className={cn('appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 min-w-0', inputWidth)}
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
  // 分层：模型/变体恒内联（身份级）；标量参数前 N 内联、其余进「更多」；供应商（设一次）进「更多」。
  const hasProvider = modelSelect.providerOptions.length > 1
  const inlineParams = renderedControls.slice(0, INLINE_PARAM_MAX)
  const moreParams = renderedControls.slice(INLINE_PARAM_MAX)
  const moreCount = moreParams.length + (hasProvider ? 1 : 0)
  return (
    <div className={cn('generation-canvas-v2-node__params--parameters', 'flex items-center gap-2 min-w-0')}>
      <NomiSelect
        ariaLabel="模型"
        placeholder="选择模型"
        triggerMaxWidth={150}
        value={modelSelect.modelValue}
        options={modelSelect.modelOptions}
        onChange={modelSelect.onModelPick}
      />
      {/* 变体（型号）小下拉：紧跟模型芯片（身份级，恒内联）。有变体的模型才显示。 */}
      {variantChoices && variantChoices.length > 1 ? (
        <NomiSelect
          ariaLabel="变体"
          leadingLabel="变体"
          value={activeVariantId || ''}
          options={variantChoices.map((v) => ({ value: v.id, label: v.label }))}
          onChange={(v) => onVariantSelect?.(v)}
        />
      ) : null}
      {/* 最常调的前 N 个参数：内联，一眼可见点一下就改 */}
      {inlineParams.map((control) => renderInlineParam(control))}
      {/* 「更多」弹层：供应商 + 其余参数。永远单行的关键——再多参数也只往这里塞。 */}
      {moreCount > 0 ? (
        <Popover position="bottom-end" offset={6} withinPortal shadow="md" radius="md">
          <Popover.Target>
            <button
              type="button"
              aria-label="更多参数"
              className={cn(
                'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-paper',
                'text-caption text-nomi-ink-80 cursor-pointer hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
              )}
            >
              <IconAdjustmentsHorizontal size={13} stroke={1.6} className="shrink-0 text-nomi-ink-40" aria-hidden />
              更多
              <IconChevronDown size={12} stroke={1.6} className="shrink-0 text-nomi-ink-40 pointer-events-none" aria-hidden />
            </button>
          </Popover.Target>
          <Popover.Dropdown
            styles={{ dropdown: { padding: 10, border: '1px solid var(--nomi-line)', borderRadius: 'var(--nomi-radius-lg)', background: 'var(--nomi-paper)', boxShadow: 'var(--workbench-shadow-pop)' } }}
          >
            <div className={cn('flex flex-col items-start gap-2 min-w-[160px]')}>
              {hasProvider ? (
                <NomiSelect
                  ariaLabel="供应商"
                  leadingLabel="供应商"
                  value={modelSelect.providerValue}
                  options={modelSelect.providerOptions}
                  onChange={modelSelect.onProviderPick}
                />
              ) : null}
              {moreParams.map((control) => renderInlineParam(control))}
            </div>
          </Popover.Dropdown>
        </Popover>
      ) : null}
    </div>
  )
}
