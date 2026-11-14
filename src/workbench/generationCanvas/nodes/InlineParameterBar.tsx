import { workspaceInputSurfaceIsActive } from '../../shortcutSurface'
import React, { type JSX } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { ICON_TIERS, NomiSelect, type NomiSelectOption } from '../../../design'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import type { ModelCatalogStatus } from '../../../config/modelCatalogStatus'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  controlDiffersFromDefault,
  isParameterControl,
  optionValue,
  parameterPlacement,
} from './controls/parameterControlModel'
import { resolveArchetypeForOption } from './nodeModelArchetype'
import { summaryFitCandidates } from './composerHeadlineSummary'
import { COMPOSER_YIELD_NONE, ComposerBarYieldContext, composerYieldLadder, modeHasIcon } from './composerBarYield'
import { useDedupedModelSelect, type ModelVariantMenu } from '../../common/useDedupedModelSelect'
import { localizeAutoOption } from './parameterOptionPresentation'
import {
  ParameterOptionGroup,
  ParameterPanelGroup,
} from './controls/ParameterControlBody'
import { AdvancedSettingsIconButton, AdvancedSettingsSection } from './controls/AdvancedSettings'
import { NodePromptToolCluster } from './NodePromptToolCluster'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'
import { resolveAnchoredPopoverPlacement } from '../../../design/anchoredPopoverPlacement'

type InlineParameterBarProps = {
  modelOptions: readonly ModelOption[]
  /** Batch surfaces can provide the shared model picker beside this bar. */
  hideModel?: boolean
  /** `status` 可选：老调用方（分镜批量等）只给 message；缺它时按「非加载中」处理，保持旧行为。 */
  modelCatalogStatus: { status?: ModelCatalogStatus; message: string }
  renderedControls: DynamicModelControl[]
  selectedModelOption: ModelOption | null
  archetype: ReturnType<typeof resolveArchetypeForOption> // kept for prop compat, no longer used in render
  meta: Record<string, unknown>
  onModelChange: (value: string, vendor?: string) => void
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
  /** 变体（型号）小下拉：和模型芯片并排在底栏（用户拍板）。无变体的模型传空数组 → 不显示。 */
  /** 这一处存得了变体就声明它：模型菜单里每个变体是自己的一行（没有单独的「变体」格）。不声明 = 每个模型一行。 */
  variantMenu?: ModelVariantMenu
  /**
   * 摘要 pill 文案覆盖。
   * 默认 pill 显示各参数**当前值**串接（`16:9 · 2k`）——这对档案模型可读：你一眼认得出比例和清晰度。
   * 但 ComfyUI 导入工作流的参数是**任意**的，值串出来是 `15 · 24`（采样步数和帧率），
   * 没人看得出那是自己导入时勾的东西
   * （群反馈 2026-08-20 G2#433「勾了功能画布里没对应按钮」——其实渲染了，只是这颗 pill 没说）。
   * 传了就用它当 pill 文案；点开的参数面板内容不受影响。
   * 2026-08-20 用户拍板，是 2026-07-17「摘要 pill」拍板形态内的一处窄例外。
  */
  summaryOverride?: string
  /**
   * 放不下就整颗换行、一个字都不截（分镜行最窄一档，E1a 的 320）：模型钮和摘要钮不设最大宽度，横排里是同一条可换行的 flex 行的成员。
   * 不传 = 原样（画布一行、贴文字宽最宽 240）。
   */
  wrap?: boolean
  /**
   * 摘要的每个整值和退让顺序（画布节点、分镜行都传，见 composerHeadlineParts）：放不下时按 dropRank 从小到大
   * 整值地退（比例 → 有声 → 清晰度 → 时长，边界样张 K4），一个值不截半截；它排在让法顺序的第 ③ 步（composerBarYield.ts）。
   * 不传 = 面板里各参数的当前值，从后往前整值地退。
   */
  summaryParts?: readonly { text: string; dropRank: number }[]
  /**
   * 视频节点底栏的「方式」一格（模型 → 变体 → 方式 → 参数）：下拉，和模型菜单同一个浮层组件、同一个方向。
   * 只在模型有两种以上方式时传；画布节点用它，不再往参数面板里传 modeChoices。
   */
  modeMenu?: { value: string; options: NomiSelectOption[]; heading: string; ariaLabel: string; onChange: (id: string) => void }
  /** Optional generation-mode group shown at the top of the shared panel (storyboard rows only). */
  modeChoices?: readonly { id: string; label: string; limitTip?: string }[]
  activeModeId?: string
  modeLabel?: string
  onModeSelect?: (id: string) => void
  /**
   * 模型下拉最前面的一项「不指定模型」（值为空串，选它 = `onModelChange('')`）。
   * 画布节点不传；分镜行传「默认模型」——分镜没选模型时落画布用默认模型，用户要能选回去。
   */
  leadingModelOption?: { label: string; description?: string; icon?: NomiSelectOption['icon'] }
  modelGroupLabels?: Record<'image' | 'video', string> | undefined
  /**
   * 面板最底下的一小段说明（分镜批量 / 多选：「哪些参数为什么没出现」）。画布节点不传。
   * 传了它，即使一个可调参数都没有，触发器也照样出现——点开才读得到「为什么没有」。
   */
  panelFooter?: React.ReactNode
  /**
   * 生成底栏（画布节点、画布列表详情、分镜行、分镜参考卡四处同一份，2026-11-14 用户「一套设计都复用」）。
   * 传了它，这个组件画整条底栏：`[模型][方式][参数] …… [提示词工具][高级设置] [数量] [走]`，
   * 「高级设置」那五类不进参数面板、在底栏下面原地展开。不传（分镜批量这类只要参数格的地方）= 只有参数格，全部参数都在面板里。
   */
  footer?: ComposerFooterSlots
}

export type ComposerFooterSlots = {
  /** 右边那排小图标（提示词预设 / 翻译 / 优化）；高级设置那颗排在它们后面。 */
  tools?: React.ReactNode
  /** 数量这类紧挨「走」钮左边的东西。 */
  trailing?: React.ReactNode
  /** 最右：「走」钮或一枚状态标签。 */
  action?: React.ReactNode
  /** 只放流式布局放不下就整颗换行（分镜行最窄一档）；画布一行不换。 */
  wrap?: boolean
  /** 宿主的走查锚点（`data-storyboard-composer-bar` 等）。 */
  attrs?: Readonly<Record<`data-${string}`, string>>
  /** 宿主给的外边距（画布卡里贴底、分镜框里留内边距）。只许间距，不许改排法。 */
  className?: string
  /** 高级设置那段展开后的高度（画布卡有高度上限，要让出这么多）。 */
  onAdvancedHeightChange?: (height: number) => void
  /** 提示词工具那组的名字（读屏）。 */
  toolsLabel?: string
}

// section="parameters"：底栏 = 模型芯片 + 变体 + **摘要 pill**：  [模型 ▾] [变体 ▾] [16:9 · 5s ▾]
//   一颗摘要 pill 报当前配置，点开是**统一参数面板**：每个参数一组「小标题 + 分段选择器」，
//   点即改、面板不关（可连改多项），比例那组每项带一个比例小图形。
//   2026-07-17 用户拍板（样张 docs/design/mockups/node-param-panel.html）。
//   2026-09-11 02:10 曾被逐参数 chip 换掉，同日 04:30 用户纠正：**节点退回原样**。逐参数 chip 那种摆法只给过
//   付费确认卡；D2（用户 2026-10-23 拍板）付费卡上不再有参数控件，那种摆法随旧卡一起删了。
// 「生成方式」（文生/图生 tab）在画布上仍住 composer 顶部，不进面板（2026-07-17 用户拍板第 2 点）。

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
  return localizeAutoOption(value, matched ? matched.label : value, autoLabel).text
}

/**
 * 把一段滚进离它最近的可滚容器的可视区（最近对齐）：下沿在外就往下滚刚好够；段比可视区还高就让顶对齐。
 * 不用 `scrollIntoView`：它连 overflow-hidden 的祖先（画布卡、画布本身）一起滚。
 */
function revealInScrollParent(el: HTMLElement): void {
  let scroller: HTMLElement | null = el.parentElement
  while (scroller) {
    const overflowY = getComputedStyle(scroller).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const box = el.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const viewTop = view.top + scroller.clientTop
  const viewBottom = viewTop + scroller.clientHeight
  if (box.bottom <= viewBottom + 0.5 && box.top >= viewTop - 0.5) return
  const delta = box.height > scroller.clientHeight ? box.top - viewTop : box.bottom > viewBottom ? box.bottom - viewBottom : box.top - viewTop
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * 没有拍板过「那几个值」的执行类（声音 / 文本 / 3D）的摘要：面板里各参数的当前值，每个值是一个整值，
 * 放不下从后往前整值地减（2026-11-14 验收条件 2：Eleven v3 曾被截成「JBFqnCBs… · … · B…」）。
 * 自由文本（音色 ID 这类）不进摘要：它在摘要里读不出意思，点开面板看全。
 */
function fallbackSummaryParts(controls: readonly DynamicModelControl[], meta: Record<string, unknown>, autoLabel: string): { text: string; dropRank: number }[] {
  const texts = controls
    .filter((control) => !(isParameterControl(control) && control.type === 'text'))
    .map((control) => summaryPart(control, meta, autoLabel))
    .filter(Boolean)
  return texts.map((text, index) => ({ text, dropRank: texts.length - index }))
}

export default function InlineParameterBar({
  modelOptions,
  hideModel = false,
  modelCatalogStatus,
  renderedControls,
  selectedModelOption,
  meta,
  onModelChange,
  onCatalogControlChange,
  onParameterControlChange,
  variantMenu,
  summaryOverride,
  wrap = false,
  summaryParts,
  modeMenu,
  modeChoices,
  activeModeId = '',
  modeLabel,
  onModeSelect,
  leadingModelOption,
  modelGroupLabels,
  panelFooter,
  footer,
}: InlineParameterBarProps): JSX.Element {
  const { t } = useTranslation()
  // 去重选择 view-model（hook 必须在任何早返回前调用）。
  const modelSelect = useDedupedModelSelect(
    modelOptions,
    selectedModelOption?.value || '',
    onModelChange,
    selectedModelOption?.vendor,
    modelGroupLabels,
    variantMenu,
  )

  // 参数去处只问一处（parameterPlacement）：有底栏时五类进「高级设置」，其余进面板；没有底栏的宿主全在面板里。
  const panelControls = footer ? renderedControls.filter((control) => parameterPlacement(control) === 'panel') : renderedControls
  const advancedControls = footer ? renderedControls.filter((control) => parameterPlacement(control) === 'advanced') : []
  const advancedChanged = advancedControls.some((control) => controlDiffersFromDefault(control, meta))
  // 开着还是收着不记：每次点开节点都是收着的（便签「没放上去的」）。
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const advancedRef = React.useRef<HTMLDivElement | null>(null)
  const onAdvancedHeightChange = footer?.onAdvancedHeightChange
  const showAdvanced = advancedOpen && advancedControls.length > 0
  React.useLayoutEffect(() => {
    if (!onAdvancedHeightChange) return
    const section = advancedRef.current
    if (!showAdvanced || !section) { onAdvancedHeightChange(0); return }
    const report = (): void => onAdvancedHeightChange(Math.ceil(section.getBoundingClientRect().height + parseFloat(getComputedStyle(section).marginTop || '0')))
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(section)
    return () => { observer.disconnect(); onAdvancedHeightChange(0) }
  }, [showAdvanced, onAdvancedHeightChange])
  // 点开高级设置那一下：展开的那段下沿在可滚容器的可视区外，就把它滚进来（最近对齐，不跳到顶；
  // 系统开了减弱动效不带动画）。2026-11-14 验收条件 1、4：最小窗列表详情里展开段在屏幕下面，以为没反应。
  // 只滚 overflow 是 auto / scroll 的容器（画布卡是 overflow-hidden，不碰；画布本身不许被程序滚动）。
  const advancedJustOpened = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!showAdvanced || !advancedJustOpened.current) return
    advancedJustOpened.current = false
    const section = advancedRef.current
    if (section) revealInScrollParent(section)
  }, [showAdvanced])

  // 摘要的每个整值：拍板过的那几个值（画布 / 分镜传 summaryParts）> 宿主给的整句 > 面板里各参数的当前值。
  const autoLabel = t('generationCommon.parameters.auto')
  const parts = summaryParts?.length
    ? summaryParts
    : summaryOverride
      ? [{ text: summaryOverride, dropRank: 0 }]
      : fallbackSummaryParts(panelControls, meta, autoLabel)
  const fullSummaryText = parts.map((part) => part.text).join(' · ')

  // ── 底栏挤的时候谁先让（composerBarYield.ts，四处同一条）：只在这里量一次，经 context 发给生成钮。 ──
  // 量法：从「什么都不让」起一级一级往上试，直到参数条里的东西不再超出参数条（布局前同步做完，不闪）。
  // 判据是底栏自己的宽（ResizeObserver 看底栏那一行），不读窗口宽。分镜最窄一档（wrap）整颗换行，不走这里。
  const fitCandidates = footer && !wrap && parts.length ? summaryFitCandidates(parts) : null
  const modeCollapsible = modeHasIcon(modeMenu?.options, modeMenu?.value)
  const ladder = footer && !wrap
    ? composerYieldLadder({ sendCollapsible: Boolean(footer.action), modeCollapsible, summaryCandidates: fitCandidates?.length ?? 1 })
    : [COMPOSER_YIELD_NONE]
  const yielding = ladder.length > 1
  const fitKey = `${ladder.length}\n${fitCandidates ? fitCandidates.join('\n') : fullSummaryText}\n${selectedModelOption?.value ?? ''}\n${modeMenu?.value ?? ''}`
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const footerRowRef = React.useRef<HTMLDivElement | null>(null)
  const [fitState, setFitState] = React.useState<{ key: string; level: number }>({ key: fitKey, level: 0 })
  const level = fitState.key === fitKey ? Math.min(fitState.level, ladder.length - 1) : 0
  const yieldStep = ladder[level] ?? COMPOSER_YIELD_NONE
  React.useLayoutEffect(() => {
    if (!yielding) return
    const bar = barRef.current
    if (!bar || level >= ladder.length - 1) return
    // 参数条里排着的东西（都不缩）超出参数条右沿 = 放不下，再让一级。
    const right = bar.getBoundingClientRect().right
    const overflow = Array.from(bar.querySelectorAll<HTMLElement>('[data-yield-item]')).some((el) => el.getBoundingClientRect().right > right + 0.5)
    if (overflow) setFitState({ key: fitKey, level: level + 1 })
    else if (fitState.key !== fitKey) setFitState({ key: fitKey, level })
    // fitState 每次 set 都是新对象：ResizeObserver 重置到第 0 级（哪怕本来就是 0）也会再量一遍。
  }, [yielding, level, ladder.length, fitKey, fitState])
  React.useLayoutEffect(() => {
    const row = footerRowRef.current
    const bar = barRef.current
    if (!yielding || !row || !bar || typeof ResizeObserver === 'undefined') return
    // 底栏那一行变宽变窄（窗口、表格列），或参数条被右边的钮挤了（生成钮变成「生成中」）：从头再量，
    // 变宽时让出去的要收回来。同步做完，画出来的已经是量好的那一级；量完宽度回到原样，不会自己再触发一轮。
    const widths = (): string => `${Math.round(row.getBoundingClientRect().width)}:${Math.round(bar.getBoundingClientRect().width)}`
    let seen = widths()
    const observer = new ResizeObserver(() => {
      const next = widths()
      if (next === seen) return
      flushSync(() => setFitState({ key: fitKey, level: 0 }))
      seen = widths()
    })
    observer.observe(row)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [fitKey, yielding])
  const fitCramped = yieldStep.modelEllipsis
  const summaryText = fitCandidates ? fitCandidates[Math.min(yieldStep.summaryIndex, fitCandidates.length - 1)] ?? fullSummaryText : fullSummaryText
  const yieldContext = React.useMemo(() => ({ sendIconOnly: yieldStep.sendIconOnly }), [yieldStep.sendIconOnly])

  // ── 参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 打开时以触发器（pill / ⚙）中心定位一次，之后绝不跟随；
  // 比例变化通过节点原子锚定保证触发器本身不动。摘要文本也在打开期间冻结，宽度不跳。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{
    left: number
    top: number
    maxHeight: number | undefined
    side: 'above' | 'below'
    /** 打开那一下先不可见地画一次、量出内容的本来高度，再定开向和限高（之后不再动）。 */
    measured: boolean
  } | null>(null)
  const [frozenSummary, setFrozenSummary] = React.useState('')
  // 触发器只有一个：那颗摘要 pill。
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  // 面板是一叠分组，一个稳定的列宽才对得齐（只有一项也一样）。
  const PANEL_W = 320
  const PANEL_GAP = 6

  const openPanel = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
    const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
    setPanelInit({ left, top: 0, maxHeight: undefined, side: 'above', measured: false })
    setFrozenSummary(summaryText)
    setPanelOpen(true)
  }
  // 开向和限高（2026-11-14 验收条件 2：Eleven v3 七项的面板顶到窗口顶、盖住顶栏、最后一项够不着）：
  // 不限高、全摊开（用户 11-14 照 LibTV）；上方放得下就开上方（底栏贴卡底），不然下方放得下开下方，
  // 两边都放不下开空间大的那边并限高、在面板里滚。可用区域是工作区（顶栏下面那块），不在壳里（实验室）就是窗口。
  // 几何和别的锚定浮层同一个函数（resolveAnchoredPopoverPlacement）。定位仅此一次。
  React.useLayoutEffect(() => {
    if (!panelOpen || !panelInit || panelInit.measured) return
    const trigger = triggerRef.current
    const scroller = panelRef.current?.firstElementChild as HTMLElement | null | undefined
    if (!trigger || !scroller) return
    const rect = trigger.getBoundingClientRect()
    const vh = window.innerHeight
    const work = trigger.closest('[data-shell-main]')?.getBoundingClientRect()
    const boundsTop = Math.max(0, work?.top ?? 0)
    const boundsBottom = Math.min(vh, work?.bottom ?? vh)
    // 面板外框 1px 描边上下各一。
    const natural = scroller.scrollHeight + 2
    const placed = resolveAnchoredPopoverPlacement(rect, { width: PANEL_W, height: natural }, 'center', PANEL_GAP, { width: window.innerWidth, height: boundsBottom - boundsTop, top: boundsTop }, 'top')
    const side: 'above' | 'below' = placed.top < rect.top ? 'above' : 'below'
    // 上方用 bottom 锚（内容变少时依然贴住触发器顶），下方用 top 锚；限高 = 那一边剩下的高度（内容变多时在面板里滚）。
    const room = side === 'above' ? rect.top - PANEL_GAP - boundsTop - 8 : boundsBottom - 8 - rect.bottom - PANEL_GAP
    setPanelInit({ left: panelInit.left, top: side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP, maxHeight: Math.max(0, room - 2), side, measured: true })
  }, [panelOpen, panelInit])
  const closePanel = React.useCallback((): void => {
    setPanelOpen(false)
    setPanelInit(null)
  }, [])

  React.useEffect(() => {
    if (!panelOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!workspaceInputSurfaceIsActive(triggerRef.current)) return
      const target = event.target as Node
      // 防御：panelRef 尚未挂上（portal 首帧/HMR 重建瞬间）时绝不误关——否则点面板内选项
      // 会被当成「点外面」把面板关掉，表现为「点击不了」。
      if (!panelRef.current) return
      if (panelRef.current.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      closePanel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!workspaceInputSurfaceIsActive(triggerRef.current)) return
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

  // 「改一个参数写到哪儿去」三件一组传下去：面板、高级设置、每个参数组共用同一份，
  // 谁也别再自己接一遍（P1）。
  const controlWiring = { meta, onCatalogControlChange, onParameterControlChange }

  /** 有底栏就把参数格放进整条底栏（四处同一份排法）；没有就只交参数格。 */
  const wrapFooter = (params: JSX.Element): JSX.Element => {
    if (!footer) return params
    const hasAdvanced = advancedControls.length > 0
    return (
      <div className={cn('flex w-full min-w-0 shrink-0 flex-col', footer.className)} {...footer.attrs}>
        <div ref={footerRowRef} data-node-composer-footer data-bar-yield-level={yielding ? String(level) : undefined} className={cn('flex w-full min-w-0 items-center gap-2', footer.wrap ? 'flex-wrap' : 'flex-nowrap')}>
          <div data-bar-segment="model-params" className="flex min-w-0 flex-1 items-center">{params}</div>
          {/* 右边那排图标：提示词工具在前，高级设置在后（画板 T：图标之间隔 2、到「走」钮隔 8）。这个方式没有那五类 → 不出这颗。 */}
          {footer.tools || hasAdvanced ? (
            <NodePromptToolCluster ariaLabel={footer.toolsLabel ?? t('generationCommon.composerBarV1.promptTools')}>
              {footer.tools}
              {hasAdvanced ? (
                <AdvancedSettingsIconButton open={showAdvanced} changed={advancedChanged} onToggle={() => { advancedJustOpened.current = !advancedOpen; setAdvancedOpen(!advancedOpen) }} />
              ) : null}
            </NodePromptToolCluster>
          ) : null}
          {footer.trailing}
          <ComposerBarYieldContext.Provider value={yieldContext}>{footer.action}</ComposerBarYieldContext.Provider>
        </div>
        {showAdvanced ? <AdvancedSettingsSection ref={advancedRef} controls={advancedControls} {...controlWiring} /> : null}
      </div>
    )
  }

  if (modelOptions.length === 0) {
    // 「还没有清单」和「清单里有但加载中」是两回事：后者画骨架，别画「无模型·配置模型」，
    // 否则点节点的瞬间会先闪一下空态再跳真实芯片（2026-10-11 走查第 4 条）。
    if (modelCatalogStatus.status === 'loading') {
      return wrapFooter(
        <span
          aria-hidden="true"
          data-model-chip-loading="true"
          className="inline-flex h-7 w-28 items-center rounded-full border border-nomi-line bg-nomi-ink-05 animate-pulse"
        />,
      )
    }
    return wrapFooter(
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-nomi-line',
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
      </button>,
    )
  }

  // 控件长什么样住在 `controls/ParameterControlBody.tsx`（R9：这个文件只留编排）。

  const hasProvider = modelSelect.providerOptions.length > 1
  // 触发器只在**里面真有东西**时出现：参数、供应商、生成方式一件都没有的模型，
  // 留一颗点开是空白的触发器比不留更糟。
  const hasPanel = panelControls.length > 0 || hasProvider || Boolean(modeChoices?.length && onModeSelect) || Boolean(panelFooter)
  const renderParameterPanel = (): JSX.Element => {
    // 只有一项也是同一块面板（带小标题、320 宽）：2026-09-11 那条「单参数直出」的贴字宽窄条
    // （可灵编辑只剩一列比例，68 宽、没有标题，2026-11-13 验收报告）随这一版全摊开删掉。
    const content = (
      <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-nomi-lg p-3')} style={{ maxHeight: panelInit?.maxHeight }}>
        {modeChoices?.length && onModeSelect ? (
          <div className="flex flex-col gap-1.5" data-agent-generation-mode="true">
            <div className="text-micro font-semibold leading-none text-nomi-ink-40">
              {modeLabel || t('generationCommon.parameters.generationMode')}
            </div>
            <ParameterOptionGroup
              ariaLabel={modeLabel || t('generationCommon.parameters.generationMode')}
              value={activeModeId}
              rawOptions={modeChoices.map((choice) => ({ value: choice.id, text: choice.label, ...(choice.limitTip ? { hint: choice.limitTip } : {}) }))}
              onChange={onModeSelect}
            />
          </div>
        ) : null}
        {/* 全部参数都在这里（摘要 pill 只是读，不占走任何一个）。 */}
        {panelControls.map((control) => (
          <ParameterPanelGroup key={control.key} control={control} {...controlWiring} />
        ))}
        {hasProvider ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-micro font-semibold leading-none text-nomi-ink-40">
              {t('generationCommon.parameters.provider')}
            </div>
            <ParameterOptionGroup
              ariaLabel={t('generationCommon.parameters.provider')}
              value={modelSelect.providerValue}
              rawOptions={modelSelect.providerOptions.map((o) => ({ value: o.value, text: o.label }))}
              onChange={modelSelect.onProviderPick}
              requestedPurpose="provider"
            />
          </div>
        ) : null}
        {panelFooter ? <div className="border-t border-nomi-line-soft pt-2 text-micro text-nomi-ink-40" data-parameter-panel-footer="true">{panelFooter}</div> : null}
      </div>
    )
    return (
      <div
        ref={panelRef}
        role="group"
        aria-label={t('generationCommon.parameters.panel')}
        data-agent-parameter-panel="true"
        className="nokey fixed rounded-nomi-lg border border-nomi-line bg-nomi-paper"
        style={{
          zIndex: 600,
          left: panelInit?.left,
          ...(panelInit?.measured ? {} : { visibility: 'hidden' as const }),
          ...(panelInit?.side === 'above' && panelInit.measured ? { bottom: panelInit.top } : { top: panelInit?.top }),
          width: PANEL_W,
          boxShadow: 'var(--workbench-shadow-pop)',
        }}
      >
        {content}
      </div>
    )
  }

  // 分镜行最窄一档（wrap）放不下就整颗换行，身份两枚不缩——模型是这一行的一等决策（§1.5.4）。
  // 有底栏（四处）时谁让由让法那一级说了算（composerBarYield.ts）：让到最后一级之前模型、方式、摘要都不缩，
  // 最后一级模型名才末尾省略（title 是全名）。变体是短枚举，从不缩（2026-09-21 走查：「Variant 5.0」被压成「Variant E」）。
  // 没有底栏的（实验室里只要参数格的地方）照旧：模型那枚让位、摘要最宽 240。
  const modelChipClass = wrap || (yielding && !fitCramped) ? 'shrink-0' : undefined
  const identityRow = (
    // 判据：参数条一行里相邻两颗控件不许相压（`tests/ux/design-lab-ask-card-in-panel.walk.mjs` 的重叠断言，原样保留、照跑）。
    <div data-yield-item className={cn('flex items-center gap-1.5', yielding && !fitCramped ? 'shrink-0' : 'min-w-0')}>
      {!hideModel ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.model')}
          placeholder={t('generationCommon.parameters.selectModel')}
          triggerMaxWidth={wrap ? 260 : 200}
          className={modelChipClass}
          value={modelSelect.modelValue}
          options={leadingModelOption ? [{ value: '', ...leadingModelOption }, ...modelSelect.modelOptions] : modelSelect.modelOptions}
          onChange={(id) => (id || !leadingModelOption ? modelSelect.onModelPick(id) : onModelChange(''))}
          onChipChange={modelSelect.onModelProviderPick}
          footerAction={modelSelect.visibilityFooter}
        />
      ) : null}
      {modeMenu ? (
        <NomiSelect
          ariaLabel={modeMenu.ariaLabel}
          heading={modeMenu.heading}
          className="shrink-0"
          value={modeMenu.value}
          options={modeMenu.options}
          onChange={modeMenu.onChange}
          triggerIconOnly={yieldStep.modeIconOnly}
        />
      ) : null}
    </div>
  )

  /** 触发器：一颗报当前配置的摘要 pill，点开是参数面板。 */
  const summaryTrigger = hasPanel ? (
    <button
      ref={triggerRef}
      type="button"
      // 走查锚点：断言得能拿到那串摘要本身，
      // 不能靠中文 aria-label 去找（换个语言就断了）。
      data-parameter-summary={pillText}
      data-yield-item
      aria-label={t('generationCommon.parameters.generationParameters')}
      aria-expanded={panelOpen}
      title={(fitCandidates ? fullSummaryText : pillText) || t('generationCommon.parameters.generationParameters')}
      data-parameter-summary-cramped={fitCandidates && fitCramped ? 'true' : undefined}
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      className={cn(
        'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-ink-05',
        // 整值地退的摘要不缩（放不下就少一个值）；没有底栏的照旧最宽 240、可收。
        fitCandidates || wrap ? 'shrink-0' : 'shrink',
        'justify-between text-caption text-nomi-ink-80 cursor-pointer min-w-0',
        'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-ink-40',
      )}
      style={fitCandidates || wrap ? undefined : { maxWidth: 240 }}
    >
      <span className="min-w-0 truncate" style={{ maxWidth: wrap || fitCandidates ? 'none' : 240 }}>
        {pillText || t('generationCommon.parameters.parameters')}
      </span>
      <IconChevronDown
        size={ICON_TIERS.corner.size}
        stroke={ICON_TIERS.corner.stroke}
        className={cn(
          'shrink-0 text-nomi-ink-40 pointer-events-none transition-transform',
          panelOpen && 'rotate-180',
        )}
        aria-hidden
      />
    </button>
  ) : null

  // 静止浮层：portal 到 body，打开时定位一次、之后不跟随。
  const panelPortal = panelOpen && panelInit ? createPortal(renderParameterPanel(), document.body) : null

  const bar = (
    <div
      ref={barRef}
      className={cn(
        'generation-canvas-v2-node__params--parameters',
        'min-w-0',
        // 分镜行最窄一档（wrap）放不下就整颗换行；其余一行（画布节点长相不变）。
        cn('flex items-center', wrap ? 'flex-wrap gap-2' : 'gap-1.5'),
        // 让法要知道「还剩多宽」：参数条吃满这一段，摘要槽吃满身份几格之后的剩余。
        yielding && 'flex-1',
      )}
    >
      <div className="contents">{identityRow}</div>
      {summaryTrigger && yielding ? (
        <div data-parameter-summary-slot="true" className={cn('relative flex items-center', fitCramped ? 'flex-none' : 'min-w-0 flex-1')}>
          {summaryTrigger}
          {panelPortal}
        </div>
      ) : summaryTrigger ? (
        <div className="min-w-0 contents">
          {summaryTrigger}
          {panelPortal}
        </div>
      ) : null}
    </div>
  )
  // 这一次读目录失败、但上一份清单还在屏上：说清楚「仍是旧的」和原因（只在这个状态多一行，平时 DOM 不变）。
  if (modelCatalogStatus.status !== 'stale_kept') return wrapFooter(bar)
  return wrapFooter(
    <div className="flex min-w-0 flex-col gap-1">
      {bar}
      <span role="status" data-model-catalog-stale="true" title={modelCatalogStatus.message} className="min-w-0 break-words text-micro text-nomi-warning">
        {modelCatalogStatus.message}
      </span>
    </div>,
  )
}
