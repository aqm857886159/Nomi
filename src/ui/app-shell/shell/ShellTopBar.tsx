// 全 App 同一条 40px 顶栏：应用栏与窗口栏合一（10-08 外壳拍板稿 Main / Chrome / Library 三块板）。
//
//   左：（macOS 红绿灯位）Nomi 标 ·（左栏收起时）展开左栏 · 项目名 ▾（最近项目 / 回项目库 / 新建 / 重命名）；项目库页是「项目库」
//   中：创作 | 生成 5/6 | 预览 0:26（真实进度）；生成页旁边一颗「画布 | 列表」（列表线挂进来的 viewSwitcher）
//   右：（预览页的布局 + 导出 MP4）任务 · 浏览器 · 新版本（只由更新器真状态决定）· 设置（上手没做完冒点）·（Windows 原生窗口按钮位）
//
// 拖窗：整条 `app-drag`，所有按钮 `app-no-drag`；双击空白最大化交给系统（titleBarOverlay / hiddenInset 都是真标题栏区域）。
// 外壳底色（--nomi-chrome）包住顶栏、左栏和工作面四周，层次靠底色、不靠分割线。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrowser, IconChevronDown, IconDownload, IconLayoutSidebarLeftExpand, IconSettings } from '@tabler/icons-react'
import { BAR_ICON_BUTTON } from './barIconButton'
import {
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

/** 顶栏图标钮一族：28px 方块、圆角 6、图标 18 / 1.5（拍板稿 .ib）。 */

/** 右上角那个小点（设置：上手没做完；窄窗下的新版本）。外圈描一圈外壳底色，压在图标上也读得出。 */
export function BarTooltip({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
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
        className="app-no-drag h-7 w-[220px] min-w-0 rounded-nomi-sm border border-nomi-accent bg-nomi-paper px-2 text-body-sm text-nomi-ink outline-none"
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
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
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
        <span className="min-w-0 truncate">{projectName}</span>
        <IconChevronDown size={14} stroke={1.5} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
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
  return (
    <header
      className="app-drag relative grid w-full select-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-nomi-chrome text-nomi-ink"
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
        <div className="flex h-full min-w-0 items-center gap-1.5 justify-self-start" style={{ paddingLeft: platform === 'mac' ? SHELL_MAC_TRAFFIC_WIDTH : 12 }}>
          <span className="app-no-drag inline-flex shrink-0 items-center" data-shell-brand aria-hidden="true">
            <NomiLogoMark size={20} />
          </span>
          {railCollapsed && onExpandRail ? (
            <BarTooltip label={t('appShell.rail.expand')}>
              <button type="button" className={BAR_ICON_BUTTON} aria-label={t('appShell.rail.expand')} onClick={onExpandRail} data-shell-rail-expand>
                <IconLayoutSidebarLeftExpand size={18} stroke={1.5} aria-hidden="true" />
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

        <div className="flex items-center gap-2">
          {workspaceMode && onWorkspaceModeChange ? (
            <span className="app-no-drag"><NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} meta={stepperMeta} /></span>
          ) : null}
          {workspaceMode === 'generation' && viewSwitcher ? <span className="app-no-drag">{viewSwitcher}</span> : null}
        </div>

        <div className="flex h-full min-w-0 items-center justify-end gap-0.5 justify-self-end pr-2" role="toolbar" aria-label={t('appBar.globalActions')}>
          {workspaceMode === 'preview' ? (
            <>
              <span className="app-no-drag"><EditingLayoutMenu /></span>
              <BarTooltip label={exportLabel}>
                <span title={exportLabel} style={{ display: 'contents' }}>
                  <WorkbenchButton
                    className={cn(
                      'app-no-drag mx-1 inline-flex h-7 items-center gap-1.5 rounded-pill border-0 px-3 text-caption font-medium',
                      'bg-nomi-ink text-nomi-paper hover:bg-nomi-ink-80 disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                    aria-label={exportLabel}
                    data-export-busy={exportBusy ? 'true' : 'false'}
                    data-shell-export
                    loading={exportBusy}
                    onClick={requestPreviewExport}
                  >
                    {exportBusy ? null : <IconDownload size={14} stroke={1.5} />}
                    <span className="whitespace-nowrap">{exportBusy ? t('timelinePreview.exporting', { percent: exportPercent }) : t('timelinePreview.exportMp4')}</span>
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
              <IconBrowser size={18} stroke={1.5} aria-hidden="true" />
            </button>
          </BarTooltip>
          {/* 更新胶囊（#1135）：只由主进程更新状态决定出不出；窄屏自收成带点图标，点开的弹窗由 NomiStudioApp 全局挂一份。 */}
          <UpdatePill host="appbar" />
          {onOpenSettings ? (
            <BarTooltip label={onboarding.active ? t('appShell.topbar.settingsDot', { count: onboarding.total - onboarding.doneCount }) : t('settings.title')}>
              <button type="button" className={BAR_ICON_BUTTON} aria-label={t('settings.title')} onClick={onOpenSettings} data-shell-settings>
                <IconSettings size={18} stroke={1.5} aria-hidden="true" />
                {onboarding.active ? <DotMark /> : null}
              </button>
            </BarTooltip>
          ) : null}
        </div>
      </TooltipProvider>
    </header>
  )
}
