import React from 'react'
import { createPortal } from 'react-dom'
import { Slider } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignSwitch, NomiSegmented, NomiSelect, type NomiSegmentedOption } from '../../../design'
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
import { commonRatioSortKey } from './aspectRatio'
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
  /** 参数面板开/合通知：composer 据此在打开期间冻结自身位置（调参时两个框都不许动，2026-07-17）。 */
  onParamPanelOpenChange?: (open: boolean) => void
}

// section="parameters"：底栏 = 模型芯片 + 变体 + **摘要 pill**（当前参数一句话）。
// 点摘要 pill 弹**统一参数面板**：每个参数一组「小标题 + 分段选择器」，点即改、面板不关（可连改多项）。
// 2026-07-17 用户拍板（样张 docs/design/mockups/node-param-panel.html），替代旧「前 2 内联 + 更多弹层」
// 方案 B——参数多时内联下拉挤、分层线武断；摘要 pill 让当前配置一眼读完、面板给全部参数同一交互。
// 「生成方式」（文生/图生 tab）保持在 composer 顶部不进面板（用户拍板第 2 点）。

/** 比例文本（"16:9"）→ 宽高比小图形（描边矩形，最长边 18px）。
 *  value 和 label 都试（图片模型 size 值常是像素 "1024x1024"，label 才是 "16:9"——只看 value 会漏画）。 */
function ratioShape(...candidates: string[]): JSX.Element | null {
  for (const candidate of candidates) {
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(String(candidate || '').trim())
    if (!m) continue
    const w = Number(m[1])
    const h = Number(m[2])
    if (!w || !h) continue
    const scale = 18 / Math.max(w, h)
    return (
      <span
        aria-hidden
        className="block"
        // 描边用 inline style 而非 Tailwind 任意值类（border-[1.4px]）：dev 的 tailwind 生成缓存
        // 可能缺新任意值类 → 描边宽 0 图形隐身（2026-07-17 用户 dev 实况）。inline 不依赖生成。
        style={{
          width: Math.max(6, Math.round(w * scale)),
          height: Math.max(6, Math.round(h * scale)),
          border: '1.4px solid currentColor',
        }}
      />
    )
  }
  return null
}

/** 组级双行 label：图形槽（固定 18px 高，无图形项留空占位）+ 文字——跨项等高，文字基线对齐。
 *  只要组内任一项画得出图形，整组统一双行（此前有/无图形混排 → 项目高低参差，2026-07-17 用户截图）。
 *  槽高 inline style（不用 h-[18px] 任意值类——dev tailwind 缓存缺类会静默塌）。 */
function shapedGroupLabel(text: string, shape: JSX.Element | null): React.ReactNode {
  return (
    <>
      <span className="flex items-center justify-center" style={{ height: 18 }} aria-hidden>{shape}</span>
      <span className="leading-none">{text}</span>
    </>
  )
}

/** 摘要 pill 的单参数短文本：当前值的纯 label（不带价签）。boolean=开显示参数名/关跳过；空值跳过。 */
function summaryPart(control: DynamicModelControl, meta: Record<string, unknown>): string {
  if (!isParameterControl(control)) {
    const value = catalogControlInitialValue(control, meta)
    const matched = control.options.find((o) => optionValue(o) === value)
    if (!matched) return value
    return typeof matched === 'string' ? (matched || '自动') : matched.label
  }
  if (control.type === 'boolean') {
    return (controlInitialValue(control, meta) || 'false') === 'true' ? control.label : ''
  }
  const value = controlInitialValue(control, meta)
  if (!value) return ''
  const matched = control.options.find((o) => controlValueToString(o.value) === value)
  return matched ? matched.label : value.length > 8 ? `${value.slice(0, 8)}…` : value
}

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
  onParamPanelOpenChange,
}: InlineParameterBarProps): JSX.Element {
  // 去重选择 view-model（hook 必须在任何早返回前调用）。
  const modelSelect = useDedupedModelSelect(modelOptions, selectedModelOption?.value || '', onModelChange)

  // 摘要 pill 文本：各参数当前值串接（16:9 · 1080p · 5 · 音频）。
  const summaryText = renderedControls.map((c) => summaryPart(c, meta)).filter(Boolean).join(' · ')

  // ── 参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 三轮用户反馈的终解（2026-07-17）：调参期间**两个框（composer + 面板）都不许动**——
  // 动的源头是节点按新比例变形推着 composer 跑。现在 composer 在面板打开期间冻结自身位置
  // （经 onParamPanelOpenChange 通知，见 NodeGenerationComposer 冻结补偿），pill 不动 → 面板
  // 静止定位即天然贴合，无需跟随。打开期间摘要文本冻结（pill 宽度稳定）。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{ left: number; top: number; maxHeight: number; side: 'above' | 'below' } | null>(null)
  const [frozenSummary, setFrozenSummary] = React.useState('')
  const pillRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const PANEL_W = 320
  const PANEL_GAP = 6

  const openPanel = (): void => {
    const rect = pillRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(8, rect.left), Math.max(8, vw - PANEL_W - 8))
    const spaceAbove = rect.top - 12
    // 翻向此刻锁定：上方优先（底栏贴卡底），上方不足 240px 才放下方。定位仅此一次。
    const side: 'above' | 'below' = spaceAbove >= 240 ? 'above' : 'below'
    const maxHeight = side === 'above' ? Math.min(420, spaceAbove) : Math.min(420, Math.max(160, vh - rect.bottom - 18))
    // above 用 bottom 锚（面板实高小于 maxHeight 时依然贴住 pill 顶）；below 用 top 锚。
    const top = side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP
    setPanelInit({ left, top, maxHeight, side })
    setFrozenSummary(summaryText)
    setPanelOpen(true)
    onParamPanelOpenChange?.(true)
  }
  const closePanel = React.useCallback((): void => {
    setPanelOpen(false)
    setPanelInit(null)
    onParamPanelOpenChange?.(false)
  }, [onParamPanelOpenChange])

  // 卸载兜底：面板开着时组件被卸（节点删除/取消选中）→ 通知 composer 解除冻结。
  React.useEffect(() => () => { onParamPanelOpenChange?.(false) }, [onParamPanelOpenChange])

  React.useEffect(() => {
    if (!panelOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      // 防御：panelRef 尚未挂上（portal 首帧/HMR 重建瞬间）时绝不误关——否则点面板内选项
      // 会被当成「点外面」把面板关掉，表现为「点击不了」。
      if (!panelRef.current) return
      if (panelRef.current.contains(target)) return
      if (pillRef.current?.contains(target)) return
      closePanel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closePanel()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [panelOpen, closePanel])

  // 面板打开期间 pill 文本冻结（宽度稳定）；关闭后回到实时值。
  const pillText = panelOpen ? frozenSummary : summaryText

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

  // 分段组（组级图形对齐）：先解析每项图形，任一有 → 整组统一双行等高（无图形项留空占位），
  // 全无 → 纯文字单行。修「有/无图形混排项目高低参差」（2026-07-17 用户截图）。
  // 比例组按常用序重排（16:9、9:16 领头，auto 类恒最前，未知保声明序殿后——用户拍板）。
  const renderSegmented = (
    label: string,
    value: string,
    rawOptions: { value: string; text: string }[],
    onChange: (value: string) => void,
  ): JSX.Element => {
    let entries = rawOptions.map((o) => ({ ...o, shape: ratioShape(o.value, o.text) }))
    const anyShape = entries.some((e) => e.shape)
    if (anyShape) {
      // Array.sort 稳定：同键项保持声明相对序。
      entries = [...entries].sort((a, b) => commonRatioSortKey(a.value, a.text) - commonRatioSortKey(b.value, b.text))
    }
    const options: NomiSegmentedOption[] = entries.map((o) => ({
      value: o.value,
      label: anyShape ? shapedGroupLabel(o.text, o.shape) : o.text,
      title: o.text,
    }))
    return (
      <NomiSegmented
        ariaLabel={label}
        value={value}
        options={options}
        // 双行组无需再撑最小高：每项都带 18px 图形槽（含空占位）→ 内容自然等高。
        onChange={onChange}
      />
    )
  }

  // 面板参数组：候选项 → 分段；boolean → Switch；数值带 min/max → 滑杆；其余自由数值/文本 → 输入行。
  const renderPanelGroup = (control: DynamicModelControl): JSX.Element => {
    // boolean → Switch 行（label 左、开关右，2026-07-17 用户拍板）；组标题即行标题，不再另起。
    if (isParameterControl(control) && control.type === 'boolean') {
      const on = (controlInitialValue(control, meta) || 'false') === 'true'
      return (
        <div key={control.key} className="flex items-center justify-between gap-2" style={{ minHeight: 26 }}>
          <div className="text-micro font-semibold leading-none text-nomi-ink-40">{control.label}</div>
          <DesignSwitch
            size="sm"
            color="var(--nomi-accent)"
            aria-label={control.label}
            checked={on}
            onChange={(e) => onParameterControlChange(control, e.currentTarget.checked ? 'true' : 'false')}
          />
        </div>
      )
    }
    const body = ((): JSX.Element => {
      if (!isParameterControl(control)) {
        return renderSegmented(
          control.label,
          catalogControlInitialValue(control, meta),
          control.options.map((o) => ({ value: optionValue(o), text: optionLabel(o) })),
          (v) => onCatalogControlChange(control, v),
        )
      }
      if (control.options.length > 0) {
        return renderSegmented(
          control.label,
          controlInitialValue(control, meta),
          control.options.map((o) => ({
            value: controlValueToString(o.value),
            text: formatVideoOptionLabel(o.label, o.priceLabel),
          })),
          (v) => onParameterControlChange(control, v),
        )
      }
      // 数值 + min/max（时长秒数这类连续档）→ 滑杆 + 当前值（2026-07-17 用户拍板）。
      if (control.type === 'number' && typeof control.min === 'number' && typeof control.max === 'number') {
        const current = Number(controlInitialValue(control, meta))
        const value = Number.isFinite(current) ? current : control.min
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Slider
              className="flex-1 min-w-0"
              aria-label={control.label}
              value={value}
              min={control.min}
              max={control.max}
              step={control.step || 1}
              label={null}
              onChange={(v) => onParameterControlChange(control, String(v))}
              styles={{
                track: { '--slider-track-bg': 'var(--nomi-ink-10)' },
                bar: { background: 'var(--nomi-accent)' },
                thumb: { borderColor: 'var(--nomi-accent)', background: 'var(--nomi-paper)' },
              }}
            />
            <span className="shrink-0 text-right text-caption text-nomi-ink-80 tabular-nums" style={{ minWidth: 28 }}>{value}</span>
          </div>
        )
      }
      // 自由数值/文本（无候选项、无范围）：面板内输入行。
      return (
        <label className={cn('flex items-center gap-2 px-2.5 rounded-nomi border border-nomi-line min-w-0 focus-within:border-nomi-accent')} style={{ height: 30 }}>
          <input
            className={cn('flex-1 appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 min-w-0')}
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
    })()
    return (
      <div key={control.key} className="flex flex-col gap-1.5">
        <div className="text-micro font-semibold leading-none text-nomi-ink-40">{control.label}</div>
        {body}
      </div>
    )
  }

  const hasProvider = modelSelect.providerOptions.length > 1
  const hasPanel = renderedControls.length > 0 || hasProvider

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
      {/* 摘要 pill：当前参数一句话，点开统一参数面板。 */}
      {hasPanel ? (
        <>
          <button
            ref={pillRef}
            type="button"
            aria-label="生成参数"
            aria-expanded={panelOpen}
            title={pillText || '生成参数'}
            onClick={() => (panelOpen ? closePanel() : openPanel())}
            className={cn(
              'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-ink-05',
              'text-caption text-nomi-ink-80 cursor-pointer min-w-0',
              'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
            )}
          >
            <span className="min-w-0 truncate" style={{ maxWidth: 240 }}>{pillText || '参数'}</span>
            <IconChevronDown size={12} stroke={1.6} className={cn('shrink-0 text-nomi-ink-40 pointer-events-none transition-transform', panelOpen && 'rotate-180')} aria-hidden />
          </button>
          {/* 静止浮层（非 Popover）：打开定位一次绝不跟随——composer 已在打开期间冻结（两框皆不动）。 */}
          {panelOpen && panelInit
            ? createPortal(
                <div
                  ref={panelRef}
                  role="group"
                  aria-label="生成参数面板"
                  // zIndex/尺寸全走 inline：z-[600] 这类新任意值类在 dev 的 tailwind 缓存里可能不存在
                  // → z 失效面板被透明层截胡「点击不了」（2026-07-17 用户 dev 实况，与图形隐身同根）。
                  className="fixed flex flex-col gap-3 overflow-y-auto rounded-nomi-lg border border-nomi-line bg-nomi-paper p-3"
                  style={{
                    zIndex: 600,
                    left: panelInit.left,
                    ...(panelInit.side === 'above' ? { bottom: panelInit.top } : { top: panelInit.top }),
                    width: PANEL_W,
                    maxHeight: panelInit.maxHeight,
                    boxShadow: 'var(--workbench-shadow-pop)',
                  }}
                >
                  {renderedControls.map((control) => renderPanelGroup(control))}
                  {hasProvider ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="text-micro font-semibold leading-none text-nomi-ink-40">供应商</div>
                      <NomiSegmented
                        ariaLabel="供应商"
                        value={modelSelect.providerValue}
                        options={modelSelect.providerOptions.map((o) => ({ value: o.value, label: o.label }))}
                        onChange={modelSelect.onProviderPick}
                      />
                    </div>
                  ) : null}
                </div>,
                document.body,
              )
            : null}
        </>
      ) : null}
    </div>
  )
}
