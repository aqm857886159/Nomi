import { resolveStoryboardOverride } from './exec/storyboardOverrideActions'
import React, { type JSX } from 'react'
import { flushSync } from 'react-dom'
import { defaultRangeExtractor, measureElement, observeElementRect, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { useWorkbenchStore } from '../../workbenchStore'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronRight, IconPlayerPlay, IconPlus } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { storyboardProfileForKey } from '../../generationCanvas/agent/storyboardProfiles'
import {
  duplicateShotAt,
  moveShot,
  NO_SCENE_VALUE,
  insertShotAt,
  sceneGroupsOf,
  totalDurationSec,
  updateShotPrompt,
  updateShotAt,
  type SceneGroup,
  type PlanShotPatch,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import type { PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import type { AnchorCardRuntime, StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { useShotMentionPool, useShotMentionSource, type ShotMentionPool } from './shotRow/useShotMentionSource'
import { StoryboardRowDensityContext, useStoryboardRowsDensity } from './shotRow/storyboardRowDensity'
import { StoryboardPromptHistoryContext } from './shotRow/promptHistoryCarry'
import StoryboardShotRowPlaceholder from './shotRow/StoryboardShotRowPlaceholder'
import { planItemMounts } from './storyboardMountPlan'
import { appendBinding } from './shotRow/shotReferenceSlots'
import { resolveShotArchetypeMode } from './shotRow/shotRowModel'
import { referenceSlotAccept } from '../../generationCanvas/nodes/controls/archetypeMeta'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import { useVendorPreferenceOrder } from '../../common/useVendorPreference'
import StoryboardShotRow from './shotRow/StoryboardShotRow'
import { densityBox, frameMediaBox, isPortraitBox, type FrameMediaBox } from './shotRow/shotFrameGeometry'
import {
  effectiveShotAspect,
  planDefaultAspect,
  resolveShotParams,
  setShotAspectOverride,
} from '../../generationCanvas/agent/storyboardShotScope'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'
import type { ShotVariant } from './shotRow/shotVariants'
import { positionsForAnchorFilter } from './storyboardDInteractions'
import StoryboardSelectionToolbar from './StoryboardSelectionToolbar'
import { applyBulkModelToShots, type StoryboardShotKind } from './storyboardBulkModelScope'
import { applyBulkParamToShots, storyboardBulkParamGroups } from './storyboardBulkParamScope'
import { confirmDialog } from '../../../design'
import { cn } from '../../../utils/cn'

/**
 * 分镜表主体（v5 场分组 + 执行态）：`sceneGroupsOf` 把镜序切成场组——组头（▾ 场名 · N 镜 ·
 * 合计时长 · 异常计数）+ 可折叠行区。无场旧 plan = 单一隐式组，不渲染组头。
 * 行执行态（rows，与 plan.shots 同序）由编辑器统一 derive 传入——组头计数与行状态同一份
 * （F2 禁静态快照）。拖拽 = 行对行（moveShot 场感知）。合计口径 = totalDurationSec。
 *
 * **只挂看得见的行**（2026-10-16，C-trace storyboard-plan-open：320 镜打开 18.2 秒、期间整个应用不响应）：
 * 组头与镜头行摊平成一条项目列表，交给 `@tanstack/react-virtual`（仓库里素材库 / 提示词库 / 生成列表同一个库）
 * 只渲染视口 + 缓冲；每行的提示词编辑器、参数区随行一起挂卸，挂载量只随视口、不随镜头总数。
 * 不可见的行不在 DOM 里，所以凡是「找到某一镜」的动作（从画布定位过来、键盘上下移）都按**项目下标**
 * 先让虚拟列表滚过去，等那一行挂上再聚焦，不再 querySelector 整张表。正在编辑（焦点在里面）和正在拖的那一行
 * 始终挂着（`rangeExtractor` 钉住），滚走了也不丢输入法组字、撤销栈和弹层锚点。
 */

/** 还没量到滚动区（首帧 / 服务端渲染 / 设计实验室没有滚动区）时按这个视口算首屏。 */
const FALLBACK_VIEWPORT = { width: 1200, height: 1080 }
/** 视口上下各多挂几项：键盘上下移、滚轮小步滚动时下一行已经在，不闪白。 */
const OVERSCAN = 3
/** 估高只决定首帧的总高与滚动条，挂上后按实测改（`measureElement`）。 */
const HEAD_ESTIMATE = 30
/**
 * 镜头行估高（没量过的行用它；快速滚动时的占位也按它的高度摆，所以要贴近实测，免得停下换成完整行时列表跳）：
 * 视觉列 = 预览框（窄档按 176/240 缩）+ 横版 / 方图时框下那条参考缩略图（约 42）；竖版参考在框右边、不加高；
 * 内容列（提示词 + 底栏）至少约 100；再加行内边距 24 + 分隔线 1 + 行间插入线 6。
 * 2026-10-16 实测：9:16 宽档 265 / 窄档 201，16:9 宽档 201。
 */
/** 最窄档：缩略图一行 + 参考 / 提示词 / 底栏（底栏可能折两行）整列往下排。 */
const rowEstimate = (box: FrameMediaBox, compact = false): number => (compact ? box.height + 230 : Math.max(isPortraitBox(box) ? box.height : box.height + 42, 100)) + 24 + 1 + 6

/**
 * 分镜页被藏起来时（切到生成页：React.Activity / display:none），滚动区和每一项都会被量成 0。
 * 照收的话，视口变 0 → 一行都不挂（藏着时行被拆光，撤销 / 焦点 / 编辑器都跟着没了，回来再全部重建）；
 * 各项高度变 0 → 回来前的那一刻整张表都挤进视口。所以 0 尺寸不算数：视口保持上一次可见时的大小，
 * 项的高度保持上一次的实测（没有就用估高）。藏着时挂着的行与藏之前一致，和窗口化之前一样（CI：storyboard-delete-undo「hidden」）。
 */
const observeVisibleRect: typeof observeElementRect = (instance, callback) =>
  observeElementRect(instance, (rect) => { if (rect.width > 0 || rect.height > 0) callback(rect) })
const measureVisibleElement: typeof measureElement = (element, entry, instance) => {
  const size = measureElement(element, entry, instance)
  if (size > 0) return size
  const index = instance.indexFromElement(element)
  return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index)
}

type TableItem =
  | { kind: 'head'; key: string; group: SceneGroup; groupIndex: number }
  | { kind: 'shot'; key: string; shot: PlanShot; pos: number }

type Props = {
  pendingActions?: ReadonlySet<string>
  plan: StoryboardPlan
  projectId?: string | null
  /** 行执行 runtime（与 plan.shots 同序；exec/storyboardRowStatus 单源 derive）。 */
  rows: StoryboardRowRuntime[]
  /** C1：参考卡 runtime（供行级 @ 候选）。缺省 = 不开 @ 面板。 */
  anchorCards?: AnchorCardRuntime[]
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  /** 提示词为空的镜号（validatePlan 的 empty-shot-prompt 投影，行红边用）。 */
  emptyPromptShots: Set<number>
  /**
   * 执行计划的行内警示（返工 7 / D1）：键 = `stableShotId`，值 = 已渲染好的短句 + 完整理由。
   * 表与行都不认识引擎（不 import planResolver）——句子在编辑器用 `strategyText` 渲染好再传下来。
   */
  durationWarnings?: ReadonlyMap<string, { kind: 'overflow' | 'underflow'; text: string; detail: string }> | undefined
  onChange: (plan: StoryboardPlan) => void
  /** The resident Agent receives the same stable storyboard reference as the row selection UI. */
  onStoryboardShotSelect?: (shot: StoryboardPlan['shots'][number]) => void
  /** 选中集变化时上报（编辑器与浮条读同一份选择，不各存一份）。 */
  onSelectionChange?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 行内「生成」（画面格常驻按钮 / 失败重试）。 */
  onGenerateRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ↻ 原地重生成。 */
  onRegenerateRow: (runtime: StoryboardRowRuntime) => void
  /**
   * 可找回行的**免费**续查（`recoverNodeResult`）。可选：设计实验室等只读取景不接执行通路，
   * 缺省时那枚按钮就不出现——但绝不许拿 `onGenerateRow` 顶替（那是付费重跑）。
   */
  onRecoverRow?: ((runtime: StoryboardRowRuntime) => void) | undefined
  /** 行 ⋯ 菜单里的「锁定 / 解锁」镜级开关。 */
  onToggleLockRow: (runtime: StoryboardRowRuntime) => void
  /** 结果态双击打开预览。 */
  onOpenPreviewRow: (runtime: StoryboardRowRuntime) => void
  onLocateInCanvasRow?: ((runtime: StoryboardRowRuntime) => void) | undefined
  /** 参考已变「用新图重跑」。 */
  onRerunFreshRefsRow: (runtime: StoryboardRowRuntime) => void
  onGenerateSelected: (runtimes: StoryboardRowRuntime[]) => void
  onDeleteSelected: (runtimes: StoryboardRowRuntime[]) => void
  filterAnchorId?: string | null
  /**
   * 「本次跳过」的行（`stableShotId` 键，v6 §2.10）。**受控**：owner 是编辑器，因为 footer 的
   * 「将跑 N 镜」必须与它同一份 derive（合同 §9.3：不许 footer 自己再减一次）。
   */
  skippedShotIds?: ReadonlySet<string>
  onToggleSkip?: ((shotId: string) => void) | undefined
  /** 每镜的历史变体（§2.9）；键 = `stableShotId`。本轮由调用方喂，落盘是下一刀。 */
  variantsByShotId?: Readonly<Record<string, readonly ShotVariant[]>>
  adoptedVariantByShotId?: Readonly<Record<string, string>>
  onAdoptVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  onDeleteVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  /** 每镜产出的 `@tag`（§2.10）；键 = `stableShotId`。 */
  outputTagByShotId?: Readonly<Record<string, string>>
  /** Agent 入口——多选浮条与每行 ⋯ 菜单两处。 */
  onAgentHandoff?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 播放本场；整片播放复用同一 playback queue owner。 */
  onPlayGroup?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /**
   * 表所在的滚动区（分镜页那条 `data-storyboard-scroll`）。窗口化按它的视口算挂哪几行；
   * 缺省（设计实验室取景、无滚动区）= 按 `FALLBACK_VIEWPORT` 那么高的视口挂。
   */
  scrollRef?: React.RefObject<HTMLElement | null>
}

/**
 * 行级 @ mention 适配层（C1）：`useShotMentionSource` 需要 shot 作为参数，所以必须在行级调用。
 * 这一层**只**负责把 hook 的产出补进行 props——其余 props 原样透传（以前逐字段重列一遍，
 * 每加一个行属性就要在三处同步，是典型的"同一份契约抄了两遍"）。
 */
type ShotRowProps = React.ComponentProps<typeof StoryboardShotRow>

function ShotRowWithMention({
  rowProps,
  anchorCards,
  pool,
}: {
  rowProps: ShotRowProps
  anchorCards: AnchorCardRuntime[]
  pool: ShotMentionPool
}): JSX.Element {
  const orderedVendorKeys = useVendorPreferenceOrder()
  const { shot, modelOptions, onUpdate } = rowProps
  const resolvedMode = resolveShotArchetypeMode(findModelOptionByIdentifier(modelOptions ?? [], shot.modelKey, shot.modelVendor, orderedVendorKeys), shot.modeId)?.mode ?? null
  // @ 一个素材 = 往这一行的参考列里放一张。这一行当前模式没有能收它的槽（如文生图）就不假装：拒绝插入。
  const onBindReference = React.useCallback((reference: { url: string; name: string; kind: 'image' | 'video' | 'audio'; anchorId?: string; sourceNodeId?: string }): boolean => {
    if (!resolvedMode) return false
    const slot = resolvedMode.slots.find((candidate) => candidate.kind === 'image_ref' && referenceSlotAccept(candidate.kind) === reference.kind)
      ?? resolvedMode.slots.find((candidate) => referenceSlotAccept(candidate.kind) === reference.kind)
    if (!slot) return false
    const result = appendBinding(shot.referenceBindings, slot, {
      url: reference.url, name: reference.name,
      ...(reference.anchorId ? { anchorId: reference.anchorId } : {}),
      ...(reference.sourceNodeId ? { sourceNodeId: reference.sourceNodeId } : {}),
    }, reference.kind)
    if (result.status === 'added') { onUpdate({ referenceBindings: result.next }); return true }
    return result.status === 'duplicate'
  }, [onUpdate, resolvedMode, shot.referenceBindings])
  const { mentionSearch, onMentionSelect, currentReferenceUrls, mentionUpload } = useShotMentionSource(
    rowProps.shot,
    rowProps.anchors,
    anchorCards,
    onBindReference,
    pool,
  )
  return (
    <StoryboardShotRow
      {...rowProps}
      mentionSearch={mentionSearch}
      onMentionSelect={onMentionSelect}
      currentRefUrls={currentReferenceUrls}
      mentionUpload={mentionUpload}
    />
  )
}

export default function StoryboardShotTable({ pendingActions, plan, projectId, rows, anchorCards, imageModelOptions, videoModelOptions, emptyPromptShots, durationWarnings, onChange, onStoryboardShotSelect, onSelectionChange, onGenerateRow, onRegenerateRow, onRecoverRow, onToggleLockRow, onOpenPreviewRow, onLocateInCanvasRow, onRerunFreshRefsRow, onGenerateSelected, onDeleteSelected, filterAnchorId, skippedShotIds, onToggleSkip, variantsByShotId, adoptedVariantByShotId, outputTagByShotId, onAgentHandoff, onPlayGroup, onAdoptVariant: props_onAdoptVariant, onDeleteVariant: props_onDeleteVariant, scrollRef }: Props): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [foldedScenes, setFoldedScenes] = React.useState<ReadonlySet<string>>(new Set())
  const [selectedShotIds, setSelectedShotIds] = React.useState<ReadonlySet<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = React.useState<number | null>(null)

  const tableRef = React.useRef<HTMLDivElement>(null)
  // 行宽档位：行区量**一次**，经 context 递给每一行（行不再各量自己）。
  const density = useStoryboardRowsDensity(tableRef)
  // @ 候选的素材池：整张表一份（挂载即扫一次项目文件），各行只读。
  const mentionPool = useShotMentionPool(projectId)
  const rowFocus = useWorkbenchStore((state) => state.storyboardRowFocus)
  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const activeDesignId = useWorkbenchStore((state) => state.activeStoryboardId)
  const focusShot = rowFocus?.designId === activeDesignId ? plan.shots.find((shot) => stableShotId(shot) === rowFocus.rowId) : undefined

  const visiblePositions = positionsForAnchorFilter(plan, filterAnchorId ?? null)
  const visiblePlan = filterAnchorId ? { ...plan, shots: visiblePositions.map((position) => plan.shots[position]) } : plan
  const groups = sceneGroupsOf(visiblePlan)
  const allGroups = sceneGroupsOf(plan)
  // 单一隐式组 = 无分场故事：不显组头（表退化成今天的平铺行为）。
  const showHeads = !(groups.length === 1 && groups[0].scene === null)
  const foldKeyOf = (group: SceneGroup): string => group.scene?.id ?? '__implicit__'
  const shotKeyOf = (shot: PlanShot): string => `shot:${shot.shotId ?? `index:${shot.index}`}`

  // 组头 + 镜头行摊平成一条列表（窗口化按它的下标挂卸）。折叠的组只剩组头。
  const items: TableItem[] = []
  groups.forEach((group, groupIndex) => {
    if (showHeads) items.push({ kind: 'head', key: `head:${groupIndex}:${foldKeyOf(group)}`, group, groupIndex })
    if (foldedScenes.has(foldKeyOf(group))) return
    group.shots.forEach((shot, indexInGroup) => {
      items.push({ kind: 'shot', key: shotKeyOf(shot), shot, pos: visiblePositions[group.startPos + indexInGroup] })
    })
  })
  const itemIndexOfKey = (key: string | null): number => (key === null ? -1 : items.findIndex((item) => item.key === key))

  // 焦点在哪一行里、哪一行正被拖着：这两行滚出视口也不卸（输入法组字、编辑器撤销栈、拖拽源都挂在它们身上）。
  const [focusedItemKey, setFocusedItemKey] = React.useState<string | null>(null)
  const draggedShot = dragIndex !== null ? plan.shots[dragIndex] : undefined
  const pinnedIndexes = [itemIndexOfKey(focusedItemKey), draggedShot ? itemIndexOfKey(shotKeyOf(draggedShot)) : -1].filter((index) => index >= 0)
  const pinnedSignature = pinnedIndexes.join(',')
  const rangeExtractor = React.useCallback((range: Range): number[] => {
    const pinned = pinnedSignature ? pinnedSignature.split(',').map(Number) : []
    if (!pinned.length) return defaultRangeExtractor(range)
    return [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b)
  }, [pinnedSignature])

  // 媒体盒**一张表算一次**（§2.4 修订 · 2026-09-06 用户反馈四「不同画幅的行一放进来整个框就不齐」）：
  // 盒子 = **整片默认画幅**的框（`planDefaultAspect`，与落画布同一个 resolver）；覆盖了画幅的镜在这只框里
  // contain + 角标。2026-10-06 起不再用「镜数最多的画幅」近似——覆盖过半时那样算会让整张表跟着少数派变形。
  const tableBox = React.useMemo(() => frameMediaBox(planDefaultAspect(plan)), [plan])
  const shotEstimate = rowEstimate(densityBox(tableBox, density), density === 'compact')

  // 表上面还有执行计划条、参考卡区、标题行：列表的起点 = 行区在滚动区里的偏移（TanStack `scrollMargin`）。
  const [scrollMargin, setScrollMargin] = React.useState(0)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: (index) => (items[index]?.kind === 'head' ? HEAD_ESTIMATE : shotEstimate),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: OVERSCAN,
    scrollMargin,
    initialRect: FALLBACK_VIEWPORT,
    rangeExtractor,
    observeElementRect: observeVisibleRect,
    measureElement: measureVisibleElement,
  })
  // 偏移量：每次表渲染读一次（编辑器状态变了，上面几块的高度可能跟着变），再加一个 ResizeObserver 接住
  // 上面几块自己长高 / 变矮（参考卡出图、执行计划条出现）。都是整张表一次，不随行数增长。
  const measureScrollMargin = React.useCallback((): void => {
    const scrollElement = scrollRef?.current
    const table = tableRef.current
    if (!scrollElement || !table) return
    const next = table.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop
    setScrollMargin((previous) => (Math.abs(previous - next) < 1 ? previous : next))
  }, [scrollRef])
  React.useLayoutEffect(measureScrollMargin)
  React.useLayoutEffect(() => {
    const scrollElement = scrollRef?.current
    if (!scrollElement || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measureScrollMargin)
    for (const child of Array.from(scrollElement.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [measureScrollMargin, scrollRef])

  // 「聚焦第 N 镜」：先让那一项进视口（它可能还没挂），挂上之后再给焦点。
  // `nativeScroll`：聚焦时让浏览器把它滚进视口（键盘上下移）；否则视口已经由虚拟列表摆好（定位到某一镜，居中）。
  // `prompt`：焦点进这一镜的提示词编辑器（光标放末尾），否则落在行上。
  const [pendingFocus, setPendingFocus] = React.useState<{ shotIndex: number; nativeScroll: boolean; prompt?: boolean } | null>(null)
  const rowElementOf = (shotIndex: number): HTMLElement | null =>
    tableRef.current?.querySelector<HTMLElement>(`[data-storyboard-row="${CSS.escape(String(shotIndex))}"]`) ?? null
  /** 定位到某一镜（居中）：交给虚拟列表按下标滚（动态行高由它边量边校准），挂上后聚焦。 */
  const revealShot = (shot: PlanShot): boolean => {
    const itemIndex = itemIndexOfKey(shotKeyOf(shot))
    if (itemIndex < 0) return false
    virtualizer.scrollToIndex(itemIndex, { align: 'center' })
    setPendingFocus({ shotIndex: shot.index, nativeScroll: false })
    return true
  }
  /**
   * 键盘上下移：相邻那一行通常在缓冲里已经挂着——直接聚焦，浏览器自己把它滚进视口（与窗口化前同一个行为）。
   * 它不在 DOM 里（焦点所在行被钉住、视口早已滚远）时，先把滚动区直接摆到那一项的估算位置，挂上后再原生聚焦
   * （聚焦那一下由浏览器把它滚准）。这里**不用** `scrollToIndex`：方向键自己还会让滚动区原生滚一下，
   * 虚拟列表的「滚到位校准」于是一直对不上，5 秒内只要有行高变化就把视口拽回目标（2026-10-16 走查实测）。
   */
  const focusAdjacentShot = (shot: PlanShot): void => {
    const row = rowElementOf(shot.index)
    if (row) { row.focus(); return }
    // 挂着的是轻量占位（刚滚进来）：不用滚，钉住它（下一帧就是完整行）再聚焦。
    if (tableRef.current?.querySelector(`[data-storyboard-row-placeholder="${CSS.escape(String(shot.index))}"]`)) {
      setPendingFocus({ shotIndex: shot.index, nativeScroll: true })
      return
    }
    const itemIndex = itemIndexOfKey(shotKeyOf(shot))
    const offset = itemIndex >= 0 ? virtualizer.getOffsetForIndex(itemIndex, 'auto')?.[0] : undefined
    const scrollElement = scrollRef?.current
    if (offset === undefined || !scrollElement) return
    scrollElement.scrollTop = offset
    setPendingFocus({ shotIndex: shot.index, nativeScroll: true })
  }
  const virtualItems = virtualizer.getVirtualItems()
  // 滚动中新进来的镜头行先挂轻量占位，停下后每帧升级一行（storyboardMountPlan）：滚动中不建编辑器。
  const mountedFullRef = React.useRef<ReadonlySet<string>>(new Set())
  const mountedLightRef = React.useRef<ReadonlySet<string>>(new Set())
  const viewportRange = virtualizer.range
  const mountPlan = planItemMounts({
    items: virtualItems.flatMap((virtualItem) => {
      const item = items[virtualItem.index]
      if (!item) return []
      const inViewport = viewportRange ? virtualItem.index >= viewportRange.startIndex && virtualItem.index <= viewportRange.endIndex : true
      return [{ key: item.key, kind: item.kind, inViewport }]
    }),
    isScrolling: virtualizer.isScrolling,
    previousFull: mountedFullRef.current,
    previousLight: mountedLightRef.current,
    // 钉住：焦点所在、正在拖、等着被聚焦的那一镜（它一挂上就得是完整行，焦点才有地方落）。
    pinned: new Set([
      ...pinnedIndexes.map((index) => items[index]?.key),
      pendingFocus ? items.find((item) => item.kind === 'shot' && item.shot.index === pendingFocus.shotIndex)?.key : undefined,
    ].filter((key): key is string => Boolean(key))),
  })
  // 停下以后每帧升级一个占位：在每次提交后（布局 effect，每次提交必跑）排下一帧，直到没有占位。
  const upgradePending = !virtualizer.isScrolling && mountPlan.light.size > 0
  const [, setUpgradeFrame] = React.useState(0)
  const upgradeFrameRef = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    mountedFullRef.current = mountPlan.full
    mountedLightRef.current = mountPlan.light
    if (upgradeFrameRef.current !== null) cancelAnimationFrame(upgradeFrameRef.current)
    upgradeFrameRef.current = upgradePending
      ? requestAnimationFrame(() => { upgradeFrameRef.current = null; setUpgradeFrame((value) => value + 1) })
      : null
  })
  React.useEffect(() => () => { if (upgradeFrameRef.current !== null) cancelAnimationFrame(upgradeFrameRef.current) }, [])
  // 编辑器撤销历史跨卸载：按镜头 id 存在这张表里（promptHistoryCarry），与表同寿。
  const promptHistoryRef = React.useRef<Map<string, import('@tiptap/react').JSONContent[]>>(new Map())

  // 挂着哪几项一变（滚到了、那一行挂上了）就再找一次。
  const mountedSignature = virtualItems.map((virtualItem) => virtualItem.key).join('|')
  React.useLayoutEffect(() => {
    if (pendingFocus === null) return
    const row = rowElementOf(pendingFocus.shotIndex)
    if (!row) return
    const editable = pendingFocus.prompt ? row.querySelector<HTMLElement>('[data-prompt-box] [contenteditable="true"]') : null
    if (editable) {
      editable.focus({ preventScroll: true })
      // 光标放到末尾（ProseMirror 跟随 DOM 选区）。
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    } else row.focus({ preventScroll: !pendingFocus.nativeScroll })
    setPendingFocus(null)
  }, [pendingFocus, mountedSignature])
  /**
   * 点在还没换掉的占位行上（V-1210 复验 R2-1）：在按下的这一刻**同步**把它钉成完整行并交出焦点——
   * flushSync 让升级、挂编辑器、聚焦都在这次 pointerdown 里完成，紧跟着的按键直接进编辑器，一个字都不落空。
   */
  const activatePlaceholder = (shot: PlanShot, target: 'prompt' | 'row'): void => {
    flushSync(() => setPendingFocus({ shotIndex: shot.index, nativeScroll: false, prompt: target === 'prompt' }))
  }

  // 从画布 / 列表「定位到这一镜」：展开折叠的场 → 滚到那一项 → 聚焦并选中。
  React.useLayoutEffect(() => {
    if (workspaceMode !== 'storyboard' || !focusShot) return
    if (foldedScenes.size) { setFoldedScenes(new Set()); return }
    // 被参考卡筛选挡住时先不动：编辑器收到定位会清掉筛选，下一次渲染这一镜回到列表里再滚。
    if (!revealShot(focusShot)) return
    setSelectedShotIds(new Set([focusShot.shotId ?? `index:${focusShot.index}`]))
    useWorkbenchStore.getState().setStoryboardRowFocus(null)
    // revealShot 读的是当帧的 items / virtualizer；依赖与旧实现相同。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusShot, foldedScenes, filterAnchorId, workspaceMode])
  const selectedRows = rows.filter((runtime) => selectedShotIds.has(runtime.shot.shotId ?? `index:${runtime.shot.index}`))
  // 选择是表的状态、footer 是它的消费者——上报而不是让 footer 再存一份（两份选择必然会漂）。
  const selectedKeysSignature = [...selectedShotIds].sort().join('|')
  React.useEffect(() => {
    onSelectionChange?.(selectedRows)
    // selectedRows 每次渲染都是新数组；用稳定签名当依赖，避免每帧回调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeysSignature, rows])
  // 「统一模型」按选中集合的**镜种**分档（storyboardBulkModelScope 单源）——图片镜只列图片模型、
  // 视频镜只列视频模型；两种都选中就出两个下拉。混成一条平列表是 2026-09-11 反馈的那条错。
  const selectedModelGroups = storyboardBulkParamGroups({
    plan,
    shots: selectedRows.map((runtime) => runtime.shot),
    imageModelOptions,
    videoModelOptions,
    aspectOf: (shot) => effectiveShotAspect(plan, shot),
  })
  const selectKeyOf = (shot: StoryboardRowRuntime['shot']): string => shot.shotId ?? `index:${shot.index}`
  const onSelectShot = (position: number, event: React.MouseEvent): void => {
    const keyAt = (index: number): string => selectKeyOf(rows[index].shot)
    const visible = visiblePositions
    if (event.shiftKey && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, visible.indexOf(position))
      const end = Math.max(selectionAnchor, visible.indexOf(position))
      setSelectedShotIds(new Set(visible.slice(start, end + 1).map((index) => selectKeyOf(rows[index].shot))))
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedShotIds((previous) => {
        const next = new Set(previous)
        const key = keyAt(position)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
      })
      setSelectionAnchor(visible.indexOf(position))
    } else {
      setSelectedShotIds(new Set([keyAt(position)]))
      setSelectionAnchor(visible.indexOf(position))
    }
    onStoryboardShotSelect?.(rows[position].shot)
  }
  const applyParamToSelected = (kind: StoryboardShotKind, control: Parameters<typeof applyBulkParamToShots>[0]['control'], raw: string): void => {
    const group = selectedModelGroups.find((candidate) => candidate.kind === kind)
    if (!group) return
    onChange(applyBulkParamToShots({ plan, isSelected: (shot) => selectedShotIds.has(selectKeyOf(shot)), kind, control, raw, controls: group.scope.controls }))
  }
  // 「本次跳过」作用于已选镜：已选的全都跳过了就改成取消；否则把还没跳过的补上。
  const allSelectedSkipped = selectedRows.length > 0 && selectedRows.every((runtime) => skippedShotIds?.has(stableShotId(runtime.shot)))
  const skipSelected = (): void => {
    if (!onToggleSkip) return
    for (const runtime of selectedRows) {
      const key = stableShotId(runtime.shot)
      if ((skippedShotIds?.has(key) ?? false) === allSelectedSkipped) onToggleSkip(key)
    }
  }
  const toggleSelectedAt = (position: number): void => {
    const key = selectKeyOf(rows[position].shot)
    setSelectedShotIds((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
    setSelectionAnchor(visiblePositions.indexOf(position))
  }
  const applyModelToSelected = (kind: StoryboardShotKind, modelKey: string, vendor?: string): void => {
    onChange(applyBulkModelToShots({ plan, isSelected: (shot) => selectedShotIds.has(selectKeyOf(shot)), kind, modelKey, vendor }))
  }
  const deleteSelected = async (): Promise<void> => {
    const generated = selectedRows.some((row) => Boolean(row.exec.resultUrl))
    if (generated && !(await confirmDialog({ title: t('storyboardEditor.rowActions.deleteTitle'), message: t('storyboardEditor.rowActions.deleteMessage'), confirmLabel: t('storyboardEditor.selection.delete'), danger: true }))) return
    onDeleteSelected(selectedRows)
    setSelectedShotIds(new Set())
  }
  const toggleFold = (group: SceneGroup): void => {
    const key = foldKeyOf(group)
    setFoldedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const headTitleOf = (group: SceneGroup, groupIndex: number): string => {
    if (group.scene === null) return t('storyboardEditor.sceneGroup.unassigned')
    return group.scene.title.trim() || t('storyboardEditor.sceneGroup.untitled', { index: groupIndex + 1 })
  }

  // 组头小结：与行状态同一份 derive（rows 按 startPos 切片；F2 禁静态快照）。
  const groupRowsOf = (group: SceneGroup): StoryboardRowRuntime[] =>
    group.shots
      .map((_shot, index) => rows[visiblePositions[group.startPos + index]])
      .filter((row): row is StoryboardRowRuntime => Boolean(row))

  const renderHead = (group: SceneGroup, groupIndex: number): JSX.Element => {
    const folded = foldedScenes.has(foldKeyOf(group))
    const groupRows = groupRowsOf(group)
    const missingCount = groupRows.filter((row) => row.exec.status === 'missing-required').length
    const doneCount = groupRows.filter((row) => row.exec.status === 'done' || row.exec.status === 'locked').length
    const lockedCount = groupRows.filter((row) => row.exec.status === 'locked').length
    return (
      <div className="flex w-full items-center gap-2 bg-nomi-ink-05 px-3 py-1.5 hover:bg-nomi-ink-10">
        <button
          type="button"
          onClick={() => toggleFold(group)}
          aria-expanded={!folded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {folded ? (
            <IconChevronRight size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
          ) : (
            <IconChevronDown size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
          )}
          <span className="min-w-0 truncate text-caption font-medium text-nomi-ink-80">{headTitleOf(group, groupIndex)}</span>
          <span className="ml-auto shrink-0 flex items-center gap-2.5 text-micro text-nomi-ink-40">
          <span>{(() => {
            const allGroup = allGroups.find((candidate) => foldKeyOf(candidate) === foldKeyOf(group))
            return filterAnchorId && allGroup
              ? t('storyboardEditor.sceneGroup.filteredSummary', { visible: group.shots.length, total: allGroup.shots.length, seconds: totalDurationSec(group.shots) })
              : t('storyboardEditor.sceneGroup.summary', { count: group.shots.length, seconds: totalDurationSec(group.shots) })
          })()}</span>
          {doneCount > 0 ? (
            <span className="text-workbench-success">{t('storyboardEditor.sceneGroup.doneCount', { count: doneCount })}</span>
          ) : null}
          {lockedCount > 0 ? (
            <span>{t('storyboardEditor.sceneGroup.lockedCount', { count: lockedCount })}</span>
          ) : null}
          {missingCount > 0 ? (
            <span className="text-workbench-danger">{t('storyboardEditor.sceneGroup.missingRequired', { count: missingCount })}</span>
          ) : null}
          </span>
        </button>
        {onPlayGroup ? (
          <button
            type="button"
            onClick={() => onPlayGroup(groupRows)}
            disabled={groupRows.length === 0}
            data-storyboard-play-scene={foldKeyOf(group)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 py-0.5 text-micro text-nomi-ink-60 hover:border-nomi-ink-30 hover:text-nomi-accent disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('storyboardEditor.playback.sceneAria', { name: headTitleOf(group, groupIndex) })}
          >
            <IconPlayerPlay size={11} stroke={1.8} />
            {t('storyboardEditor.playback.scene')}
          </button>
        ) : null}
      </div>
    )
  }

  const renderShot = (shot: PlanShot, pos: number): JSX.Element => {
    const runtime = rows[pos]
    const shotKey = stableShotId(shot)
    const commonRowProps = {
      shot,
      actionBusy: pendingActions?.has(`shot:${shotKey}`),
      anchors: plan.anchors,
      modelOptions: shot.shotKind === 'image' ? imageModelOptions : videoModelOptions,
      promptInvalid: emptyPromptShots.has(shot.index),
      durationWarning: durationWarnings?.get(shotKey),
      exec: runtime?.exec,
      onGenerate: runtime ? () => onGenerateRow(runtime) : undefined,
      onRegenerate: runtime ? () => onRegenerateRow(runtime) : undefined,
      onRecover: runtime && onRecoverRow ? () => onRecoverRow(runtime) : undefined,
      onToggleLock: runtime ? () => onToggleLockRow(runtime) : undefined,
      // 画幅（v6 §2.4.1）：生效值与"是不是覆盖"都从 storyboardShotScope 单源读，
      // 行自己不判"读哪一个"。
      aspect: effectiveShotAspect(plan, shot),
      // 媒体盒是**表级**的（§2.4 修订 · 2026-09-06 用户反馈四）：全表同画幅时盒=该画幅，
      // 混排时全表共用一只盒、画面 letterbox 居中。行自己按画幅算就会一行一个尺寸。
      frameBox: tableBox,
      onResolveOverride: runtime?.exec.node ? (field: string, action: 'adopt' | 'discard') => resolveStoryboardOverride(runtime.exec.node!.id, field, action, { plan, shot, change: onChange }) : undefined,
      onChangeAspect: (next: string | null) => onChange(setShotAspectOverride(plan, pos, next)),
      skipped: skippedShotIds?.has(shotKey) ?? false,
      onToggleSkip: onToggleSkip ? () => onToggleSkip(shotKey) : undefined,
      // 行首复选框 = 选中（以前是「本次跳过」）；跳过住行菜单与多选浮条。
      onToggleSelect: () => toggleSelectedAt(pos),
      variants: variantsByShotId?.[shotKey] ?? [],
      adoptedVariantId: adoptedVariantByShotId?.[shotKey],
      onAdoptVariant: runtime && props_onAdoptVariant ? (variant: ShotVariant) => props_onAdoptVariant(runtime, variant) : undefined,
      onDeleteVariant: runtime && props_onDeleteVariant ? (variant: ShotVariant) => props_onDeleteVariant(runtime, variant) : undefined,
      outputTag: outputTagByShotId?.[shotKey],
      onAgentHandoff: runtime && onAgentHandoff ? () => onAgentHandoff([runtime]) : undefined,
      onInsertAbove: () => onChange(insertShotAt(plan, pos)),
      onInsertBelow: () => onChange(insertShotAt(plan, pos + 1)),
      selected: selectedShotIds.has(selectKeyOf(shot)),
      onSelect: (event: React.MouseEvent) => onSelectShot(pos, event),
      scenes: plan.scenes ?? [],
      onCopy: () => onChange(duplicateShotAt(plan, pos)),
      onMoveToScene: (sceneId: string) => onChange(updateShotAt(plan, pos, sceneId === NO_SCENE_VALUE ? (() => { const { sceneId: _removed, ...rest } = shot; return rest })() : { sceneId })),
      onKeyboardMove: (direction: -1 | 1) => {
        const target = pos + direction
        if (target >= 0 && target < plan.shots.length) onChange(moveShot(plan, pos, target))
      },
      onKeyboardFocus: (direction: -1 | 1) => {
        const target = visiblePositions[visiblePositions.indexOf(pos) + direction]
        if (target === undefined) return
        focusAdjacentShot(plan.shots[target])
      },
      onOpenPreview: runtime ? () => onOpenPreviewRow(runtime) : undefined,
      onLocateInCanvas: runtime && onLocateInCanvasRow ? () => onLocateInCanvasRow(runtime) : undefined,
      onRerunFreshRefs: runtime ? () => onRerunFreshRefsRow(runtime) : undefined,
      draggable: true as const,
      isDragOver: overIndex === pos && dragIndex !== null && dragIndex !== pos,
      onDragStart: () => setDragIndex(pos),
      onDragOver: (event: React.DragEvent) => { event.preventDefault(); setOverIndex(pos) },
      onDrop: () => {
        if (dragIndex !== null && dragIndex !== pos) onChange(moveShot(plan, dragIndex, pos))
        setDragIndex(null); setOverIndex(null)
      },
      onDragEnd: () => { setDragIndex(null); setOverIndex(null) },
      onUpdate: (patch: PlanShotPatch) => {
        if (typeof patch.prompt !== 'string') {
          onChange(updateShotAt(plan, pos, patch))
          return
        }
        const next = updateShotPrompt(plan, pos, patch.prompt)
        onChange(updateShotAt(next, pos, { promptSegments: patch.promptSegments }))
      },
      onRemove: () => {
        const runtimeForRow = rows[pos]
        if (runtimeForRow?.exec.resultUrl) {
          void confirmDialog({ title: t('storyboardEditor.rowActions.deleteTitle'), message: t('storyboardEditor.rowActions.deleteMessage'), confirmLabel: t('storyboardEditor.row.delete'), danger: true }).then((ok) => { if (ok) onDeleteSelected([runtimeForRow]) })
        } else onDeleteSelected([runtimeForRow])
      },
      // 只套 params：模型/模式归「全部镜头」批量条管（一功能一个家，§1.5.2）
      onApplyParamsToAll: () => onChange({ ...plan, shots: plan.shots.map((s) => ({ ...s, params: resolveShotParams(plan, shot) })) }),
      storyboardProfile: storyboardProfileForKey(plan.profileKey),
    }
    // C1：有 anchorCards 时走 ShotRowWithMention（含 useShotMentionSource），
    // 缺省（编辑器没提供）退回 StoryboardShotRow（无 @ 面板）。
    const rowProps = commonRowProps
    const row = anchorCards
      ? (
        <ShotRowWithMention
          rowProps={rowProps}
          anchorCards={anchorCards}
          pool={mentionPool}
        />
      )
      : <StoryboardShotRow {...rowProps} />
    return (
      <>
        {pos > 0 ? (
          <div className="group/insert relative h-1.5" data-storyboard-insert-line={shot.index}>
            <button
              type="button"
              onClick={() => onChange(insertShotAt(plan, pos))}
              aria-label={t('storyboardEditor.selection.insert')}
              // 也在 focus-within 时现身：只靠 hover 的话键盘用户永远看不见这个入口。
              className="absolute inset-x-2 top-1/2 z-[2] hidden h-5 -translate-y-1/2 items-center justify-center rounded-full border border-nomi-ink-30 bg-nomi-paper text-nomi-accent group-hover/insert:flex group-focus-within/insert:flex focus:flex"
            >
              <IconPlus size={13} stroke={1.8} />
            </button>
          </div>
        ) : null}
        {row}
      </>
    )
  }

  return (
    // 外层不裁切：多选浮条是 `sticky`，它的「粘住」只认**最近的滚动祖先**——放在 `overflow-hidden` 的框里，
    // 那个框就成了它的滚动祖先（却永远不滚），浮条于是不跟屏、只在滚到最底时才出现。
    // 所以圆角描边的裁切只留给行区这一层，浮条挂在它外面、直接坐在分镜页的滚动区里。
    <div>
    <div
      ref={tableRef}
      className="border border-nomi-line rounded-nomi overflow-hidden"
      data-storyboard-rows="true"
      data-storyboard-row-count={visiblePositions.length}
      onFocusCapture={(event) => {
        // 焦点进了哪一项就钉住哪一项（走 portal 的弹层不在行的 DOM 里：找不到项就保持原来的钉子）。
        const key = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-storyboard-item]')?.dataset.storyboardItem : undefined
        if (key && key !== focusedItemKey) setFocusedItemKey(key)
      }}
    >
      <StoryboardRowDensityContext.Provider value={density}>
      <StoryboardPromptHistoryContext.Provider value={promptHistoryRef.current}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index]
            if (!item) return null
            const placeholder = item.kind === 'shot' && mountPlan.light.has(item.key)
            return (
              <div
                key={virtualItem.key}
                // 占位不量：它的高度就是这一项已知的尺寸（量过的实测或估高），换成完整行时再量，不让列表来回跳。
                ref={placeholder ? undefined : virtualizer.measureElement}
                data-index={virtualItem.index}
                data-storyboard-item={item.key}
                // 行间 1px 分隔线：每一项自己画上沿（绝对定位的项不再是一串相邻兄弟，`divide-y` 管不到）；
                // 项里「插入线 + 行」之间那条仍由 divide-y 画——与窗口化之前逐像素同一组线。
                className={cn('absolute left-0 top-0 w-full divide-y divide-nomi-line-soft', virtualItem.index > 0 && 'border-t border-nomi-line-soft', placeholder && 'overflow-hidden')}
                style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)`, ...(placeholder ? { height: virtualItem.size } : {}) }}
              >
                {item.kind === 'head'
                  ? renderHead(item.group, item.groupIndex)
                  : placeholder
                    ? <StoryboardShotRowPlaceholder shot={item.shot} frameBox={tableBox} onActivate={(target) => activatePlaceholder(item.shot, target)} />
                    : renderShot(item.shot, item.pos)}
              </div>
            )
          })}
        </div>
      </StoryboardPromptHistoryContext.Provider>
      </StoryboardRowDensityContext.Provider>
    </div>
    {selectedRows.length > 0 ? (
        <StoryboardSelectionToolbar
          selectedCount={selectedRows.length}
          modelGroups={selectedModelGroups}
          onGenerate={() => onGenerateSelected(selectedRows)}
          onApplyModel={applyModelToSelected}
          onApplyParam={applyParamToSelected}
          allSkipped={allSelectedSkipped}
          onSkip={onToggleSkip ? skipSelected : undefined}
          onDelete={() => { void deleteSelected() }}
          onClear={() => setSelectedShotIds(new Set())}
          onAgentHandoff={onAgentHandoff ? () => onAgentHandoff(selectedRows) : undefined}
        />
      ) : null}
    </div>
  )
}
