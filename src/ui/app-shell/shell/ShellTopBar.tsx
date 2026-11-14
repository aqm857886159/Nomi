// 全 App 同一条 40px 顶栏：应用栏与窗口栏合一（10-08 外壳拍板稿 Main / Chrome / Library 三块板）。
//
//   左：（macOS 红绿灯位）Nomi 标 ·（左栏收起时）展开左栏 · 项目名 ▾（最近项目 / 回项目库 / 新建 / 重命名）；项目库页是「项目库」
//   中：创作 | 生成 5/6 | 预览 0:26（真实进度），按整个窗口宽度居中；生成页分段右边的槽挂「画布 | 列表」（列表线的 viewSwitcher，不参与居中）
//   右：（预览页的布局 + 导出 MP4）任务 · 浏览器 · 新版本（只由更新器真状态决定）· 设置（上手没做完冒点）·（Windows 原生窗口按钮位）
//
// 拖窗：整条 `app-drag`，所有按钮 `app-no-drag`；双击空白最大化交给系统（titleBarOverlay / hiddenInset 都是真标题栏区域）。
// 外壳底色（--nomi-chrome）包住顶栏、左栏和工作面四周，层次靠底色、不靠分割线。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrowser, IconChevronDown, IconDownload, IconLayoutSidebarLeftExpand, IconSettings } from '@tabler/icons-react'
import {
  ICON_TIER_CLASSES,
  ICON_TIERS,
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
import type { WorkspaceMode } from '../../../workbench/workbenchStore'
import { TaskCenterButton } from '../../../workbench/taskCenter/TaskCenterButton'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import EditingLayoutMenu from '../../../workbench/preview/EditingLayoutMenu'
import {
  isPreviewExportBusy,
  previewExportStageKey,
  requestPreviewExport,
  usePreviewExportState,
} from '../../../workbench/preview/previewExportRequest'
import { useLocalProjects } from '../../../workbench/library/localProjectStore'
import { useOnboardingProgress } from '../../../workbench/onboarding/onboardingProgress'
import { DotMark } from './DotMark'
import { UpdatePill } from '../UpdatePill'
import { SHELL_MAC_TRAFFIC_WIDTH, SHELL_TOPBAR_HEIGHT, shellChromePlatform } from '../shellGeometry'

/** 顶栏图标钮一族：28px 方块、圆角 6（拍板稿 .ib）；图标档位由这一族自己定（条档 18 / 1.8），里面的图标不传 size / stroke。 */
const BAR_ICON_BUTTON = cn(
  'app-no-drag relative grid size-7 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0',
  'text-nomi-ink-60 transition-[background,color] duration-nomi-fast ease-nomi-fast',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
  'disabled:cursor-not-allowed disabled:opacity-50',
  ICON_TIER_CLASSES.bar,
)

/** 右上角那个小点（设置：上手没做完；窄窗下的新版本）。外圈描一圈外壳底色，压在图标上也读得出。 */
function BarTooltip({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 右簇离居中分段至少留这么宽；不足就把「导出 MP4」收成只留图标（WindowNarrow 板 topbar.export-icon）。 */
const EXPORT_SEGMENT_GAP = 12

/**
 * 「导出 MP4」放不下才收：量右簇左沿到分段右沿的空当（按内容量，不按窗口宽断点，narrow.one-threshold）。
 * 收起后按「上次完整时多宽」判断放回去够不够，来回拖窗不在临界处抖；换语言 / 文案变了先放开重量一次。
 */
function useExportCompact(
  enabled: boolean,
  labelKey: string,
  refs: { header: React.RefObject<HTMLElement | null>; segment: React.RefObject<HTMLElement | null>; toolbar: React.RefObject<HTMLElement | null>; exportButton: React.RefObject<HTMLElement | null> },
): boolean {
  const [compact, setCompact] = React.useState(false)
  const fullWidth = React.useRef(0)
  React.useLayoutEffect(() => {
    setCompact(false)
    fullWidth.current = 0
  }, [enabled, labelKey])
  React.useLayoutEffect(() => {
    const header = refs.header.current
    if (!enabled || !header || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const segment = refs.segment.current?.getBoundingClientRect()
      const toolbar = refs.toolbar.current?.getBoundingClientRect()
      const button = refs.exportButton.current?.getBoundingClientRect()
      if (!segment || !toolbar || !button || segment.width === 0) return
      const gap = toolbar.left - segment.right
      setCompact((current) => {
        if (!current) {
          fullWidth.current = button.width
          return gap < EXPORT_SEGMENT_GAP
        }
        return gap - Math.max(0, fullWidth.current - button.width) < EXPORT_SEGMENT_GAP
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    if (refs.toolbar.current) observer.observe(refs.toolbar.current)
    if (refs.segment.current) observer.observe(refs.segment.current)
    return () => observer.disconnect()
  }, [enabled, labelKey, refs])
  return enabled && compact
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
  /** null = 项目库页（没有项目名、没有阶段切换、没有任务）。 */
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
}: ShellTopBarProps): JSX.Element {
  const { t } = useTranslation()
  const platform = shellChromePlatform()
  const onboarding = useOnboardingProgress()
  const previewExport = usePreviewExportState()
  const exportBusy = isPreviewExportBusy(previewExport.status)
  const exportStageKey = previewExportStageKey(previewExport.status)
  const exportPercent = Math.round(previewExport.progress * 100)
  const exportLabel = exportBusy && exportStageKey
    ? t('timelinePreview.exportBusyReason', { stage: t(exportStageKey), percent: exportPercent })
    : t('timelinePreview.exportMp4')
  const exportText = exportBusy ? t('timelinePreview.exporting', { percent: exportPercent }) : t('timelinePreview.exportMp4')
  const headerRef = React.useRef<HTMLElement | null>(null)
  const segmentRef = React.useRef<HTMLDivElement | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const exportRef = React.useRef<HTMLButtonElement | null>(null)
  const measureRefs = React.useMemo(() => ({ header: headerRef, segment: segmentRef, toolbar: toolbarRef, exportButton: exportRef }), [])
  const exportCompact = useExportCompact(workspaceMode === 'preview', exportText, measureRefs)
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
    >
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div className="flex h-full min-w-0 max-w-[calc(50%-136px)] items-center gap-1.5 [container-type:inline-size]" style={{ paddingLeft: platform === 'mac' ? SHELL_MAC_TRAFFIC_WIDTH : 12 }} data-shell-left-cluster>
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
          ) : (
            <span className="truncate pl-0.5 text-body-sm font-medium text-nomi-ink" data-shell-here>{t('appShell.topbar.library')}</span>
          )}
        </div>

        {/* 创作 | 生成 | 预览 按**整个窗口宽度**居中（拍板稿 Main 板），不是在左右两簇之间剩下的空间里居中：
            绝对定位 + left-1/2，参照的是整条顶栏的 padding box（含 Windows 原生窗口按钮让位的 padding），
            两簇宽度怎么变、有没有更新胶囊都不推它。生成页的「画布 | 列表」挂在分段右边的槽里，同样绝对定位、
            不占位、不参与居中（槽在分段的右沿之外）。 */}
        {workspaceMode && onWorkspaceModeChange ? (
          <div ref={segmentRef} className="absolute left-1/2 top-0 flex h-full -translate-x-1/2 items-center" data-shell-stage-center>
            <span className="app-no-drag"><NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} meta={stepperMeta} /></span>
            {workspaceMode === 'generation' ? (
              <span className="app-no-drag absolute left-full top-1/2 ml-2 -translate-y-1/2" data-shell-view-switcher-slot>{viewSwitcher}</span>
            ) : null}
          </div>
        ) : null}

        <div ref={toolbarRef} className="flex h-full shrink-0 items-center justify-end gap-0.5 justify-self-end pr-2" role="toolbar" aria-label={t('appBar.globalActions')}>
          {workspaceMode === 'preview' ? (
            <>
              <span className="app-no-drag"><EditingLayoutMenu /></span>
              <BarTooltip label={exportLabel}>
                <span title={exportLabel} style={{ display: 'contents' }}>
                  <WorkbenchButton
                    ref={exportRef}
                    className={cn(
                      'app-no-drag mx-1 inline-flex h-7 items-center gap-1.5 rounded-pill border-0 text-caption font-medium',
                      'bg-nomi-ink text-nomi-paper hover:bg-nomi-ink-80 disabled:cursor-not-allowed disabled:opacity-60',
                      // 放不下：同一颗钮只留图标（28 圆），悬停出字（外面那层 BarTooltip）。
                      exportCompact ? 'w-7 justify-center px-0' : 'px-3',
                    )}
                    iconTier="corner"
                    aria-label={exportLabel}
                    data-export-busy={exportBusy ? 'true' : 'false'}
                    data-shell-export
                    data-shell-export-compact={exportCompact ? 'true' : undefined}
                    loading={exportBusy}
                    onClick={requestPreviewExport}
                  >
                    {exportBusy ? null : <IconDownload />}
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
          {/* 更新胶囊（#1135）：只由主进程更新状态决定出不出；窄屏自收成带点图标，点开的弹窗由 NomiStudioApp 全局挂一份。 */}
          <UpdatePill host="appbar" />
          {onOpenSettings ? (
            <BarTooltip label={onboarding.active ? t('appShell.topbar.settingsDot', { count: onboarding.total - onboarding.doneCount }) : t('settings.title')}>
              <button type="button" className={BAR_ICON_BUTTON} aria-label={t('settings.title')} onClick={onOpenSettings} data-shell-settings>
                <IconSettings aria-hidden="true" />
                {onboarding.active ? <DotMark /> : null}
              </button>
            </BarTooltip>
          ) : null}
        </div>
      </TooltipProvider>
    </header>
  )
}
