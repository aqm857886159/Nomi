// 参数控件本体的渲染层 —— **面板、单参数直出、付费卡 ⚙ 面板共用这一处**。
//
// 这里只回答一件事：「一个参数在摊开的面上长什么样」。
// 谁来打开这块面、面里还摆不摆供应商/生成方式、pill 上印什么 —— 那些是编排，
// 住在 `../InlineParameterBar.tsx`；把两件事写在一个文件里，就是 2026-09-11 那次
// 885 行巨壳的来处（R9）。
//
// **面板里没有下拉这条路**（2026-09-11 13:00 用户真机拍板）：三种摆法都是摊开的可点项，
// 选哪一种由 `parameterOptionLayout` 从**选项本身**判（几个 / 标签多长），不点名任何参数。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Slider } from '@mantine/core'
import { cn } from '../../../../utils/cn'
import { DesignSearchInput, DesignSwitch, NomiSegmented, type NomiSegmentedOption } from '../../../../design'
import { formatVideoOptionLabel, type ModelParameterControl } from '../../../../config/modelCatalogMeta'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionLabel,
  optionValue,
} from './parameterControlModel'
import { hasUsableSliderStep, isCompleteNumericDraft } from './numericDraft'
import { commonRatioSortKey } from '../aspectRatio'
import { ratioShape, shapedGroupLabel } from '../aspectRatioShape'
import {
  localizeAutoOption,
  parameterOptionLayout,
  resolveParameterOptionPurpose,
  type ParameterOptionPurpose,
} from '../parameterOptionPresentation'
import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'

/**
 * 改一个参数要写到哪儿去 —— 三件一组随控件一起传，避免每个渲染组件各自长一份签名。
 * `meta` 是节点当前值的真相源（读），两个 onChange 是唯一的写口。
 */
export type ParameterControlWiring = {
  meta: Record<string, unknown>
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
}

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

/**
 * 长枚举的「默认就展开」列表：搜索框 + 一列可点项（当前值高亮）。
 *
 * 它替掉的是面板里那颗下拉。**换的不是外观，是步数**：面板本身已经是用户点开的那一次结果，
 * 里面再套一个要点开的下拉，改一个参数就成了「pill → 面板 → 下拉 → 列表 → 选」四步
 * （2026-09-11 13:00 用户真机反馈「点好几次」）。摊开之后是两步。
 *
 * 搜索框在这里的职责是**缩短**这条列表（导入工作流的模型文件名能有几十条），不是藏起它——
 * 所以它不自动抢焦点：用户多半是来点一下就走的，抢焦点会把键盘从画布上偷走。
 */
function ParameterOptionList({
  ariaLabel,
  value,
  entries,
  onChange,
}: {
  ariaLabel: string
  value: string
  entries: readonly { value: string; text: string }[]
  onChange: (value: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const needle = query.trim().toLocaleLowerCase()
  // 当前值恒在列表里：搜索把它过滤掉之后，「当前选的是哪个」就没有任何地方还说得出来了。
  const visible = needle
    ? entries.filter((entry) => entry.text.toLocaleLowerCase().includes(needle) || entry.value === value)
    : entries
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-parameter-option-list="true">
      <DesignSearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('common.searchOptions')}
        ariaLabel={t('common.searchOptions')}
        className="w-full"
      />
      {visible.length === 0 ? (
        <div className="px-2 py-1.5 text-caption text-nomi-ink-40">{t('common.noMatchingOptions')}</div>
      ) : (
        <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'max-h-[220px] overflow-y-auto overscroll-contain')}>
          <NomiSegmented
            ariaLabel={ariaLabel}
            value={value}
            options={visible.map((entry) => ({ value: entry.value, label: entry.text, title: entry.text }))}
            density="compact"
            fit="column"
            onChange={onChange}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 一组摊开的选项（分段组 / 一列可点项 / 搜索列表）——面板里唯一的「选一个值」渲染。
 *
 * 分段组走组级图形对齐：先解析每项图形，任一有 → 整组统一双行等高（无图形项留空占位），
 * 全无 → 纯文字单行。修「有/无图形混排项目高低参差」（2026-07-17 用户截图）。
 * 比例组按常用序重排（16:9、9:16 领头，auto 类恒最前，未知保声明序殿后——用户拍板）。
 */
export function ParameterOptionGroup({
  ariaLabel,
  value,
  rawOptions,
  onChange,
  requestedPurpose = 'generic',
}: {
  ariaLabel: string
  value: string
  rawOptions: { value: string; text: string }[]
  onChange: (value: string) => void
  requestedPurpose?: ParameterOptionPurpose
}): JSX.Element {
  const { t } = useTranslation()
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
  const optionLayout = parameterOptionLayout(entries, purpose)
  if (optionLayout === 'searchable-list') {
    // 长枚举（导入工作流的模型文件名这类）也**默认就展开**：搜索框是用来缩短这条列表的，
    // 不是用来把它藏起来的。
    return (
      <ParameterOptionList
        ariaLabel={ariaLabel}
        value={value}
        entries={entries.map((entry) => ({ value: entry.value, text: entry.text }))}
        onChange={onChange}
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
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      // 双行组无需再撑最小高：每项都带 18px 图形槽（含空占位）→ 内容自然等高。
      density="compact"
      fit={optionLayout === 'chips-column' ? 'column' : 'fill'}
      onChange={onChange}
    />
  )
}

/**
 * 控件本体（一组摊开的选项 / 滑杆 / 输入框）——**面板与「单参数直出」共用这一处**。
 * 差的只有外面套不套那行小标题；给单参数另写一套渲染就是并行版（P1）。
 *
 * `onPicked` 只有单参数直出那条路会传：那时这组选项就是弹出来的全部内容，选完即关（共 2 步）。
 * 面板里**不传**——面板的价值正是「一次打开连改多项」，选一下就关掉等于把它变回下拉。
 */
/**
 * 连续数值滑杆（时长秒数这类）。拖动期间只改本地显示，松手 / 方向键改完（Mantine `onChangeEnd`）才提交一次：
 * 每一步都写画布状态会让整张图的订阅者跟着重渲、还多一步撤销（2026-09-25 画布跟手实测：32 个视频时每步约 40 ms）。
 */
function ParameterSlider({ label, value, min, max, step, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = React.useState<number | null>(null)
  const shown = draft ?? value
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Slider
        className="flex-1 min-w-0"
        thumbLabel={label}
        value={shown}
        min={min}
        max={max}
        step={step}
        label={null}
        onChange={setDraft}
        onChangeEnd={(next) => {
          setDraft(null)
          if (next !== value) onCommit(next)
        }}
        styles={{
          track: { '--slider-track-bg': 'var(--nomi-ink-10)' },
          bar: { background: 'var(--nomi-accent)' },
          thumb: { borderColor: 'var(--nomi-accent)', background: 'var(--nomi-paper)' },
        }}
      />
      <span className="shrink-0 text-right text-caption text-nomi-ink-80 tabular-nums" style={{ minWidth: 28 }}>
        {shown}
      </span>
    </div>
  )
}

export function ParameterControlBody({
  control,
  meta,
  onCatalogControlChange,
  onParameterControlChange,
  onPicked,
}: ParameterControlWiring & {
  control: DynamicModelControl
  onPicked?: () => void
}): JSX.Element {
  const label = translateModelDisplayText(control.label)
  const pick = (commit: (value: string) => void) => (value: string): void => {
    commit(value)
    onPicked?.()
  }
  if (!isParameterControl(control)) {
    return (
      <ParameterOptionGroup
        ariaLabel={label}
        value={catalogControlInitialValue(control, meta)}
        rawOptions={control.options.map((o) => ({ value: optionValue(o), text: optionLabel(o) }))}
        onChange={pick((v) => onCatalogControlChange(control, v))}
      />
    )
  }
  if (control.options.length > 0) {
    return (
      <ParameterOptionGroup
        ariaLabel={label}
        value={controlInitialValue(control, meta)}
        rawOptions={control.options.map((o) => ({
          value: controlValueToString(o.value),
          text: formatVideoOptionLabel(o.label, o.priceLabel),
        }))}
        onChange={pick((v) => onParameterControlChange(control, v))}
      />
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
      <ParameterSlider
        label={label}
        value={value}
        min={control.min}
        max={control.max}
        step={control.step || 1}
        onCommit={(v) => onParameterControlChange(control, String(v))}
      />
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
}

/** 面板参数组 = 小标题 + 控件本体。 */
export function ParameterPanelGroup({
  control,
  meta,
  onCatalogControlChange,
  onParameterControlChange,
}: ParameterControlWiring & { control: DynamicModelControl }): JSX.Element {
  const label = translateModelDisplayText(control.label)
  // boolean → Switch 行（label 左、开关右，2026-07-17 用户拍板）；组标题即行标题，不再另起。
  if (isParameterControl(control) && control.type === 'boolean') {
    const on = (controlInitialValue(control, meta) || 'false') === 'true'
    return (
      <div className="flex items-center justify-between gap-2" style={{ minHeight: 26 }}>
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
  return (
    <div className="flex flex-col gap-1.5" data-agent-parameter-control={control.key}>
      <div className="text-micro font-semibold leading-none text-nomi-ink-40">{label}</div>
      <ParameterControlBody
        control={control}
        meta={meta}
        onCatalogControlChange={onCatalogControlChange}
        onParameterControlChange={onParameterControlChange}
      />
    </div>
  )
}
