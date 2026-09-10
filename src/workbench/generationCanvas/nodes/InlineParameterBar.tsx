import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Slider } from '@mantine/core'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignSwitch, NomiSegmented, NomiSelect, WorkbenchIconButton, type NomiSegmentedOption } from '../../../design'
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
import {
  overflowParameterControls,
  parameterChipLabel,
  parameterChipOptions,
  parameterChipValue,
  planParameterChips,
  splitPrimaryParameterControls,
} from './primaryParameterChips'
import { useFittedChipCount } from './useFittedChipCount'
import { hasUsableSliderStep, isCompleteNumericDraft } from './controls/numericDraft'
import { commonRatioSortKey } from './aspectRatio'
import { ratioShape, shapedGroupLabel } from './aspectRatioShape'
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
  /** Optional generation-mode group shown at the top of the shared panel. */
  modeChoices?: readonly { id: string; label: string }[]
  activeModeId?: string
  modeLabel?: string
  onModeSelect?: (id: string) => void
}

// section="parameters"：底栏 = 模型芯片 + 变体 + **每个主参数一颗下拉 chip** + 一颗 ⚙（长尾参数）。
//   [模型 ▾] [变体 ▾] [16:9 ▾] [5s ▾] [1080p ▾] [⚙]
//
// 2026-09-11 02:10 用户拍板方案 B，替代 2026-07-17 起的「摘要 pill + 统一面板」。
// 换掉它的理由只有一条：**要改一个参数得点两次**（先点 pill 开面板、再在面板里选），
// 而比例 / 时长 / 清晰度正是每次生成前都要确认的那几个——摘要 pill 让人看得见、却够不着。
// chip 化之后看得见的那个值本身就是可点的控件，一步到位；代价是底栏变长，因此有退位规则（见下）。
//
// 哪几个参数变 chip **由模型档案 derive**（`splitPrimaryParameterControls`，判据写在那个文件里），
// 不在这里点名任何模型或键：档案里没声明比例，就不出比例 chip，不补默认值假装有。
// 长尾（种子 / 生成音频 / 水印 / 负向提示词…）、供应商、生成方式仍在同一块面板里，收在 ⚙ 后面。
// 「生成方式」（文生/图生 tab）在画布上仍住 composer 顶部，不进面板（2026-07-17 用户拍板第 2 点）。

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
  layout = 'inline',
  panelMode = 'portal',
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

  // ── 底栏摆哪几颗 chip ──
  // 「哪几个是主参数」的判据全在 primaryParameterChips.ts（从档案 derive）；
  // 「这一行装不装得下」是**量出来的**（useFittedChipCount 读真实盒子），不在这里估宽度。
  const { primary } = splitPrimaryParameterControls(renderedControls)
  const stacked = layout === 'stacked'
  const barRef = React.useRef<HTMLDivElement | null>(null)
  // 竖排（窄面板）本来就允许换行，用不着退位；横排底栏不许换行，装不下就退回 ⚙。
  const fittedCount = useFittedChipCount(barRef, primary.length, { enabled: !stacked })
  const { chips } = planParameterChips(primary, stacked ? primary.length : fittedCount)
  const panelControls = overflowParameterControls(renderedControls, chips)

  // ── 长尾参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 打开时以 ⚙ 中心定位一次，之后绝不跟随；比例变化通过节点原子锚定保证 ⚙ 本身不动。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{
    left: number
    top: number
    maxHeight: number
    side: 'above' | 'below'
  } | null>(null)
  const moreRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const PANEL_W = 320
  const PANEL_GAP = 6

  const openPanel = (): void => {
    if (panelMode === 'inline') {
      setPanelOpen(true)
      return
    }
    const rect = moreRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
    const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
    const spaceAbove = rect.top - 12
    // 翻向此刻锁定：上方优先（底栏贴卡底），上方不足 240px 才放下方。定位仅此一次。
    const side: 'above' | 'below' = spaceAbove >= 240 ? 'above' : 'below'
    const maxHeight = side === 'above' ? Math.min(420, spaceAbove) : Math.min(420, Math.max(160, vh - rect.bottom - 18))
    // above 用 bottom 锚（面板实高小于 maxHeight 时依然贴住 ⚙ 顶）；below 用 top 锚。
    const top = side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP
    setPanelInit({ left, top, maxHeight, side })
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
      if (moreRef.current?.contains(target)) return
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
  // ⚙ 只在**里面真有东西**时出现：长尾参数、供应商、生成方式一件都没有的模型（参数全上了 chip），
  // 留一颗点开是空白的齿轮比不留更糟。
  const hasPanel = panelControls.length > 0 || hasProvider || Boolean(modeChoices?.length && onModeSelect)
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
        {/* 只放**没上底栏**的那些：上了 chip 的参数在这里再出现一次，就是同一个值两个家（§1.5.2）。 */}
        {panelControls.map((control) => renderPanelGroup(control))}
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

  // 横排底栏里身份两枚**不缩**：模型名本身已由 triggerMaxWidth 截到 150px，再让它跟着挤，
  // 结果是「宽度不够时模型名先被榨没、chip 却一颗不少」——而模型是这一行的一等决策（§1.5.4）。
  // 不缩也是「装不下」这件事能被量出来的前提：所有成员都不缩，行才会真的溢出（见 useFittedChipCount）。
  const identityChipClass = stacked ? undefined : 'shrink-0'
  const identityRow = (
    <div className={cn('flex min-w-0 items-center gap-2', stacked && 'w-full')}>
      <NomiSelect
        ariaLabel={t('generationCommon.parameters.model')}
        placeholder={t('generationCommon.parameters.selectModel')}
        triggerMaxWidth={stacked ? 132 : 150}
        className={identityChipClass}
        value={modelSelect.modelValue}
        options={modelSelect.modelOptions}
        onChange={modelSelect.onModelPick}
        onChipChange={modelSelect.onModelProviderPick}
      />
      {/* 变体（型号）小下拉：紧跟模型芯片（身份级，恒内联）。有变体的模型才显示。 */}
      {catalogVariants || visibleVariants.length > 1 ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.variant')}
          leadingLabel={t('generationCommon.parameters.variant')}
          className={identityChipClass}
          value={catalogVariants ? modelSelect.variantValue : activeVariantId || ''}
          options={visibleVariants}
          disabled={visibleVariants.length < 2}
          onChange={catalogVariants ? modelSelect.onVariantPick : (v) => onVariantSelect?.(v)}
        />
      ) : null}
    </div>
  )

  /**
   * 一个主参数 = 一颗下拉 chip。chip 上**只印当前值**（`16:9`、`5s`、`1080p`）不印参数名——
   * 这三个值本身就读得懂，印上「比例 16:9」是把同一件事说两遍、还多占一格宽。
   * 参数名没有丢：它是 chip 的 `aria-label` 与 hover 的 `title`（读屏与鼠标各拿一份）。
   */
  const renderChip = (control: DynamicModelControl): JSX.Element => {
    const label = translateModelDisplayText(control.label)
    const value = parameterChipValue(control, meta)
    const options = parameterChipOptions(control).map((option) => {
      const localized = localizeAutoOption(
        option.value,
        translateModelDisplayText(option.label),
        t('generationCommon.parameters.auto'),
      )
      return {
        value: localized.value,
        label: parameterChipLabel(control, localized.text, (seconds) => t('generationCommon.composerBarV1.seconds', { value: seconds })),
      }
    })
    // 比例按常用序重排（16:9 / 9:16 领头，自动恒最前）——与面板里那组分段同一把尺子
    // （`commonRatioSortKey`），换成下拉不等于换一套顺序。
    const purpose = resolveParameterOptionPurpose(options.map((option) => ({ value: option.value, text: option.label })))
    const sorted = purpose === 'aspect-ratio'
      ? [...options].sort((a, b) => commonRatioSortKey(a.value, a.label) - commonRatioSortKey(b.value, b.label))
      : options
    const current = sorted.find((option) => option.value === value)
    return (
      <span
        key={control.key}
        className="inline-flex shrink-0"
        // 走查锚点：靠 key 找 chip、靠 value 断言选完真的写进了 store。
        // 不靠中文 aria-label 去找（换个语言就断了）。
        data-parameter-chip={control.key}
        data-parameter-chip-value={value}
      >
        <NomiSelect
          ariaLabel={label}
          title={`${label} · ${current?.label ?? value}`}
          value={value}
          options={sorted}
          onChange={(next) => (isParameterControl(control)
            ? onParameterControlChange(control, next)
            : onCatalogControlChange(control, next))}
        />
      </span>
    )
  }

  const moreTrigger = hasPanel ? (
    <WorkbenchIconButton
      ref={moreRef}
      size="sm"
      className="shrink-0"
      icon={<IconAdjustmentsHorizontal aria-hidden />}
      // 数字是有行动价值的：它说明齿轮后面**确实还有东西**（导入的 ComfyUI 工作流参数全在这里，
      // 群反馈 2026-08-20 G2#433 要的就是「勾过的功能到底在不在」这句话）。
      label={t('generationCommon.parameters.moreParameters', { count: panelControls.length })}
      aria-expanded={panelOpen}
      data-parameter-more="true"
      onClick={() => (panelOpen ? closePanel() : openPanel())}
    />
  ) : null

  return (
    <div
      ref={barRef}
      className={cn(
        'generation-canvas-v2-node__params--parameters',
        'min-w-0',
        stacked ? 'flex flex-col items-stretch gap-1.5' : 'flex items-center gap-2',
      )}
    >
      {stacked ? identityRow : <div className="contents">{identityRow}</div>}
      {/* 横排：chip 与 ⚙ 直接排在模型芯片后面（`contents` 让它们成为同一条 flex 行的成员，
          好让底栏「单行不换行」这条断言量得到）。竖排（窄面板）自己成一行并允许换行。 */}
      <div className={cn(stacked ? 'flex w-full flex-wrap items-center gap-1.5' : 'contents')}>
        {chips.map((control) => renderChip(control))}
        {moreTrigger}
      </div>
      {panelOpen && panelMode === 'inline' ? <div className="mt-1.5 w-full">{renderParameterPanel('inline')}</div> : null}
      {panelOpen && panelMode === 'portal' && panelInit ? createPortal(renderParameterPanel('portal'), document.body) : null}
    </div>
  )
}
