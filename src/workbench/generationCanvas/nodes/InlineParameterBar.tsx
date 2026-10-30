import { workspaceInputSurfaceIsActive } from '../../shortcutSurface'
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { ICON_TIERS, NomiSelect } from '../../../design'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import type { ModelCatalogStatus } from '../../../config/modelCatalogStatus'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionValue,
} from './controls/parameterControlModel'
import { resolveArchetypeForOption } from './nodeModelArchetype'
import { modelVisibilityFooterAction, useDedupedModelSelect } from '../../common/useDedupedModelSelect'
import {
  localizeAutoOption,
  soloOptionControl,
} from './parameterOptionPresentation'
import {
  ParameterControlBody,
  ParameterOptionGroup,
  ParameterPanelGroup,
} from './controls/ParameterControlBody'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

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
  variantChoices?: readonly { id: string; label: string }[]
  activeVariantId?: string
  onVariantSelect?: (id: string) => void
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
  /** Width of the summary trigger in CSS pixels（不传 = 贴文字宽、最宽 240）。
   * `{ hug: N }` = 贴文字宽、最宽 N（分镜行：中文「全能参考 · 16:9 · 5 秒」与英文「Omni reference · 16:9 · 5s」
   * 宽差近一倍，定宽要么英文截断、要么中文留一截空白）。 */
  summaryWidth?: number | { hug: number }
  /**
   * 放不下就整颗换行、一个字都不截（分镜行最窄一档，E1a 的 320）：模型钮和摘要钮不设最大宽度，横排里是同一条可换行的 flex 行的成员。
   * 不传 = 原样（画布一行、贴文字宽最宽 240）。
   */
  wrap?: boolean
  /** Optional generation-mode group shown at the top of the shared panel. */
  modeChoices?: readonly { id: string; label: string; limitTip?: string }[]
  activeModeId?: string
  modeLabel?: string
  onModeSelect?: (id: string) => void
  /**
   * 模型下拉最前面的一项「不指定模型」（值为空串，选它 = `onModelChange('')`）。
   * 画布节点不传；分镜行传「默认模型」——分镜没选模型时落画布用默认模型，用户要能选回去。
   */
  leadingModelOption?: { label: string }
  /**
   * 面板最底下的一小段说明（分镜批量 / 多选：「哪些参数为什么没出现」）。画布节点不传。
   * 传了它，即使一个可调参数都没有，触发器也照样出现——点开才读得到「为什么没有」。
   */
  panelFooter?: React.ReactNode
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
  const label = matched ? matched.label : value.length > 8 ? `${value.slice(0, 8)}…` : value
  return localizeAutoOption(value, label, autoLabel).text
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
  variantChoices,
  activeVariantId,
  onVariantSelect,
  summaryOverride,
  summaryWidth,
  wrap = false,
  modeChoices,
  activeModeId = '',
  modeLabel,
  onModeSelect,
  leadingModelOption,
  panelFooter,
}: InlineParameterBarProps): JSX.Element {
  const { t } = useTranslation()
  // 去重选择 view-model（hook 必须在任何早返回前调用）。
  const modelSelect = useDedupedModelSelect(
    modelOptions,
    selectedModelOption?.value || '',
    onModelChange,
    selectedModelOption?.vendor,
  )

  // 摘要 pill 文本：各参数当前值串接（16:9 · 1080p · 5 · 音频）。面板装**全部**参数（pill 不占走任何一个）。
  const summaryText = summaryOverride || renderedControls
    .map((c) => summaryPart(c, meta, t('generationCommon.parameters.auto')))
    .filter(Boolean)
    .join(' · ')

  // ── 参数浮层：静止定位（打开定位一次，绝不跟随）。 ──
  // 打开时以触发器（pill / ⚙）中心定位一次，之后绝不跟随；
  // 比例变化通过节点原子锚定保证触发器本身不动。摘要文本也在打开期间冻结，宽度不跳。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<{
    left: number
    /** 触发器自己的左缘。贴内容的浮层按它对齐——320 那个槽不存在时，按槽居中会整体偏左。 */
    anchorLeft: number
    top: number
    maxHeight: number
    side: 'above' | 'below'
  } | null>(null)
  const [frozenSummary, setFrozenSummary] = React.useState('')
  // 触发器只有一个：那颗摘要 pill。
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  // 多参数面板是一叠分组，要一个稳定的列宽才对得齐；**单参数直出不是面板**，它就是那一组选项，
  // 宽高一律贴内容（2026-09-14 用户退回：「大片都是空白……他本来不需要看那么多地方」）。
  // 320 在这里只剩「最宽不超过」的作用，不再是「一定这么宽」。
  const PANEL_W = 320
  const PANEL_GAP = 6

  const openPanel = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
    const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
    const spaceAbove = rect.top - 12
    // 翻向此刻锁定：上方优先（底栏贴卡底），上方不足 240px 才放下方。定位仅此一次。
    const side: 'above' | 'below' = spaceAbove >= 240 ? 'above' : 'below'
    const maxHeight = side === 'above' ? Math.min(420, spaceAbove) : Math.min(420, Math.max(160, vh - rect.bottom - 18))
    // above 用 bottom 锚（面板实高小于 maxHeight 时依然贴住触发器顶）；below 用 top 锚。
    const top = side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP
    const anchorLeft = Math.min(Math.max(8, rect.left), Math.max(8, vw - 120))
    setPanelInit({ left, anchorLeft, top, maxHeight, side })
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

  // 单参数直出的浮层宽度 = **最宽那一项的文字宽 + 内边距**，不是那个固定的 320
  // （2026-09-14 用户两次拍板：一列、每项一行的摆法保持不变，只把右边那截空白收掉；
  //  ≈128px 而不是 302px，左缘与触发它的 chip 左缘对齐）。
  //
  // 为什么不能靠 CSS：这一列是 `minmax(0, 1fr)` 的格子，每项都被拉到容器宽，
  // 所以量 item 的矩形只会量回容器自己；`max-content` 又会把浮层撑到「全部项排成一行」。
  // 真正要的那个数是**文字本身**的宽度——用 Range 量内容盒，绕开被拉伸的按钮框。
  //
  // 「这是不是单参数直出」问 DOM（`[data-parameter-solo]`）而不是问下面的 soloControl：
  // 这几个 hook 必须排在 `modelOptions.length === 0` 那条早返回**之前**，而 soloControl 算在它之后。
  const [hugWidth, setHugWidth] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const panel = panelRef.current
    const group = panel?.querySelector<HTMLElement>('[data-parameter-solo] [role="radiogroup"]')
    if (!panelOpen || !panel || !group) { setHugWidth(null); return }
    const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    if (items.length === 0) return
    const range = document.createRange()
    let widestText = 0
    let itemPadX = 0
    for (const item of items) {
      range.selectNodeContents(item)
      widestText = Math.max(widestText, range.getBoundingClientRect().width)
      const itemStyle = getComputedStyle(item)
      itemPadX = Math.max(itemPadX, parseFloat(itemStyle.paddingLeft || '0') + parseFloat(itemStyle.paddingRight || '0'))
    }
    range.detach()
    if (!widestText) return
    const groupStyle = getComputedStyle(group)
    const groupPadX = parseFloat(groupStyle.paddingLeft || '0') + parseFloat(groupStyle.paddingRight || '0')
    // 面板外壳自己那圈（内边距 + 边框）：量出来而不是写死，改了 p-2 也不用回来改这里。
    const chrome = panel.getBoundingClientRect().width - group.getBoundingClientRect().width
    setHugWidth(Math.ceil(widestText + itemPadX + groupPadX + chrome))
  }, [panelOpen, summaryText])

  if (modelOptions.length === 0) {
    // 「还没有清单」和「清单里有但加载中」是两回事：后者画骨架，别画「无模型·配置模型」，
    // 否则点节点的瞬间会先闪一下空态再跳真实芯片（2026-10-11 走查第 4 条）。
    if (modelCatalogStatus.status === 'loading') {
      return (
        <span
          aria-hidden="true"
          data-model-chip-loading="true"
          className="inline-flex h-7 w-28 items-center rounded-full border border-nomi-line bg-nomi-ink-05 animate-pulse"
        />
      )
    }
    return (
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
      </button>
    )
  }

  // 控件长什么样住在 `controls/ParameterControlBody.tsx`（R9：这个文件只留编排）。
  // 「改一个参数写到哪儿去」三件一组传下去：面板、单参数直出、每个参数组共用同一份，
  // 谁也别再自己接一遍（P1）。
  const controlWiring = { meta, onCatalogControlChange, onParameterControlChange }

  const hasProvider = modelSelect.providerOptions.length > 1
  // 触发器只在**里面真有东西**时出现：参数、供应商、生成方式一件都没有的模型，
  // 留一颗点开是空白的触发器比不留更糟。
  const hasPanel = renderedControls.length > 0 || hasProvider || Boolean(modeChoices?.length && onModeSelect) || Boolean(panelFooter)
  // Catalog variants keep separate exact IDs; media archetype variants keep their existing parameter contract.
  // Both use the same approved variant control next to the family/model chip.
  const catalogVariants = modelSelect.variantOptions.length > 0
  const visibleVariants = catalogVariants
    ? modelSelect.variantOptions
    : (variantChoices || []).map((variant) => ({ value: variant.id, label: variant.label }))

  /**
   * **只有一个参数时，pill 点开直接就是那个参数的选项列表**（没有面板壳）——2026-09-11 13:00 用户拍板。
   *
   * 面板的价值是「一次打开连改多项」。只剩一个参数时它没有那个价值，只剩一层壳：
   * 图片节点只有尺寸，却要 pill → 面板 → 下拉 → 列表 → 选（四步）。直出之后是两步，选完即关。
   * 条件写全（供应商、生成方式也算参数组）——少算一个，面板里就会有东西被这条路吞掉。
   */
  const soloControl = soloOptionControl({
    controls: renderedControls,
    hasProvider: hasProvider || Boolean(panelFooter),
    hasModeChoices: Boolean(modeChoices?.length && onModeSelect),
  })

  // **单参数直出不是面板**，它就是那一组选项，宽高一律贴内容
  // （2026-09-14 用户退回：「大片都是空白，理论上不需要，非常占用视觉空间；他本来不需要看那么多地方」）。
  // 多参数面板仍要一个稳定列宽把各组小标题对齐，所以只有这条路改。
  const hugsContent = soloControl !== null

  const renderParameterPanel = (): JSX.Element => {
    // 浮层的名字得说实话：单参数直出时它就是那个参数的选项列表，不是「参数面板」。
    const surfaceLabel = soloControl
      ? translateModelDisplayText(soloControl.label)
      : t('generationCommon.parameters.panel')
    const content = soloControl ? (
      <div
        className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'overflow-y-auto overscroll-contain rounded-nomi-lg p-2')}
        style={{ maxHeight: panelInit?.maxHeight }}
        data-parameter-solo={soloControl.key}
        data-agent-parameter-control={soloControl.key}
      >
        <ParameterControlBody control={soloControl} {...controlWiring} onPicked={closePanel} />
      </div>
    ) : (
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
        {renderedControls.map((control) => (
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
        aria-label={surfaceLabel}
        data-agent-parameter-panel="true"
        className="nokey fixed rounded-nomi-lg border border-nomi-line bg-nomi-paper"
        style={{
          zIndex: 600,
          left: hugsContent ? panelInit?.anchorLeft : panelInit?.left,
          ...(panelInit?.side === 'above' ? { bottom: panelInit.top } : { top: panelInit?.top }),
          ...(hugsContent
            // 量出来之前先按面板列宽画一帧：一列摆法下 `max-content` 会把浮层撑成
            // 「全部项排成一行」，比 320 还宽，闪一下比什么都难看。
            ? { width: hugWidth ?? PANEL_W, maxWidth: PANEL_W }
            : { width: PANEL_W }),
          boxShadow: 'var(--workbench-shadow-pop)',
        }}
      >
        {content}
      </div>
    )
  }

  // 默认贴文字宽（最宽 240）：B3 摘要印「比例 · 清晰度 · 时长」，定宽 110 会把清晰度截成「720…」。
  const resolvedSummaryWidth = wrap || typeof summaryWidth === 'object' ? undefined : summaryWidth
  const summaryMaxWidth = wrap ? undefined : typeof summaryWidth === 'object' ? summaryWidth.hug : summaryWidth === undefined ? 240 : undefined
  // 分镜行最窄一档（wrap）放不下就整颗换行，身份两枚不缩——模型是这一行的一等决策（§1.5.4）。
  // 其余只有一颗定宽 pill，不存在「装不下」，行窄时让位的只有**模型**那枚：它的值区是有意的
  // 省略号、hover 的 title 是全名。变体是短枚举（「变体 5.0」），和分镜底栏的模式 / 时长同一条规则
  // （2026-10-06 前分镜旧底栏的让位表同一条规则：短枚举从不缩）——2026-09-21 走查：1100×720 英文下它被压到值区只剩
  // 5px，「Variant 5.0」读成「Variant E」，缩它省下的几像素换来的是一颗读不出的芯片。
  const modelChipClass = wrap ? 'shrink-0' : undefined
  const variantChipClass = 'shrink-0'
  const identityRow = (
    // 2026-09-22 总合并裁决：身份两枚谁让宽由 **#834 的规则**说了算（只有模型 chip `shrink-0`，
    // 变体短枚举从不缩），本分支 `70ebda21e` 给这层包装也加 `shrink-0` 的那一行按裁决撤掉。
    // 它想修的「EN 下 Kling 3.0 压住 16:9」由 #834 的 `modelChipClass` / `variantChipClass`
    // 两条一起覆盖；本分支留下的是**判据**——参数条一行里相邻两颗控件不许相压
    // （`tests/ux/design-lab-ask-card-in-panel.walk.mjs` 的重叠断言，原样保留、照跑）。
    <div className="flex min-w-0 items-center gap-1.5">
      {!hideModel ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.model')}
          placeholder={t('generationCommon.parameters.selectModel')}
          triggerMaxWidth={wrap ? 260 : summaryWidth === undefined ? 200 : 150}
          className={modelChipClass}
          value={modelSelect.modelValue}
          options={leadingModelOption ? [{ value: '', label: leadingModelOption.label }, ...modelSelect.modelOptions] : modelSelect.modelOptions}
          onChange={(id) => (id || !leadingModelOption ? modelSelect.onModelPick(id) : onModelChange(''))}
          onChipChange={modelSelect.onModelProviderPick}
          footerAction={modelVisibilityFooterAction()}
          hiddenNote={modelSelect.hiddenNote}
        />
      ) : null}
      {/* 变体（型号）小下拉：紧跟模型芯片（身份级，恒内联）。有变体的模型才显示。 */}
      {catalogVariants || visibleVariants.length > 1 ? (
        <NomiSelect
          ariaLabel={t('generationCommon.parameters.variant')}
          leadingLabel={t('generationCommon.parameters.variant')}
          className={variantChipClass}
          value={catalogVariants ? modelSelect.variantValue : activeVariantId || ''}
          options={visibleVariants}
          disabled={visibleVariants.length < 2}
          onChange={catalogVariants ? modelSelect.onVariantPick : (v) => onVariantSelect?.(v)}
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
      aria-label={t('generationCommon.parameters.generationParameters')}
      aria-expanded={panelOpen}
      title={pillText || t('generationCommon.parameters.generationParameters')}
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      className={cn(
        'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-ink-05',
        // 贴文字宽（hug，分镜行）时允许收：行窄、字体宽（Linux / mac 字体比 Windows 宽）时先截断摘要文字，
        // 不把右端的「生成」挤出卡外（2026-10-06 #1042）。定宽的画布节点照旧不收。
        summaryMaxWidth !== undefined ? 'shrink' : 'shrink-0',
        'justify-between text-caption text-nomi-ink-80 cursor-pointer min-w-0',
        'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-ink-40',
      )}
      style={summaryMaxWidth !== undefined ? { maxWidth: summaryMaxWidth } : { width: resolvedSummaryWidth }}
    >
      <span className="min-w-0 truncate" style={{ maxWidth: wrap ? 'none' : 240 }}>
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
      className={cn(
        'generation-canvas-v2-node__params--parameters',
        'min-w-0',
        // 分镜行最窄一档（wrap）放不下就整颗换行；其余一行（画布节点长相不变）。
        cn('flex items-center', wrap ? 'flex-wrap gap-2' : 'gap-1.5'),
      )}
    >
      <div className="contents">{identityRow}</div>
      {summaryTrigger ? (
        <div className="min-w-0 contents">
          {summaryTrigger}
          {panelPortal}
        </div>
      ) : null}
    </div>
  )
  // 这一次读目录失败、但上一份清单还在屏上：说清楚「仍是旧的」和原因（只在这个状态多一行，平时 DOM 不变）。
  if (modelCatalogStatus.status !== 'stale_kept') return bar
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {bar}
      <span role="status" data-model-catalog-stale="true" title={modelCatalogStatus.message} className="min-w-0 break-words text-micro text-nomi-warning">
        {modelCatalogStatus.message}
      </span>
    </div>
  )
}
