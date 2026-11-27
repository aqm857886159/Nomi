import { shouldReduceMotion } from '../../../design/motion'
import { workspaceInputSurfaceIsActive } from '../../shortcutSurface'
import React, { type JSX } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import {
  ICON_TIERS,
  NomiSelect,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  type NomiSelectOption,
} from '../../../design'
import { openApimartConnect } from '../../../ui/onboarding/apimartConnectRoute'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import type { ModelCatalogStatus } from '../../../config/modelCatalogStatus'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  controlDiffersFromDefault,
  parameterPlacement,
} from './controls/parameterControlModel'
import { resolveArchetypeForOption } from './nodeModelArchetype'
import { fallbackSummaryParts, summaryFitCandidates } from './composerHeadlineSummary'
import { nomiSelectTriggerText } from '../../../design/NomiSelect'
import { ComposerSendButton, COMPOSER_SEND_FRAME } from './ComposerSendButton'
import { COMPOSER_YIELD_NONE, ComposerBarYieldContext, composerYieldPick, modeHasIcon, sameComposerYieldStep, type ComposerYieldStep } from './composerBarYield'
import { useDedupedModelSelect, type ModelVariantMenu } from '../../common/useDedupedModelSelect'
import {
  ParameterOptionGroup,
  ParameterPanelGroup,
} from './controls/ParameterControlBody'
import { AdvancedSettingsIconButton, AdvancedSettingsSection } from './controls/AdvancedSettings'
import { NodePromptToolCluster } from './NodePromptToolCluster'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'
import { resolveAnchoredPopoverPlacement } from '../../../design/anchoredPopoverPlacement'

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
  const reduce = shouldReduceMotion()
  scroller.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}

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
   * 摘要格最前面的图标（图层分离那一格的叠层图标，板 2026-11-26-layer-split · layers.composer-cell）。
   * 有它，让法在摘要整值退完之后再多一档「只剩图标」（裁定 C-E5），悬停 / 读屏给全文。不传 = 原样。
   */
  summaryIcon?: React.ReactNode
  /**
   * 没有面板可开时（层数写死的模型：一个可调参数都没有），摘要照样摆成一格、不带 ▾、点不开（layers.pro-fixed）。
   * 不传 = 原样（没有面板就不出这一格）。
   */
  summaryStatic?: boolean
  /** 宿主给面板里某一项下面挂一句（按控件 key）：如图层分离层数多时的花钱提醒，只提醒不拦。 */
  controlNotices?: Readonly<Record<string, React.ReactNode>>
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
  /** 最右的生成钮只交数据，唯一实例由底栏画。状态标签放 trailing。 */
  send?: React.ComponentProps<typeof ComposerSendButton>
  /** 未连模型时最右「连接模型」主按钮的悬停说明（O1a-canvas entry.composer-connect）。 */
  connectTooltip?: string
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
  summaryIcon,
  summaryStatic = false,
  controlNotices,
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

  // ── 底栏挤的时候谁留下（composerBarYield.ts 的重要性清单，四处同一条）：只在这里量一次，经 context 发给生成钮。 ──
  // 候选宽由原件加减纯文字与外框推得；关闭的影子根不承载控件身份。
  // 摘要格带图标时，整值退完还能再退一档：只剩图标（空串 = 只画图标，悬停 / 读屏给全文）。
  const fitCandidates = footer && !wrap && parts.length ? [...summaryFitCandidates(parts), ...(summaryIcon ? [''] : [])] : null
  const emptySummaryText = summaryIcon ? '' : t('generationCommon.parameters.parameters')
  const modeCollapsible = modeHasIcon(modeMenu?.options, modeMenu?.value)
  const sendCollapsible = Boolean(footer?.send?.label)
  const summaryCandidates = fitCandidates?.length ?? 1
  const yielding = Boolean(footer && !wrap && modelOptions.length > 0)
  const footerRowRef = React.useRef<HTMLDivElement | null>(null)
  const rulerRef = React.useRef<HTMLDivElement | null>(null)
  const rulerRoot = React.useRef<ShadowRoot | null>(null)
  const [fitStep, setFitStep] = React.useState<ComposerYieldStep>(COMPOSER_YIELD_NONE)
  // 清单里没有的件（这只底栏的钮没字、方式没图标、摘要档数变少）不算让。
  const yieldStep: ComposerYieldStep = yielding ? {
    sendIconOnly: sendCollapsible && fitStep.sendIconOnly,
    modeIconOnly: modeCollapsible && fitStep.modeIconOnly,
    summaryIndex: Math.min(fitStep.summaryIndex, summaryCandidates - 1),
    modelEllipsis: fitStep.modelEllipsis,
  } : COMPOSER_YIELD_NONE
  React.useLayoutEffect(() => {
    const row = footerRowRef.current
    const host = rulerRef.current
    if (!yielding || !row || !host) return
    const identity = row.querySelector<HTMLElement>('[data-yield-item]')
    const summary = row.querySelector<HTMLElement>('[data-parameter-summary]')
    if (!identity) return
    const selects = identity.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')
    const model = hideModel ? null : selects[0]
    const mode = modeMenu ? selects[hideModel ? 0 : 1] : null
    const send = row.querySelector<HTMLElement>('[data-send-cost-group]') ?? row.querySelector<HTMLElement>('[data-bar-segment="generate"]')
    const fixed = Array.from(row.children).filter((el): el is HTMLElement => el instanceof HTMLElement
      && el.getAttribute('data-bar-segment') !== 'model-params' && !el.hasAttribute('data-yield-action'))
    if (rulerRoot.current?.host !== host) rulerRoot.current = host.attachShadow({ mode: 'closed' })
    const root = rulerRoot.current
    const texts = [
      ...(fitCandidates ?? [fullSummaryText]).map(text => text || emptySummaryText),
      modeMenu ? nomiSelectTriggerText(modeMenu.options.find(option => option.value === modeMenu.value), modeMenu.value, t('common.select')) : '',
      footer?.send?.label ? footer.send.busy ? t('storyboardEditor.frame.generating') : footer.send.label : '',
    ]
    const spans = texts.map((text, index) => {
      const span = document.createElement('span')
      span.textContent = text
      span.style.display = 'block'
      span.style.width = 'max-content'
      span.style.whiteSpace = 'pre'
      span.style.fontWeight = index === texts.length - 1 ? 'inherit' : getComputedStyle(summary ?? identity).fontWeight
      return span
    })
    root.replaceChildren(...spans)
    const fit = (): void => {
      const style = getComputedStyle(row)
      const available = parseFloat(style.width)
      const scale = row.getBoundingClientRect().width / available
      if (!scale) return
      const width = (el: Element | null | undefined): number => el ? el.getBoundingClientRect().width / scale : 0
      // 排版占的宽 = 画出来的宽 + 左右外边距（约价胶囊 `-mr-0.5` 往右探出 2px，不占行宽）。
      const occupied = (el: Element | null | undefined): number => {
        if (!el) return 0
        const style = getComputedStyle(el)
        return width(el) + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0)
      }
      const gap = (el: Element): number => parseFloat(getComputedStyle(el).columnGap) || 0
      const modelText = model?.querySelector<HTMLElement>('span.truncate')
      // 只还原末级挤掉的文字；保留模型控件本来的 maxWidth。
      const hiddenModel = modelText && yieldStep.modelEllipsis
        ? Math.min(modelText.scrollWidth, parseFloat(getComputedStyle(modelText).maxWidth) || Infinity) - modelText.clientWidth
        : 0
      const modeDelta = mode ? width(spans[texts.length - 2]) + gap(mode) : 0
      const fullIdentity = width(identity) + hiddenModel + (yieldStep.modeIconOnly ? modeDelta : 0)
      const summaryFrame = summary ? width(summary) - width(spans[yieldStep.summaryIndex]) : 0
      const extra = fixed.reduce((sum, el) => sum + occupied(el), 0) + gap(row) * (fixed.length + (send ? 1 : 0))
      const paramGap = summary ? gap(identity.parentElement!.parentElement!) : 0
      const next = composerYieldPick({
        sendCollapsible,
        modeCollapsible,
        summaryCandidates,
        fits: (step) => fullIdentity - (step.modeIconOnly ? modeDelta : 0)
          + (summary ? summaryFrame + width(spans[step.summaryIndex]) + paramGap : 0)
          + (sendCollapsible ? step.sendIconOnly ? COMPOSER_SEND_FRAME.icon : width(spans[texts.length - 1]) + COMPOSER_SEND_FRAME.label : occupied(send))
          + extra <= available + 0.5,
      })
      setFitStep((previous) => (sameComposerYieldStep(previous, next) ? previous : next))
    }
    fit()
    const observer = new ResizeObserver(() => flushSync(fit))
    for (const el of [row, identity, model, mode, summary, send, ...fixed, ...spans]) if (el) observer.observe(el)
    return () => observer.disconnect()
  })
  const fitCramped = yieldStep.modelEllipsis
  const summaryText = fitCandidates ? fitCandidates[Math.min(yieldStep.summaryIndex, fitCandidates.length - 1)] ?? fullSummaryText : fullSummaryText
  const yieldContext = React.useMemo(() => ({ sendIconOnly: yieldStep.sendIconOnly }), [yieldStep.sendIconOnly])

  // ── 参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 打开时以触发器（pill / ⚙）中心定位一次，之后绝不跟随；
  // 比例变化通过节点原子锚定保证触发器本身不动。摘要开着时照常跟着值变（面板不跟随，钮变宽它也不跑）。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{
    left: number
    top: number
    maxHeight: number | undefined
    side: 'above' | 'below'
    /** 打开那一下先不可见地画一次、量出内容的本来高度，再定开向和限高（之后不再动）。 */
    measured: boolean
  } | null>(null)
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


  // 「改一个参数写到哪儿去」三件一组传下去：面板、高级设置、每个参数组共用同一份，
  // 谁也别再自己接一遍（P1）。
  const controlWiring = { meta, onCatalogControlChange, onParameterControlChange }

  const showFooterConnect = modelOptions.length === 0 && modelCatalogStatus.status !== 'loading' && Boolean(footer?.send)

  /** 有底栏就把参数格放进整条底栏（四处同一份排法）；没有就只交参数格。 */
  const wrapFooter = (params: JSX.Element): JSX.Element => {
    if (!footer) return params
    const hasAdvanced = advancedControls.length > 0
    return (
      <div className={cn('flex w-full min-w-0 shrink-0 flex-col', footer.className)} {...footer.attrs}>
        <div ref={footerRowRef} data-node-composer-footer className={cn('flex w-full min-w-0 items-center gap-2', footer.wrap ? 'flex-wrap' : 'flex-nowrap')}>
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
          <span data-yield-action className="contents">
            {showFooterConnect ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkbenchButton
                      variant="primary"
                      className="shrink-0 rounded-pill px-3.5 font-semibold"
                      data-bar-segment="generate"
                      data-board="entry.composer-connect"
                      data-composer-connect="true"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openApimartConnect()
                      }}
                    >
                      {t('onboardingProviders.entries.connectModel')}
                    </WorkbenchButton>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" data-composer-connect-tooltip="true">
                    {footer.connectTooltip ?? t('onboardingProviders.entries.composerTooltipGeneric')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <ComposerBarYieldContext.Provider value={yieldContext}>
                {footer.send ? <ComposerSendButton {...footer.send} /> : null}
              </ComposerBarYieldContext.Provider>
            )}
          </span>
        </div>
        {yielding ? <div ref={rulerRef} aria-hidden="true" className="invisible pointer-events-none absolute left-0 top-0 text-caption font-medium" /> : null}
        {showAdvanced ? <AdvancedSettingsSection ref={advancedRef} controls={advancedControls} {...controlWiring} /> : null}
      </div>
    )
  }

  if (modelOptions.length === 0) {
    // 「还没有清单」和「清单里有但加载中」是两回事：后者画骨架，别画「未连模型 · 连接模型」，
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
      !hideModel ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.model')}
          placeholder={t('onboardingProviders.entries.modelChipEmpty')}
          triggerMaxWidth={wrap ? 260 : 200}
          className="shrink-0 text-nomi-ink-60"
          value=""
          options={modelSelect.modelOptions}
          onChange={modelSelect.onModelPick}
        />
      ) : (
        <WorkbenchButton
          size="sm"
          variant="primary"
          className="shrink-0 rounded-pill px-3 font-semibold"
          data-board="entry.composer-connect"
          data-composer-connect="true"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openApimartConnect()
          }}
        >
          {t('onboardingProviders.entries.connectModel')}
        </WorkbenchButton>
      ),
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
          <ParameterPanelGroup key={control.key} control={control} notice={controlNotices?.[control.key]} {...controlWiring} />
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
  // 有底栏（四处）时谁留下由重要性清单说了算（composerBarYield.ts）：模型名放得下就模型、方式、摘要都不缩，
  // 模型名都放不下时才末尾省略（title 是全名）。变体是短枚举，从不缩（2026-09-21 走查：「Variant 5.0」被压成「Variant E」）。
  // 没有底栏的（实验室里只要参数格的地方）照旧：模型那枚让位、摘要最宽 240。
  const modelChipClass = wrap || (yielding && !fitCramped) ? 'shrink-0' : undefined
  const identityRow = (): JSX.Element => (
    // 判据：参数条一行里相邻两颗控件不许相压（`tests/ux/design-lab-ask-card-in-panel.walk.mjs` 的重叠断言，原样保留、照跑）。
    <div data-yield-item="" className={cn('flex items-center gap-1.5', (yielding && !yieldStep.modelEllipsis) ? 'shrink-0' : 'min-w-0')}>
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

  // 没有面板可开、宿主要求照样摆一格（层数写死的模型）：静态格，样子同摘要 pill、没有 ▾、不可点。
  const staticSummary = !hasPanel && summaryStatic && parts.length > 0
  const showSummary = hasPanel || staticSummary
  const summaryIconNode = summaryIcon ? <span aria-hidden className="inline-flex shrink-0 text-nomi-ink-60">{summaryIcon}</span> : null

  /** 触发器：一颗报当前配置的摘要 pill，点开是参数面板。 */
  const summaryTrigger = (text = summaryText): JSX.Element | null => staticSummary ? (
    <span
      // 走查锚点同摘要 pill；不是按钮（没有 role、点了什么都不开）。
      data-parameter-summary={text}
      data-parameter-summary-static="true"
      data-yield-item=""
      title={fullSummaryText}
      aria-label={fullSummaryText}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-pill border border-nomi-line bg-nomi-ink-05 pl-2.5 pr-2.5 text-caption text-nomi-ink-80 min-w-0"
    >
      {summaryIconNode}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  ) : hasPanel ? (
    <button
      ref={triggerRef}
      type="button"
      // 走查锚点：断言得能拿到那串摘要本身，
      // 不能靠中文 aria-label 去找（换个语言就断了）。
      data-parameter-summary={text}
      data-yield-item=""
      aria-label={t('generationCommon.parameters.generationParameters')}
      aria-expanded={panelOpen}
      title={(fitCandidates ? fullSummaryText : summaryText) || t('generationCommon.parameters.generationParameters')}
      data-parameter-summary-cramped={fitCandidates && fitCramped ? 'true' : undefined}
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      className={cn(
        'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-ink-05',
        // 在让的底栏里摘要不缩（有值的放不下就少一个值；一个值都没有、只写「参数」的也不缩——缩了就是「Param…」，
        // 放不下交给让法往下一级让）；没有底栏的照旧最宽 240、可收。
        fitCandidates || wrap || yielding ? 'shrink-0' : 'shrink',
        'justify-between text-caption text-nomi-ink-80 cursor-pointer min-w-0',
        'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-ink-40',
      )}
      style={fitCandidates || wrap || yielding ? undefined : { maxWidth: 240 }}
    >
      {summaryIconNode}
      <span className="min-w-0 truncate" style={{ maxWidth: wrap || fitCandidates || yielding ? 'none' : 240 }}>
        {text || emptySummaryText}
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
      className={cn(
        'generation-canvas-v2-node__params--parameters',
        'min-w-0',
        // 分镜行最窄一档（wrap）放不下就整颗换行；其余一行（画布节点长相不变）。
        cn('flex items-center', wrap ? 'flex-wrap gap-2' : 'gap-1.5'),
        // 让法要知道「还剩多宽」：参数条吃满这一段，摘要槽吃满身份几格之后的剩余。
        yielding && 'flex-1',
      )}
    >
      <div className="contents">{identityRow()}</div>
      {showSummary && yielding ? (
        <div data-parameter-summary-slot="true" className={cn('relative flex items-center', fitCramped ? 'flex-none' : 'min-w-0 flex-1')}>
          {summaryTrigger()}
          {panelPortal}
        </div>
      ) : showSummary ? (
        <div className="min-w-0 contents">
          {summaryTrigger()}
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
