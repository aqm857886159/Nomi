// 新外壳的顶栏：全 App 同一条 40px（窗口栏与应用栏合一；项目库页同一条）。设计卡 docs/plan/2026-10-08-shell-redesign.md。
//
//   左：（macOS 红绿灯位）Nomi 标 · 项目名 ▾（最近项目 / 回项目库 / 新建 / 重命名）
//   中：创作 | 生成 | 预览；在「生成」时旁边一颗「画布 / 列表」切换（从内容区左上挪上来）
//   右：（预览页的布局 + 导出 MP4）任务 · 浏览器 · 「新版本」胶囊 · 设置（上手没做完冒点）·（Windows 原生按钮位）
//
// 删掉的：「去出片 →」（与预览面「导出 MP4」重复）、「接入模型」（并进设置 › 模型接入，失败卡仍直达）、
// 上手清单（并进设置）、Agent 收起角标（换成内容区右下的小球）。
// 拖窗：整条 `app-drag`，按钮 `app-no-drag`，空白处双击最大化。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrowser, IconChevronDown, IconDownload, IconSettings } from '@tabler/icons-react'
import {
  NomiBrand,
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
import { readChecklist, isChecklistDismissed } from '../../../workbench/onboarding/onboardingState'
import { handleWindowTitlebarDoubleClick } from '../windowTitlebarDoubleClick'
import { SHELL_SPACE_CHROME_PLATFORM, SHELL_TOPBAR_HEIGHT } from '../shellSpaceSpecimen'
import { ShellMacTrafficSlot, ShellWinControlsSlot } from './ShellWindowControls'

/** 顶栏按钮一族：30px 高的透明钮，图标 15 / 1.8（与今天顶栏同一套解剖）。 */
const SHELL_BAR_BUTTON = cn(
  'app-no-drag inline-flex h-7 items-center gap-1.5 px-2',
  'rounded-nomi-sm border border-transparent bg-transparent font-inherit text-body-sm text-nomi-ink-80',
  'transition-[background,color] duration-nomi-fast ease-nomi-fast hover:bg-nomi-ink-05 hover:text-nomi-ink',
)

function BarTooltip({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
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

/** 上手清单还剩几步（并进设置后，未完成时设置钮上冒一个点）。 */
function useOnboardingStepsLeft(): number {
  return React.useMemo(() => {
    if (isChecklistDismissed()) return 0
    const state = readChecklist()
    return Object.values(state).filter((done) => !done).length
  }, [])
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
  const recent = projects.filter((project) => project.id !== projectId).slice(0, 5)
  const items: WorkbenchMenuNode[] = [
    {
      kind: 'group',
      id: 'recent',
      label: t('shellSpace.topbar.recentProjects'),
      items: recent.length
        ? recent.map((project) => ({ id: `project:${project.id}`, label: project.name || t('appBar.untitledProject'), onSelect: () => onOpenProject?.(project.id) }))
        : [{ id: 'none', label: t('shellSpace.topbar.noRecentProjects'), disabled: true, onSelect: () => undefined }],
    },
    { kind: 'separator', id: 'sep-1' },
    { id: 'library', label: t('shellSpace.topbar.backToLibrary'), onSelect: () => onBackToLibrary?.() },
    { id: 'new', label: t('shellSpace.topbar.newProject'), onSelect: () => onNewProject?.() },
    { kind: 'separator', id: 'sep-2' },
    { id: 'rename', label: t('shellSpace.topbar.rename'), onSelect: () => { setDraft(projectName); setRenaming(true) } },
  ]
  if (renaming) {
    const commit = () => {
      onRenameProject?.(draft.trim() || t('appBar.untitledProject'))
      setRenaming(false)
    }
    return (
      <input
        className="app-no-drag h-7 w-[200px] rounded-nomi-sm border border-nomi-accent bg-nomi-paper px-2 text-body-sm text-nomi-ink outline-none"
        data-user-content
        autoFocus
        value={draft}
        aria-label={t('appBar.projectName')}
        onChange={(event) => setDraft(event.currentTarget.value)}
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
        className={cn(SHELL_BAR_BUTTON, 'min-w-0 max-w-[240px] font-medium text-nomi-ink')}
        aria-label={t('shellSpace.topbar.projectMenu', { name: projectName })}
        aria-haspopup="menu"
        aria-expanded={open}
        data-shell-project-menu
        data-user-content
        onClick={() => {
          const box = triggerRef.current?.getBoundingClientRect()
          if (box) setRect({ left: box.left, top: box.top, width: box.width, height: box.height })
          setOpen((value) => !value)
        }}
      >
        <span className="min-w-0 truncate">{projectName}</span>
        <IconChevronDown size={14} stroke={1.8} className="shrink-0 text-nomi-ink-40" />
      </button>
      <WorkbenchMenu open={open} onOpenChange={setOpen} anchorRect={rect} items={items} className="min-w-[220px]" ariaLabel={t('shellSpace.topbar.projectMenu', { name: projectName })} />
    </>
  )
}

type ShellTopBarProps = {
  /** null = 项目库页（没有项目名、没有阶段切换、没有任务）。 */
  workspaceMode: WorkspaceMode | null
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void
  projectId?: string | null
  projectName?: string
  onBackToLibrary?: () => void
  onOpenProject?: (projectId: string) => void
  onNewProject?: () => void
  onRenameProject?: (name: string) => void
  onOpenSettings?: () => void
  /** 生成页「画布 | 列表」切换（列表线提供）。 */
  viewSwitcher?: React.ReactNode
}

export function ShellTopBar({
  workspaceMode,
  onWorkspaceModeChange,
  projectId,
  projectName,
  onBackToLibrary,
  onOpenProject,
  onNewProject,
  onRenameProject,
  onOpenSettings,
  viewSwitcher,
}: ShellTopBarProps): JSX.Element {
  const { t } = useTranslation()
  const mac = SHELL_SPACE_CHROME_PLATFORM === 'mac'
  const stepsLeft = useOnboardingStepsLeft()
  const previewExport = usePreviewExportState()
  const exportBusy = isPreviewExportBusy(previewExport.status)
  const exportStageKey = previewExportStageKey(previewExport.status)
  const exportPercent = Math.round(previewExport.progress * 100)
  const exportLabel = exportBusy && exportStageKey
    ? t('timelinePreview.exportBusyReason', { stage: t(exportStageKey), percent: exportPercent })
    : t('timelinePreview.exportMp4')
  // 「新版本」胶囊的位（应用内更新提醒 10-08 拍板）：样张里常显，实现时由 useUpdater 的真状态决定出不出。
  const updateVersion = '0.24'
  return (
    <header
      className={cn(
        'shell-topbar app-drag relative grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center',
        'border-b border-nomi-line bg-nomi-paper text-nomi-ink',
      )}
      style={{ height: SHELL_TOPBAR_HEIGHT }}
      aria-label={t('shellSpace.topbar.aria')}
      data-shell-topbar
      onDoubleClick={handleWindowTitlebarDoubleClick}
    >
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div className="flex h-full min-w-0 items-center gap-1.5 justify-self-start">
          {mac ? <ShellMacTrafficSlot /> : null}
          <span className={cn('app-no-drag inline-flex shrink-0 items-center', mac ? 'pl-1' : 'pl-3.5')} data-shell-brand>
            <NomiBrand markSize={18} wordSize={14} />
          </span>
          {workspaceMode ? (
            <>
              <span className="mx-1 h-4 w-px shrink-0 bg-nomi-line" aria-hidden="true" />
              <ProjectMenu
                projectId={projectId}
                projectName={projectName || t('appBar.untitledProject')}
                onBackToLibrary={onBackToLibrary}
                onOpenProject={onOpenProject}
                onNewProject={onNewProject}
                onRenameProject={onRenameProject}
              />
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {workspaceMode && onWorkspaceModeChange ? (
            <div className="app-no-drag [&_.nomi-stepper]:p-0.5 [&_.nomi-stepper__step]:py-[3px]">
              <NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} />
            </div>
          ) : null}
          {/* 生成页「画布 | 列表」切换由列表那条线挂进来（列表视图还没进 main）。 */}
          {workspaceMode === 'generation' && viewSwitcher ? <span className="app-no-drag">{viewSwitcher}</span> : null}
        </div>

        <div className="flex h-full min-w-0 items-center justify-self-end" role="toolbar" aria-label={t('appBar.globalActions')}>
          <div className="flex items-center gap-0.5 pr-2">
            {workspaceMode === 'preview' ? (
              <>
                <span className="app-no-drag"><EditingLayoutMenu /></span>
                <BarTooltip label={exportLabel}>
                  <span title={exportLabel} style={{ display: 'contents' }}>
                    <WorkbenchButton
                      className={cn(SHELL_BAR_BUTTON, 'mr-1 bg-nomi-ink text-nomi-paper hover:bg-nomi-ink-80 hover:text-nomi-paper')}
                      aria-label={exportLabel}
                      loading={exportBusy}
                      onClick={requestPreviewExport}
                    >
                      {exportBusy ? null : <IconDownload size={15} stroke={1.8} />}
                      <span>{exportBusy ? t('timelinePreview.exporting', { percent: exportPercent }) : t('timelinePreview.exportMp4')}</span>
                    </WorkbenchButton>
                  </span>
                </BarTooltip>
                <span className="mx-1 h-4 w-px bg-nomi-line" aria-hidden="true" />
              </>
            ) : null}
            {workspaceMode ? (
              <span className="app-no-drag inline-flex [&_[data-task-center-trigger]]:h-7 [&_[data-task-center-trigger]]:px-2">
                <TaskCenterButton
                  projectId={projectId}
                  onRevealNode={(nodeId) => {
                    onWorkspaceModeChange?.('generation')
                    useGenerationCanvasStore.getState().selectNodes([nodeId])
                  }}
                />
              </span>
            ) : null}
            <BarTooltip label={t('appBar.browser')}>
              <button type="button" className={cn(SHELL_BAR_BUTTON, 'w-7 justify-center px-0')} aria-label={t('appBar.openBrowser')} onClick={openBrowser}>
                <IconBrowser size={15} stroke={1.8} />
              </button>
            </BarTooltip>
            <BarTooltip label={t('shellSpace.topbar.updateShort', { version: updateVersion })}>
              <button
                type="button"
                className={cn(SHELL_BAR_BUTTON, 'relative font-medium text-nomi-accent hover:text-nomi-accent max-[1100px]:w-7 max-[1100px]:justify-center max-[1100px]:px-0')}
                aria-label={t('shellSpace.topbar.updateShort', { version: updateVersion })}
                data-update-badge="available"
              >
                <IconDownload size={15} stroke={1.8} />
                <span className="tabular-nums max-[1100px]:hidden">{t('shellSpace.topbar.update', { version: updateVersion })}</span>
                <span className="absolute right-1 top-1 hidden size-1.5 rounded-full bg-nomi-accent max-[1100px]:block" aria-hidden="true" />
              </button>
            </BarTooltip>
            {onOpenSettings ? (
              <BarTooltip label={stepsLeft > 0 ? t('shellSpace.topbar.settingsDot', { count: stepsLeft }) : t('settings.title')}>
                <button type="button" className={cn(SHELL_BAR_BUTTON, 'relative w-7 justify-center px-0')} aria-label={t('settings.title')} onClick={onOpenSettings} data-shell-settings>
                  <IconSettings size={15} stroke={1.8} />
                  {stepsLeft > 0 ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-nomi-accent" data-shell-settings-dot aria-hidden="true" /> : null}
                </button>
              </BarTooltip>
            ) : null}
          </div>
          {mac ? null : <ShellWinControlsSlot />}
        </div>
      </TooltipProvider>
    </header>
  )
}
