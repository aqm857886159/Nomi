// 全 App 同一条 40px 顶栏：应用栏与窗口栏合一（10-08 外壳拍板稿 Main / Chrome / Library 三块板）。
//
//   左：（macOS 红绿灯位）Nomi 标 ·（左栏收起时）展开左栏 · 项目名 ▾（最近项目 / 回项目库 / 新建 / 重命名）；项目库页是「项目库」
//   中：创作 | 生成 5/6 | 预览 0:26（真实进度），按整个窗口宽度居中；生成页分段右边的槽挂「画布 | 列表」（列表线的 viewSwitcher，不参与居中）
//   右：（预览页的布局 + 导出 MP4）任务 · 浏览器 · 新版本（只由更新器真状态决定）· 设置（上手没做完冒点）· Nomi 入口（项目内；最右，右留 8）·（Windows 原生窗口按钮位）
//   挤的时候按 topbarYield 的顺序让：① 导出收成图标 → ② 分段左挪、项目名变短再藏 → ③ 藏进度数字 → ④ 新版本收成点（NomiEntryTopbar 板 topbar.yield-order）。
//
// 拖窗：整条 `app-drag`，所有按钮 `app-no-drag`；双击空白最大化交给系统（titleBarOverlay / hiddenInset 都是真标题栏区域）。
// 外壳底色（--nomi-chrome）包住顶栏、左栏和工作面四周，层次靠底色、不靠分割线。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { IconArrowLeft, IconBrowser, IconChevronDown, IconChevronRight, IconDownload, IconLayoutSidebarLeftExpand, IconLoader2, IconSettings } from '@tabler/icons-react'
import {
  ICON_TIERS,
  ICON_TIER_CLASSES,
  NomiLogoMark,
  NomiStepper,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  WorkbenchMenu,
  type WorkbenchMenuNode,
} from '../../../design'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore, type WorkspaceMode } from '../../../workbench/workbenchStore'
import { TaskCenterButton } from '../../../workbench/taskCenter/TaskCenterButton'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import EditingLayoutMenu from '../../../workbench/preview/EditingLayoutMenu'
import { selectPreviewAspectRatio } from '../../../workbench/preview/previewAspectRatios'
import {
  canExportPreviewTimeline,
  isPreviewExportBusy,
  previewExportStageKey,
  requestPreviewExport,
  requestPreviewExportCancel,
  usePreviewExportState,
} from '../../../workbench/preview/previewExportRequest'
import { useLocalProjects } from '../../../workbench/library/localProjectStore'
import { useOnboardingProgress } from '../../../workbench/onboarding/onboardingProgress'
import { BAR_ICON_BUTTON } from './barIconButton'
import { DotMark } from './DotMark'
import { NomiEntryButton } from './ShellNomiEntry'
import { useNomiEntry } from './useNomiEntry'
import type { AgentFormSurface } from './agentFormStore'
import {
  resolveTopbarYield,
  topbarRoomy,
  topbarUpdateCompact,
  TOPBAR_YIELD_GAP,
  TOPBAR_YIELD_NONE,
  type TopbarYield,
  type TopbarYieldStep,
} from './topbarYield'
import { UpdatePill } from '../UpdatePill'
import { useUpdateStore } from '../updateStore'
import { SHELL_MAC_TRAFFIC_WIDTH, SHELL_TOPBAR_HEIGHT, shellChromePlatform } from '../shellGeometry'

/** 顶栏上的悬停名字（外壳级 TooltipProvider 在 header 里挂一份）。 */
function BarTooltip({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 让位此刻的结果 + 量到的两个宽（宽窗 / 窄窗、左簇让多少都从这里读）。没量过时 barWidth = ∞（全放开、胶囊放得下）。 */
type TopbarYieldState = TopbarYield & { barWidth: number; segmentWidth: number }
const YIELD_START: TopbarYieldState = { ...TOPBAR_YIELD_NONE, barWidth: Number.POSITIVE_INFINITY, segmentWidth: 0 }

const visibleWidth = (node: Element | null | undefined): number => (node ? node.getBoundingClientRect().width : 0)

/**
 * 顶栏挤的时候按顺序让（规则本身在 topbarYield，纯函数）：这里只在 ResizeObserver 回调里量一次、调一次。
 * 按内容量，不按窗口宽断点（narrow.one-threshold）；三样能收的东西（进度数字 / 导出字 / 新版本字）在「放开」时量一次省多少、记住，
 * 收起后拿记住的宽算「全放开时多宽」，来回拖窗每个阈值只翻一次（E12）。换语言 / 换页 / 左栏开合先全放开重量。
 */
function useTopbarYield(
  enabled: boolean,
  contentKey: string,
  refs: { header: React.RefObject<HTMLElement | null>; left: React.RefObject<HTMLElement | null>; segment: React.RefObject<HTMLElement | null>; toolbar: React.RefObject<HTMLElement | null> },
): TopbarYieldState {
  const [state, setState] = React.useState<TopbarYieldState>(YIELD_START)
  const stepRef = React.useRef<TopbarYieldStep>(0)
  const savings = React.useRef({ meta: 0, export: 0, update: 0 })
  // 回调里读的「此刻在用第几步」= DOM 上已经按它收过的那一步（每次提交后同步）。
  React.useLayoutEffect(() => {
    stepRef.current = state.step
  })
  React.useLayoutEffect(() => {
    const header = refs.header.current
    if (!header || typeof ResizeObserver === 'undefined') return undefined
    // 内容换了（语言 / 页 / 左栏 / 更新状态）：记住的宽作废。全记 0 只会让下一次先放开、量到真宽再收，不会收过头。
    savings.current = { meta: 0, export: 0, update: 0 }
    const measure = () => {
      const bar = header.getBoundingClientRect()
      const segment = refs.segment.current
      const toolbar = refs.toolbar.current?.getBoundingClientRect()
      if (!enabled || !segment || !toolbar || segment.getBoundingClientRect().width === 0) {
        setState((current) => (current.barWidth === bar.width && current.step === 0 && current.shift === 0 ? current : { ...TOPBAR_YIELD_NONE, barWidth: bar.width, segmentWidth: 0 }))
        return
      }
      // 能收的三样：此刻放开着就量一次省多少（进度数字与阶段名之间 gap-1.5；导出收成 28 圆；新版本字与图标之间 gap-1.5）。
      const metas = [...segment.querySelectorAll('[data-stepper-meta]')].map(visibleWidth)
      if (metas.length > 0 && metas.every((width) => width > 0)) savings.current.meta = metas.reduce((sum, width) => sum + width + 6, 0)
      const exportButton = header.querySelector('[data-shell-export]')
      if (exportButton && exportButton.getAttribute('data-shell-export-compact') !== 'true') savings.current.export = Math.max(0, visibleWidth(exportButton) - 28)
      const updateLabel = header.querySelector('[data-update-badge] [data-update-label]')
      if (updateLabel && visibleWidth(updateLabel) > 0) savings.current.update = visibleWidth(updateLabel) + 6
      // 左簇项目名全藏起时的右沿：项目菜单的箭头（名字和箭头之间 gap-1）；改名输入框时就是输入框本身。
      const menu = header.querySelector('[data-shell-project-menu]')
      const name = header.querySelector('[data-shell-project-name]')
      const leftLast = refs.left.current?.lastElementChild ?? null
      const leftMinRight = menu
        ? menu.getBoundingClientRect().right - (visibleWidth(name) > 0 ? visibleWidth(name) + 4 : 0)
        : leftLast?.getBoundingClientRect().right ?? bar.left
      const switcher = segment.querySelector('[data-shell-view-switcher-slot]')
      const switcherWidth = visibleWidth(switcher)
      const segmentWidth = segment.getBoundingClientRect().width
      const next = resolveTopbarYield({
        barWidth: bar.width,
        center: bar.left + bar.width / 2,
        rightEdge: toolbar.right,
        leftMinRight,
        segmentWidth,
        switcherWidth: switcherWidth > 0 ? switcherWidth + 8 : 0,
        toolbarWidth: toolbar.width,
        metaSaving: savings.current.meta,
        exportSaving: savings.current.export,
        updateSaving: savings.current.update,
      }, stepRef.current)
      setState((current) => (
        current.step === next.step && current.shift === next.shift && current.barWidth === bar.width && current.segmentWidth === segmentWidth
          ? current
          : { ...next, barWidth: bar.width, segmentWidth }
      ))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    if (refs.toolbar.current) observer.observe(refs.toolbar.current)
    if (refs.segment.current) observer.observe(refs.segment.current)
    return () => observer.disconnect()
  }, [enabled, contentKey, refs])
  return state
}

function openBrowser(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-browser'))
}

function ProjectMenu({
  projectId,
  projectName,
  onBackToLibrary,
  onOpenProject,
  onNewProject,
  onRenameProject,
}: {
  projectId?: string | null
  projectName: string
  onBackToLibrary?: () => void
  onOpenProject?: (projectId: string) => void
  onNewProject?: () => void
  onRenameProject?: (name: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { projects } = useLocalProjects()
  const [open, setOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [draft, setDraft] = React.useState(projectName)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [rect, setRect] = React.useState({ left: 0, top: 0, width: 0, height: 0 })
  const recent = projects.filter((project) => project.id !== projectId).slice(0, 6)
  const items: WorkbenchMenuNode[] = [
    {
      kind: 'group',
      id: 'recent',
      label: t('appShell.topbar.recentProjects'),
      items: recent.length
        ? recent.map((project) => ({ id: `project:${project.id}`, label: project.name || t('appBar.untitledProject'), onSelect: () => onOpenProject?.(project.id) }))
        : [{ id: 'none', label: t('appShell.topbar.noRecentProjects'), disabled: true, onSelect: () => undefined }],
    },
    { kind: 'separator', id: 'sep-1' },
    { id: 'library', label: t('appShell.topbar.backToLibrary'), onSelect: () => onBackToLibrary?.() },
    { id: 'new', label: t('appShell.topbar.newProject'), onSelect: () => onNewProject?.() },
    { kind: 'separator', id: 'sep-2' },
    { id: 'rename', label: t('appShell.topbar.rename'), onSelect: () => { setDraft(projectName); setRenaming(true) } },
  ]
  if (renaming) {
    const commit = () => {
      onRenameProject?.(draft.trim() || t('appBar.untitledProject'))
      setRenaming(false)
    }
    return (
      <input
        className="app-no-drag h-7 w-[220px] min-w-0 rounded-nomi-sm border border-nomi-ink-40 bg-nomi-paper px-2 text-body-sm text-nomi-ink outline-none"
        // 项目名是用户内容（按创建那刻的语言存的），不是 UI 文案：EN-DOM 断言网整棵豁免。
        data-user-content
        autoFocus
        value={draft}
        aria-label={t('appBar.projectName')}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setRenaming(false)
        }}
      />
    )
  }
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'app-no-drag inline-flex h-7 min-w-0 max-w-[260px] items-center gap-1 rounded-nomi-sm border-0 bg-transparent pl-2 pr-1.5',
          'text-body-sm font-medium text-nomi-ink transition-colors hover:bg-nomi-ink-05',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
          open && 'bg-nomi-ink-10',
        )}
        aria-label={t('appShell.topbar.projectMenu', { name: projectName })}
        aria-haspopup="menu"
        aria-expanded={open}
        title={projectName}
        data-shell-project-menu
        data-user-content
        onClick={() => {
          const box = triggerRef.current?.getBoundingClientRect()
          if (box) setRect({ left: box.left, top: box.top, width: box.width, height: box.height })
          setOpen((value) => !value)
        }}
        onDoubleClick={() => { setDraft(projectName); setRenaming(true) }}
      >
        {/* 左簇内容宽 ≤ 89（放不下两个字加省略号）时整段藏起，只留箭头；全名在 title / aria-label（WindowNarrow 板 topbar.project-name-hide）。 */}
        <span className="min-w-0 truncate [@container_(max-width:89px)]:hidden" data-shell-project-name>{projectName}</span>
        <IconChevronDown size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      </button>
      <WorkbenchMenu open={open} onOpenChange={setOpen} anchorRect={rect} items={items} className="min-w-[220px] max-w-[320px]" ariaLabel={t('appShell.topbar.projectMenu', { name: projectName })} />
    </>
  )
}

type ShellTopBarProps = {
  /** null = 项目库页（没有项目名、没有阶段切换、没有任务、没有 Nomi 入口）。 */
  workspaceMode: WorkspaceMode | null
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void
  /** 阶段段后面的真实进度（「生成 5/6」「预览 0:26」）；宿主算好传进来。 */
  stepperMeta?: Partial<Record<'creation' | 'generation' | 'preview', string>>
  projectId?: string | null
  projectName?: string
  onBackToLibrary?: () => void
  onOpenProject?: (projectId: string) => void
  onNewProject?: () => void
  onRenameProject?: (name: string) => void
  onOpenSettings?: () => void
  /** 生成页「画布 | 列表」切换（列表线提供；列表视图还没进 main）。 */
  viewSwitcher?: React.ReactNode
  /** 左栏收起时，左端多一颗「展开左栏」。 */
  railCollapsed?: boolean
  onExpandRail?: () => void
  /** 这一页 Agent 的形态归哪一面（项目内才有）：右簇最右那颗 Nomi 入口开 / 收的就是它（NomiEntryTopbar 板 nomi-entry）。 */
  agentSurface?: AgentFormSurface
  /** 整窗平级页（如连接 APIMart 大页）左端返回面包屑：`← <originLabel> › <currentLabel>`。 */
  peerBreadcrumb?: {
    originLabel: string
    currentLabel: string
    onBack: () => void
  }
}

/** 右簇最右：Nomi 入口（收起的面板只从这里叫回）。悬停名字和读屏同一句。 */
function NomiEntrySlot({ surface, roomy }: { surface: AgentFormSurface; roomy: boolean }): JSX.Element {
  const entry = useNomiEntry(surface, roomy)
  return (
    <BarTooltip label={entry.label}>
      <NomiEntryButton look={entry.look} pendingCount={entry.pendingCount} capsuleText={entry.capsuleText} open={entry.open} label={entry.label} onClick={entry.toggle} />
    </BarTooltip>
  )
}

export function ShellTopBar({
  workspaceMode,
  onWorkspaceModeChange,
  stepperMeta,
  projectId,
  projectName,
  onBackToLibrary,
  onOpenProject,
  onNewProject,
  onRenameProject,
  onOpenSettings,
  viewSwitcher,
  railCollapsed = false,
  onExpandRail,
  agentSurface,
  peerBreadcrumb,
}: ShellTopBarProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const platform = shellChromePlatform()
  const onboarding = useOnboardingProgress()
  const previewExport = usePreviewExportState()
  const exportBusy = isPreviewExportBusy(previewExport.status)
  const exportCancelling = exportBusy && Boolean(previewExport.cancelling)
  const exportContent = useWorkbenchStore(useShallow(state => workspaceMode === 'preview'
    ? { tracks: state.timeline.tracks, textClips: state.timeline.textClips } : null))
  const exportEmpty = exportContent !== null && !canExportPreviewTimeline(exportContent)
  const exportDisabled = exportEmpty || exportCancelling
  const exportAspect = useWorkbenchStore(selectPreviewAspectRatio)
  const exportResolution = useWorkbenchStore(state => state.exportResolution)
  const exportStageKey = previewExportStageKey(previewExport.status)
  const exportPercent = Math.round(previewExport.progress * 100)
  const exportLabel = exportCancelling
    ? t('timelinePreview.exportCancelling')
    : exportBusy && exportStageKey
      ? t('timelinePreview.exportBusyReason', { stage: t(exportStageKey), percent: exportPercent })
      : t('timelinePreview.exportMp4')
  const exportText = exportCancelling
    ? t('timelinePreview.exportCancelling')
    : exportBusy
      ? t('timelinePreview.exporting', { percent: exportPercent })
      : t('timelinePreview.exportMp4WithResolution', { resolution: exportResolution })
  const exportTooltip = exportBusy ? exportLabel
    : exportEmpty ? t('timelinePreview.exportEmptyReason')
      : `${exportLabel} · ${exportAspect} · ${exportResolution}`
  const updateKey = useUpdateStore((state) => `${state.updater.phase}:${state.updater.errorStage ?? ''}`)
  const headerRef = React.useRef<HTMLElement | null>(null)
  const leftRef = React.useRef<HTMLDivElement | null>(null)
  const segmentRef = React.useRef<HTMLDivElement | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const measureRefs = React.useMemo(() => ({ header: headerRef, left: leftRef, segment: segmentRef, toolbar: toolbarRef }), [])
  const hasSegment = Boolean(workspaceMode && onWorkspaceModeChange)
  const yieldState = useTopbarYield(hasSegment, `${i18n.language}|${workspaceMode ?? ''}|${railCollapsed ? 1 : 0}|${updateKey}|${exportBusy ? 1 : 0}|${exportResolution}`, measureRefs)
  const { step, shift } = yieldState
  const exportCompact = step >= 1
  // 左簇右沿跟着分段走：离分段左沿留 12（第 ② 步分段左挪，项目名跟着变短，放不下两个字就藏）。没量过时用旧的保守宽。
  const leftMaxWidth = hasSegment && yieldState.segmentWidth > 0 && Number.isFinite(yieldState.barWidth)
    ? Math.max(0, yieldState.barWidth / 2 - yieldState.segmentWidth / 2 - TOPBAR_YIELD_GAP - shift)
    : undefined
  return (
    <header
      ref={headerRef}
      className="app-drag relative grid w-full select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-nomi-chrome text-nomi-ink"
      style={{
        height: SHELL_TOPBAR_HEIGHT,
        // Windows：原生窗口按钮（titleBarOverlay）盖在右端，按 env(titlebar-area-*) 让位；不支持时让位 0。
        paddingRight: platform === 'win' ? 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' : undefined,
      }}
      aria-label={t('appShell.topbar.aria')}
      data-shell-topbar
      data-shell-platform={platform}
      data-shell-yield-step={hasSegment ? step : undefined}
    >
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div
          ref={leftRef}
          className={cn('flex h-full min-w-0 items-center gap-1.5 [container-type:inline-size]', hasSegment && leftMaxWidth === undefined && 'max-w-[calc(50%-136px)]')}
          style={{ paddingLeft: platform === 'mac' ? SHELL_MAC_TRAFFIC_WIDTH : 12, maxWidth: leftMaxWidth }}
          data-shell-left-cluster
        >
          <span className="app-no-drag inline-flex shrink-0 items-center" data-shell-brand aria-hidden="true">
            <NomiLogoMark size={20} />
          </span>
          {railCollapsed && onExpandRail ? (
            <BarTooltip label={t('appShell.rail.expand')}>
              <button type="button" className={BAR_ICON_BUTTON} aria-label={t('appShell.rail.expand')} onClick={onExpandRail} data-shell-rail-expand>
                <IconLayoutSidebarLeftExpand aria-hidden="true" />
              </button>
            </BarTooltip>
          ) : null}
          {workspaceMode ? (
            <ProjectMenu
              projectId={projectId}
              projectName={projectName || t('appBar.untitledProject')}
              onBackToLibrary={onBackToLibrary}
              onOpenProject={onOpenProject}
              onNewProject={onNewProject}
              onRenameProject={onRenameProject}
            />
          ) : peerBreadcrumb ? (
            <>
              <button
                type="button"
                onClick={peerBreadcrumb.onBack}
                data-apimart-back
                className={cn(
                  'app-no-drag inline-flex h-[26px] min-w-0 max-w-[240px] cursor-pointer items-center gap-1 rounded-field border-0 bg-transparent pl-1.5 pr-2 font-inherit text-body-sm font-normal text-nomi-ink-60 transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
                  ICON_TIER_CLASSES.corner,
                )}
              >
                <IconArrowLeft className="shrink-0" aria-hidden="true" />
                <span className="truncate">{peerBreadcrumb.originLabel}</span>
              </button>
              <span className="inline-flex min-w-0 items-center gap-1.5 [@container_(max-width:180px)]:hidden">
                <IconChevronRight {...ICON_TIERS.corner} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
                <span className="min-w-0 truncate text-body-sm font-semibold text-nomi-ink" data-shell-here>
                  {peerBreadcrumb.currentLabel}
                </span>
              </span>
            </>
          ) : (
            <span className="truncate pl-0.5 text-body-sm font-medium text-nomi-ink" data-shell-here>{t('appShell.topbar.library')}</span>
          )}
        </div>

        {/* 创作 | 生成 | 预览 按**整个窗口宽度**居中（拍板稿 Main 板），不是在左右两簇之间剩下的空间里居中：
            绝对定位 + left-1/2，参照的是整条顶栏的 padding box（含 Windows 原生窗口按钮让位的 padding），
            两簇宽度怎么变、有没有更新胶囊都不推它；只有挤到第 ② 步才整体往左挪（shift）。生成页的「画布 | 列表」挂在分段右边的槽里，
            同样绝对定位、不占位、不参与居中（槽在分段的右沿之外），跟着分段一起挪。 */}
        {workspaceMode && onWorkspaceModeChange ? (
          <div ref={segmentRef} className="absolute left-1/2 top-0 flex h-full -translate-x-1/2 items-center" style={shift > 0 ? { left: `calc(50% - ${shift}px)` } : undefined} data-shell-stage-center>
            <span className="app-no-drag"><NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} meta={stepperMeta} hideMeta={step >= 3} /></span>
            {workspaceMode === 'generation' ? (
              <span className="app-no-drag absolute left-full top-1/2 ml-2 -translate-y-1/2" data-shell-view-switcher-slot>{viewSwitcher}</span>
            ) : null}
          </div>
        ) : null}

        <div ref={toolbarRef} className="flex h-full shrink-0 items-center justify-end gap-0.5 justify-self-end pr-2" role="toolbar" aria-label={t('appBar.globalActions')}>
          {workspaceMode === 'preview' ? (
            <>
              <span className="app-no-drag"><EditingLayoutMenu /></span>
              <BarTooltip label={exportTooltip}>
                <span
                  className={cn('app-no-drag inline-flex', exportDisabled && 'cursor-not-allowed')}
                  tabIndex={exportDisabled ? 0 : undefined}
                >
                  <WorkbenchButton
                    className={cn(
                      'app-no-drag mx-1 inline-flex h-7 items-center gap-1.5 rounded-pill border-0 text-caption font-medium',
                      'bg-nomi-ink text-nomi-paper hover:bg-nomi-ink-80 disabled:pointer-events-none disabled:opacity-60',
                      // 第 ① 步：同一颗钮只留图标（28 圆），悬停出字（外面那层 BarTooltip）。
                      exportCompact ? 'w-7 justify-center px-0' : 'px-3',
                    )}
                    iconTier="corner"
                    aria-label={exportLabel}
                    aria-busy={exportCancelling || undefined}
                    data-export-busy={exportBusy ? 'true' : 'false'}
                    data-export-cancelling={exportCancelling ? 'true' : undefined}
                    data-shell-export
                    data-shell-export-compact={exportCompact ? 'true' : undefined}
                    disabled={exportDisabled}
                    onClick={exportBusy ? requestPreviewExportCancel : requestPreviewExport}
                  >
                    {exportBusy ? <IconLoader2 className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <IconDownload />}
                    <span className={cn('whitespace-nowrap', exportCompact && 'hidden')}>{exportText}</span>
                  </WorkbenchButton>
                </span>
              </BarTooltip>
            </>
          ) : null}
          {workspaceMode ? (
            <TaskCenterButton
              projectId={projectId}
              onRevealNode={(nodeId) => {
                onWorkspaceModeChange?.('generation')
                useGenerationCanvasStore.getState().selectNodes([nodeId])
              }}
            />
          ) : null}
          <BarTooltip label={t('appBar.browser')}>
            <button type="button" className={BAR_ICON_BUTTON} aria-label={t('appBar.openBrowser')} onClick={openBrowser} data-shell-browser>
              <IconBrowser aria-hidden="true" />
            </button>
          </BarTooltip>
          {/* 更新胶囊（#1135）：只由主进程更新状态决定出不出；窄于 900 或挤到第 ④ 步收成带点图标，点开的弹窗由 NomiStudioApp 全局挂一份。 */}
          <UpdatePill host="appbar" compact={topbarUpdateCompact(yieldState.barWidth, step)} />
          {onOpenSettings ? (
            <BarTooltip label={onboarding.active ? t('appShell.topbar.settingsDot', { count: onboarding.total - onboarding.doneCount }) : t('settings.title')}>
              <button type="button" className={BAR_ICON_BUTTON} aria-label={t('settings.title')} onClick={onOpenSettings} data-shell-settings>
                <IconSettings aria-hidden="true" />
                {onboarding.active ? <DotMark /> : null}
              </button>
            </BarTooltip>
          ) : null}
          {workspaceMode && agentSurface ? <NomiEntrySlot surface={agentSurface} roomy={topbarRoomy(yieldState.barWidth)} /> : null}
        </div>
      </TooltipProvider>
    </header>
  )
}
