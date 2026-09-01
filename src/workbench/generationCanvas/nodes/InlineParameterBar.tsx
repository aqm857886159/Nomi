import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Slider } from '@mantine/core'
import { IconAspectRatio, IconChevronDown } from '@tabler/icons-react'
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
import { hasUsableSliderStep, isCompleteNumericDraft } from './controls/numericDraft'
import { commonRatioSortKey } from './aspectRatio'
import { resolveArchetypeForOption } from './nodeModelArchetype'
import { useDedupedModelSelect } from '../../common/useDedupedModelSelect'
import {
  localizeAutoOption,
  parameterOptionLayout,
  resolveParameterOptionPurpose,
  type ParameterOptionPurpose,
} from './parameterOptionPresentation'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'

export type InlineParameterBarLayout = 'inline' | 'stacked'
export type InlineParameterBarPanelMode = 'portal' | 'inline'

type InlineParameterBarProps = {
  modelOptions: readonly ModelOption[]
  modelCatalogStatus: { message: string }
  renderedControls: DynamicModelControl[]
  selectedModelOption: ModelOption | null
  archetype: ReturnType<typeof resolveArchetypeForOption> // kept for prop compat, no longer used in render
  meta: Record<string, unknown>
  onModelChange: (value: string, vendor?: string) => void
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
  /** 变体（型号）小下拉：和模型芯片并排在底栏（用户拍板）。无变体的模型传空数组 → 不显示。 */
  variantChoices?: readonly { id: string; label: string }[]
  activeVariantId?: string
  onVariantSelect?: (id: string) => void
  /**
   * 摘要 pill 文案覆盖。默认 pill 显示各参数**当前值**串接（`16:9 · 2k`）——
   * 这对档案模型可读：你一眼认得出比例和清晰度。但 ComfyUI 导入工作流的参数是**任意**的，
   * 值串出来是 `15 · 24`（采样步数和帧率），没人看得出那是自己导入时勾的东西
   * （群反馈 2026-08-20 G2#433「勾了功能画布里没对应按钮」——其实渲染了，只是这颗 pill 没说）。
   * 传了就用它当 pill 文案；点开的参数面板内容不受影响。
   * 2026-08-20 用户拍板，是 2026-07-17「摘要 pill」拍板形态内的一处窄例外。
  */
  summaryOverride?: string
  /**
   * Chat surfaces use the same controls as the canvas, but stack the identity
   * row and the parameter summary so a narrow resident panel never creates a
   * second horizontal form. Canvas keeps the historical inline layout.
   */
  layout?: InlineParameterBarLayout
  /**
   * The canvas uses an anchored portal. A resident proposal opens the very
   * same panel in place so it cannot detach from the card while the transcript
   * scrolls.
   */
  panelMode?: InlineParameterBarPanelMode
  /** Width of the summary trigger in CSS pixels. The resident contract uses
   * the wider 150px dialog pill; the canvas remains 110px. */
  summaryWidth?: number
  /** Optional generation-mode group shown at the top of the shared panel. */
  modeChoices?: readonly { id: string; label: string }[]
  activeModeId?: string
  modeLabel?: string
  onModeSelect?: (id: string) => void
}

// section="parameters"：底栏 = 模型芯片 + 变体 + **摘要 pill**（当前参数一句话）。
// 点摘要 pill 弹**统一参数面板**：每个参数一组「小标题 + 分段选择器」，点即改、面板不关（可连改多项）。
// 2026-07-17 用户拍板（样张 docs/design/mockups/node-param-panel.html），替代旧「前 2 内联 + 更多弹层」
// 方案 B——参数多时内联下拉挤、分层线武断；摘要 pill 让当前配置一眼读完、面板给全部参数同一交互。
// 「生成方式」（文生/图生 tab）保持在 composer 顶部不进面板（用户拍板第 2 点）。

/**
 * 面板里的自由输入行（无候选项、无可用区间的参数）。
 *
 * 数字参数必须带草稿缓冲：这个框是受控的，每次击键都回写 meta。而输 `0.4` 要途经 `0.`，
 * 它按 HTML 规范不是合法浮点数、`input.value` 读出来是空串——于是那一键把 null 写进了节点 meta，
 * 也就写进了生成请求参数。（显示不受影响：type="number" 会保留用户键入的原文，坏的是写出去的值。）
 * 所以聚焦期间显示本地草稿，只在草稿构成完整数值时才提交；失焦时若仍是中间态就丢弃草稿回到已提交值。
 * 文本参数没有这个问题，逐键提交即可。
 */
function ParameterTextInput({
  control,
  value,
  onCommit,
}: {
  control: ModelParameterControl
  value: string
  onCommit: (value: string) => void
}): JSX.Element {
  const label = translateModelDisplayText(control.label)
  const isNumeric = control.type === 'number'
  const [draft, setDraft] = React.useState<string | null>(null)

  const handleChange = (next: string): void => {
    if (!isNumeric) {
      onCommit(next)
      return
    }
    setDraft(next)
    if (isCompleteNumericDraft(next)) onCommit(next)
  }

  return (
    <label
      className={cn(
        'flex items-center gap-2 px-2.5 rounded-nomi border border-nomi-line min-w-0 focus-within:border-nomi-accent',
      )}
      style={{ height: 28 }}
    >
      <input
        className={cn(
          'flex-1 appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 min-w-0',
        )}
        aria-label={label}
        type={isNumeric ? 'number' : 'text'}
        value={draft ?? value}
        min={control.min}
        max={control.max}
        step={control.step}
        placeholder={control.placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}

/** 比例文本（"16:9"）→ 宽高比小图形（描边矩形，最长边 18px）。
 *  value 和 label 都试（图片模型 size 值常是像素 "1024x1024"，label 才是 "16:9"——只看 value 会漏画）。 */
function ratioShape(isAuto: boolean, ...candidates: string[]): JSX.Element | null {
  if (isAuto) return <IconAspectRatio aria-hidden size={18} stroke={1.6} />
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
      <span className="flex items-center justify-center" style={{ height: 18 }} aria-hidden>
        {shape}
      </span>
      <span className="leading-none">{text}</span>
    </>
  )
}

/** 摘要 pill 的单参数短文本：当前值的纯 label（不带价签）。boolean=开显示参数名/关跳过；空值跳过。 */
function summaryPart(control: DynamicModelControl, meta: Record<string, unknown>, autoLabel: string): string {
  if (!isParameterControl(control)) {
    const value = catalogControlInitialValue(control, meta)
    const matched = control.options.find((o) => optionValue(o) === value)
    const label = matched ? (typeof matched === 'string' ? matched : matched.label) : value
    return localizeAutoOption(value, label, autoLabel).text
  }
  if (control.type === 'boolean') {
    return (controlInitialValue(control, meta) || 'false') === 'true'
      ? translateModelDisplayText(control.label)
      : ''
  }
  const value = controlInitialValue(control, meta)
  if (!value) return ''
  const matched = control.options.find((o) => controlValueToString(o.value) === value)
  const label = matched ? matched.label : value.length > 8 ? `${value.slice(0, 8)}…` : value
  return localizeAutoOption(value, label, autoLabel).text
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
  summaryOverride,
  layout = 'inline',
  panelMode = 'portal',
  summaryWidth,
  modeChoices,
  activeModeId = '',
  modeLabel,
  onModeSelect,
}: InlineParameterBarProps): JSX.Element {
  const { t } = useTranslation()
  // 去重选择 view-model（hook 必须在任何早返回前调用）。
  const modelSelect = useDedupedModelSelect(
    modelOptions,
    selectedModelOption?.value || '',
    onModelChange,
    selectedModelOption?.vendor,
  )

  // 摘要 pill 文本：各参数当前值串接（16:9 · 1080p · 5 · 音频）。
  const summaryText = summaryOverride || renderedControls
    .map((c) => summaryPart(c, meta, t('generationCommon.parameters.auto')))
    .filter(Boolean)
    .join(' · ')

  // ── 参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 打开时以 pill 中心定位一次，之后绝不跟随；比例变化通过节点原子锚定保证 pill 本身不动。
  // 摘要文本也在打开期间冻结，触发器与浮层都不需要用户追着鼠标找。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{
    left: number
    top: number
    maxHeight: number
    side: 'above' | 'below'
  } | null>(null)
  const [frozenSummary, setFrozenSummary] = React.useState('')
  const pillRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const PANEL_W = 320
  const PANEL_GAP = 6

  const openPanel = (): void => {
    if (panelMode === 'inline') {
      setFrozenSummary(summaryText)
      setPanelOpen(true)
      return
    }
    const rect = pillRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
    const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
    const spaceAbove = rect.top - 12
    // 翻向此刻锁定：上方优先（底栏贴卡底），上方不足 240px 才放下方。定位仅此一次。
    const side: 'above' | 'below' = spaceAbove >= 240 ? 'above' : 'below'
    const maxHeight = side === 'above' ? Math.min(420, spaceAbove) : Math.min(420, Math.max(160, vh - rect.bottom - 18))
    // above 用 bottom 锚（面板实高小于 maxHeight 时依然贴住 pill 顶）；below 用 top 锚。
    const top = side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP
    setPanelInit({ left, top, maxHeight, side })
    setFrozenSummary(summaryText)
    setPanelOpen(true)
  }
  const closePanel = React.useCallback((): void => {
    setPanelOpen(false)
    setPanelInit(null)
  }, [])

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
      // Let the inner combobox consume Escape first; the next Escape closes this panel.
      if (event.target instanceof Element && event.target.closest('[data-nomi-select-dropdown], [data-mantine-stop-propagation="true"]')) return
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
        aria-label={t('generationCommon.parameters.configureModel')}
        title={t('generationCommon.parameters.openModelCatalog')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
        }}
      >
        <span className="truncate">{modelCatalogStatus.message}</span>
        <span className="shrink-0">{t('generationCommon.parameters.configure')}</span>
      </button>
    )
  }

  // 分段组（组级图形对齐）：先解析每项图形，任一有 → 整组统一双行等高（无图形项留空占位），
  // 全无 → 纯文字单行。修「有/无图形混排项目高低参差」（2026-07-17 用户截图）。
  // 比例组按常用序重排（16:9、9:16 领头，auto 类恒最前，未知保声明序殿后——用户拍板）。
  const renderOptions = (
    label: string,
    value: string,
    rawOptions: { value: string; text: string }[],
    onChange: (value: string) => void,
    requestedPurpose: ParameterOptionPurpose = 'generic',
  ): JSX.Element => {
    const purpose = resolveParameterOptionPurpose(rawOptions, requestedPurpose)
    let entries = rawOptions.map((option) => {
      const localized = localizeAutoOption(
        option.value,
        translateModelDisplayText(option.text),
        t('generationCommon.parameters.auto'),
      )
      return {
        ...localized,
        shape: purpose === 'aspect-ratio'
          ? ratioShape(localized.isAuto, localized.value, localized.text)
          : null,
      }
    })
    if (parameterOptionLayout(entries, purpose) === 'select') {
      return (
        <NomiSelect
          ariaLabel={label}
          value={value}
          options={entries.map((entry) => ({ value: entry.value, label: entry.text }))}
          onChange={onChange}
          searchable
          portalTarget={panelRef}
          className="w-full justify-between"
        />
      )
    }
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
        density="compact"
        onChange={onChange}
      />
    )
  }

  // 面板参数组：少量短候选 → 分段；长/多候选 → 搜索列表；其余控件保持原交互。
  const renderPanelGroup = (control: DynamicModelControl): JSX.Element => {
    const label = translateModelDisplayText(control.label)
    // boolean → Switch 行（label 左、开关右，2026-07-17 用户拍板）；组标题即行标题，不再另起。
    if (isParameterControl(control) && control.type === 'boolean') {
      const on = (controlInitialValue(control, meta) || 'false') === 'true'
      return (
        <div key={control.key} className="flex items-center justify-between gap-2" style={{ minHeight: 26 }}>
          <div className="text-micro font-semibold leading-none text-nomi-ink-40">{label}</div>
          <DesignSwitch
            size="sm"
            color="var(--nomi-accent)"
            aria-label={label}
            checked={on}
            onChange={(e) => onParameterControlChange(control, e.currentTarget.checked ? 'true' : 'false')}
          />
        </div>
      )
    }
    const body = ((): JSX.Element => {
      if (!isParameterControl(control)) {
        return renderOptions(
          label,
          catalogControlInitialValue(control, meta),
          control.options.map((o) => ({ value: optionValue(o), text: optionLabel(o) })),
          (v) => onCatalogControlChange(control, v),
        )
      }
      if (control.options.length > 0) {
        return renderOptions(
          label,
          controlInitialValue(control, meta),
          control.options.map((o) => ({
            value: controlValueToString(o.value),
            text: formatVideoOptionLabel(o.label, o.priceLabel),
          })),
          (v) => onParameterControlChange(control, v),
        )
      }
      // 数值 + min/max（时长秒数这类连续档）→ 滑杆 + 当前值（2026-07-17 用户拍板）。
      // 但步长切不出两档以上的区间（如未声明步长的 0–1）滑杆等于废掉，退回下面的数字框。
      if (
        control.type === 'number'
        && typeof control.min === 'number'
        && typeof control.max === 'number'
        && hasUsableSliderStep(control.min, control.max, control.step)
      ) {
        const current = Number(controlInitialValue(control, meta))
        const value = Number.isFinite(current) ? current : control.min
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Slider
              className="flex-1 min-w-0"
              aria-label={label}
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
            <span className="shrink-0 text-right text-caption text-nomi-ink-80 tabular-nums" style={{ minWidth: 28 }}>
              {value}
            </span>
          </div>
        )
      }
      // 自由数值/文本（无候选项、无范围）：面板内输入行。
      return (
        <ParameterTextInput
          control={control}
          value={controlInitialValue(control, meta)}
          onCommit={(v) => onParameterControlChange(control, v)}
        />
      )
    })()
    return (
      <div key={control.key} className="flex flex-col gap-1.5" data-agent-parameter-control={control.key}>
        <div className="text-micro font-semibold leading-none text-nomi-ink-40">{label}</div>
        {body}
      </div>
    )
  }

  const hasProvider = modelSelect.providerOptions.length > 1
  const hasPanel = renderedControls.length > 0 || hasProvider
  // Catalog variants keep separate exact IDs; media archetype variants keep their existing parameter contract.
  // Both use the same approved variant control next to the family/model chip.
  const catalogVariants = modelSelect.variantOptions.length > 0
  const visibleVariants = catalogVariants
    ? modelSelect.variantOptions
    : (variantChoices || []).map((variant) => ({ value: variant.id, label: variant.label }))

  const renderParameterPanel = (surface: 'portal' | 'inline'): JSX.Element => {
    const content = (
      <div className="flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-nomi-lg p-3" style={{ maxHeight: surface === 'portal' ? panelInit?.maxHeight : 320 }}>
        {modeChoices?.length && onModeSelect ? (
          <div className="flex flex-col gap-1.5" data-agent-generation-mode="true">
            <div className="text-micro font-semibold leading-none text-nomi-ink-40">
              {modeLabel || t('generationCommon.parameters.generationMode')}
            </div>
            {renderOptions(
              modeLabel || t('generationCommon.parameters.generationMode'),
              activeModeId,
              modeChoices.map((choice) => ({ value: choice.id, text: choice.label })),
              onModeSelect,
            )}
          </div>
        ) : null}
        {renderedControls.map((control) => renderPanelGroup(control))}
        {hasProvider ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-micro font-semibold leading-none text-nomi-ink-40">
              {t('generationCommon.parameters.provider')}
            </div>
            {renderOptions(
              t('generationCommon.parameters.provider'),
              modelSelect.providerValue,
              modelSelect.providerOptions.map((o) => ({ value: o.value, text: o.label })),
              modelSelect.onProviderPick,
              'provider',
            )}
          </div>
        ) : null}
      </div>
    )
    if (surface === 'inline') {
      return (
        <div
          ref={panelRef}
          role="group"
          aria-label={t('generationCommon.parameters.panel')}
          data-agent-parameter-panel="true"
          className="w-full rounded-nomi-lg border border-nomi-line bg-nomi-paper"
          style={{ boxShadow: 'var(--workbench-shadow-pop)' }}
        >
          {content}
        </div>
      )
    }
    return (
      <div
        ref={panelRef}
        role="group"
        aria-label={t('generationCommon.parameters.panel')}
        data-agent-parameter-panel="true"
        className="fixed rounded-nomi-lg border border-nomi-line bg-nomi-paper"
        style={{
          zIndex: 600,
          left: panelInit?.left,
          ...(panelInit?.side === 'above' ? { bottom: panelInit.top } : { top: panelInit?.top }),
          width: PANEL_W,
          boxShadow: 'var(--workbench-shadow-pop)',
        }}
      >
        {content}
      </div>
    )
  }

  const stacked = layout === 'stacked'
  const resolvedSummaryWidth = summaryWidth ?? (stacked ? 150 : 110)
  const identityRow = (
    <div className={cn('flex min-w-0 items-center gap-2', stacked && 'w-full')}>
      <NomiSelect
        ariaLabel={t('generationCommon.parameters.model')}
        placeholder={t('generationCommon.parameters.selectModel')}
        triggerMaxWidth={stacked ? 132 : 150}
        value={modelSelect.modelValue}
        options={modelSelect.modelOptions}
        onChange={modelSelect.onModelPick}
      />
      {/* 变体（型号）小下拉：紧跟模型芯片（身份级，恒内联）。有变体的模型才显示。 */}
      {catalogVariants || visibleVariants.length > 1 ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.variant')}
          leadingLabel={t('generationCommon.parameters.variant')}
          value={catalogVariants ? modelSelect.variantValue : activeVariantId || ''}
          options={visibleVariants}
          disabled={visibleVariants.length < 2}
          onChange={catalogVariants ? modelSelect.onVariantPick : (v) => onVariantSelect?.(v)}
        />
      ) : null}
    </div>
  )

  const summaryTrigger = hasPanel ? (
    <button
      ref={pillRef}
      type="button"
      aria-label={t('generationCommon.parameters.generationParameters')}
      aria-expanded={panelOpen}
      title={pillText || t('generationCommon.parameters.generationParameters')}
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      className={cn(
        'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-ink-05',
        'shrink-0 justify-between text-caption text-nomi-ink-80 cursor-pointer min-w-0',
        'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
        stacked && 'w-full',
      )}
      style={{ width: stacked ? '100%' : resolvedSummaryWidth }}
    >
      <span className="min-w-0 truncate" style={{ maxWidth: stacked ? 'calc(100% - 18px)' : 240 }}>
        {pillText || t('generationCommon.parameters.parameters')}
      </span>
      <IconChevronDown
        size={12}
        stroke={1.6}
        className={cn(
          'shrink-0 text-nomi-ink-40 pointer-events-none transition-transform',
          panelOpen && 'rotate-180',
        )}
        aria-hidden
      />
    </button>
  ) : null

  return (
    <div className={cn('generation-canvas-v2-node__params--parameters', 'min-w-0', stacked ? 'flex flex-col items-stretch gap-1.5' : 'flex items-center gap-2')}>
      {stacked ? identityRow : <div className="contents">{identityRow}</div>}
      {summaryTrigger ? (
        <div className={cn('min-w-0', stacked ? 'w-full' : 'contents')}>
          {summaryTrigger}
          {panelOpen && panelMode === 'inline' ? <div className="mt-1.5 w-full">{renderParameterPanel('inline')}</div> : null}
          {panelOpen && panelMode === 'portal' && panelInit ? createPortal(renderParameterPanel('portal'), document.body) : null}
        </div>
      ) : null}
    </div>
  )
}
