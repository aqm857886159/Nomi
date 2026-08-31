import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconBrowser, IconPlugConnected, IconSettings } from '@tabler/icons-react'
import type { WorkspaceMode } from '../../workbench/workbenchStore'
import {
  NomiBrand,
  NomiStepper,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
} from '../../design'
import { OnboardingChecklist } from '../../workbench/onboarding/OnboardingChecklist'
import { TaskCenterButton } from '../../workbench/taskCenter/TaskCenterButton'
import { useGenerationCanvasStore } from '../../workbench/generationCanvas/store/generationCanvasStore'
import { cn } from '../../utils/cn'
import { handleWindowTitlebarDoubleClick } from './windowTitlebarDoubleClick'
import { APP_BAR_ACTION_GROUPS } from './appBarActionGroups'

// 平台分流：win32 下品牌/关于 + 上手清单都让位给 WorkbenchShell 的自绘标题栏（windowbar），
// 本栏不重复渲染；非 win32（mac/Linux）保持原生窗口，品牌与清单仍住这里——两平台都有家、不丢失、不重复。
const isWindows = window.nomiDesktop?.platform === 'win32'

function openBrowser(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-browser'))
}

function AppBarActionTooltip({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

type NomiAppBarProps = {
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  projectName?: string
  projectId?: string | null
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
  onOpenSettings?: () => void
  onRenameProject?: (name: string) => void
}

export default function NomiAppBar({
  workspaceMode,
  onWorkspaceModeChange,
  projectName,
  projectId,
  onBackToLibrary,
  onOpenModelCatalog,
  onOpenSettings,
  onRenameProject,
}: NomiAppBarProps): JSX.Element {
  const { t } = useTranslation()
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState(projectName || t('appBar.untitledProject'))

  React.useEffect(() => {
    if (!editingProjectName && projectName) setProjectTitle(projectName)
  }, [projectName, editingProjectName])

  const commitProjectTitle = React.useCallback(() => {
    setProjectTitle((value) => {
      const trimmed = value.trim() || t('appBar.untitledProject')
      onRenameProject?.(trimmed)
      return trimmed
    })
    setEditingProjectName(false)
  }, [onRenameProject, t])

  const handleOpenModelCatalog = React.useCallback(() => {
    onOpenModelCatalog?.()
  }, [onOpenModelCatalog])

  return (
    <header
      className={cn(
        'nomi-appbar',
        isWindows && 'app-drag',
        'relative z-[120] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center',
        'h-[var(--workbench-topbar-height)] px-[18px]',
        'border-b border-workbench-border bg-workbench-surface',
        'max-[700px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[700px]:gap-x-1.5 max-[700px]:px-2',
      )}
      aria-label={t('appBar.workspace')}
      onDoubleClick={handleWindowTitlebarDoubleClick}
    >
      <div
        className={cn(
          'nomi-appbar__left',
          'app-no-drag',
          'inline-flex items-center justify-self-start gap-3 min-w-0',
          'max-[700px]:gap-0',
        )}
      >
        {!isWindows ? (
          <>
            {/* 品牌回归纯品牌（§1.5 归位）：过去这颗钮一钮四用（品牌 + 上手手册 + 明暗 + 检查更新），
                四件事已各自归位到设置「关于」/「通用」，这里只剩标识、不再是功能入口。 */}
            <span className={cn('nomi-appbar__brand', 'inline-flex items-center')}>
              <NomiBrand />
            </span>
            <span
              className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border', 'max-[700px]:hidden')}
              aria-hidden="true"
            />
          </>
        ) : null}

        {/* Breadcrumb: [项目库] › [项目名] — unified bordered container */}
        <div
          className={cn(
            'nomi-appbar__breadcrumb',
            'inline-flex items-center h-[30px]',
            'border border-workbench-border rounded-[var(--nomi-radius-sm)]',
            'bg-workbench-bg overflow-hidden min-w-0 shrink',
          )}
          role="navigation"
          aria-label={t('appBar.locationNavigation')}
        >
          {onBackToLibrary ? (
            <>
              <WorkbenchButton
                className={cn(
                  'nomi-appbar__breadcrumb-seg nomi-appbar__breadcrumb-seg--lib',
                  'app-no-drag',
                  'inline-flex items-center h-full px-2.5',
                  'border-none bg-transparent font-inherit text-body-sm',
                  'cursor-pointer whitespace-nowrap',
                  'text-[var(--nomi-ink-40)]',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                  'max-[700px]:hidden',
                )}
                aria-label={t('appBar.backToLibrary')}
                onClick={onBackToLibrary}
              >
                {t('appBar.projectLibrary')}
              </WorkbenchButton>
              <span
                className={cn(
                  'nomi-appbar__breadcrumb-arrow',
                  'text-[var(--nomi-ink-30)] text-sm leading-none select-none shrink-0',
                  'max-[700px]:hidden',
                )}
                aria-hidden="true"
              >
                ›
              </span>
            </>
          ) : null}
          {editingProjectName ? (
            <input
              className={cn(
                'nomi-appbar__breadcrumb-input',
                'app-no-drag',
                'h-full px-2.5 border-none',
                'bg-[color-mix(in_oklch,var(--nomi-accent)_6%,var(--nomi-bg))]',
                'text-[var(--nomi-ink)] font-inherit text-body-sm',
                'outline-none min-w-[80px] max-w-[240px]',
              )}
              value={projectTitle}
              autoFocus
              aria-label={t('appBar.projectName')}
              onBlur={commitProjectTitle}
              onChange={(event) => setProjectTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitProjectTitle()
                if (event.key === 'Escape') setEditingProjectName(false)
              }}
            />
          ) : (
            <WorkbenchButton
              className={cn(
                'nomi-appbar__breadcrumb-seg nomi-appbar__breadcrumb-seg--name',
                'app-no-drag',
                'inline-flex items-center h-full px-2.5',
                'border-none bg-transparent font-inherit text-body-sm',
                'cursor-pointer whitespace-nowrap',
                'text-[var(--nomi-ink-80)] max-w-[200px] overflow-hidden text-ellipsis',
                'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              )}
              title={projectTitle}
              onClick={() => setEditingProjectName(true)}
            >
              {projectTitle}
            </WorkbenchButton>
          )}
        </div>
      </div>

      <div className="app-no-drag">
        <NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} />
      </div>

      {/* 右簇按用户意图分组：任务｜创作辅助｜配置｜唯一主行动。 */}
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div
          className={cn(
            'nomi-appbar__right',
            'app-no-drag',
            'inline-flex items-center justify-self-end gap-2.5 min-w-0',
            'max-[700px]:gap-1.5',
          )}
          role="toolbar"
          aria-label={t('appBar.globalActions')}
        >
        {/* 任务：入口常驻；空闲时安静显示，有任务时由按钮表达数量和状态。 */}
        <span
          className={cn(
            'nomi-appbar__group nomi-appbar__group--tasks',
            'inline-flex items-center gap-2.5',
          )}
        >
          <TaskCenterButton
            projectId={projectId}
            onRevealNode={(nodeId) => {
              onWorkspaceModeChange('generation')
              useGenerationCanvasStore.getState().selectNodes([nodeId])
            }}
          />
          <span className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border')} aria-hidden="true" />
        </span>

        {/* 创作辅助：上手与浏览器。win32 下二者住自绘窗口栏，这组自然隐藏。 */}
        <span
          data-actions={APP_BAR_ACTION_GROUPS.assist.join(' ')}
          className={cn(
            'nomi-appbar__group nomi-appbar__group--assist',
            'inline-flex items-center gap-2.5',
            '[&:not(:has(button))]:hidden',
          )}
        >
          <span className="inline-flex items-center gap-1">
            {!isWindows ? <OnboardingChecklist /> : null}
            {!isWindows ? (
              <AppBarActionTooltip label={t('appBar.browser')}>
                <WorkbenchButton
                  className={cn(
                    'nomi-appbar__ghost',
                    'app-no-drag',
                    'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                    'border border-transparent rounded-[var(--nomi-radius-sm)]',
                    'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
                    'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                    'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                    'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
                  )}
                  aria-label={t('appBar.openBrowser')}
                  onClick={openBrowser}
                >
                  {/* 顶栏操作按钮统一解剖：图标 15/1.8 + 文字，窄屏一起收成 30px 方块。 */}
                  <IconBrowser size={15} stroke={1.8} />
                  <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.browser')}</span>
                </WorkbenchButton>
              </AppBarActionTooltip>
            ) : null}
          </span>
          <span className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border')} aria-hidden="true" />
        </span>

        {/* 配置：系统设置与模型接入归在一起，不再让设置看起来像浏览器的附属按钮。 */}
        <span
          data-actions={APP_BAR_ACTION_GROUPS.config.join(' ')}
          className={cn(
            'nomi-appbar__group nomi-appbar__group--config',
            'inline-flex items-center gap-2.5',
            '[&:not(:has(button))]:hidden',
          )}
        >
          <span className="inline-flex items-center gap-1">
            {onOpenSettings ? (
              <AppBarActionTooltip label={t('settings.title')}>
                <WorkbenchButton
                  className={cn(
                    'nomi-appbar__ghost',
                    'app-no-drag',
                    'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                    'border border-transparent rounded-[var(--nomi-radius-sm)]',
                    'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
                    'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                    'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                    'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
                  )}
                  aria-label={t('settings.title')}
                  onClick={onOpenSettings}
                >
                  <IconSettings size={15} stroke={1.8} />
                  <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('settings.title')}</span>
                </WorkbenchButton>
              </AppBarActionTooltip>
            ) : null}
            <AppBarActionTooltip label={t('appBar.modelAccess')}>
              <WorkbenchButton
                className={cn(
                  'nomi-appbar__ghost',
                  'app-no-drag',
                  'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                  'border border-transparent rounded-[var(--nomi-radius-sm)]',
                  'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                  'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
                )}
                aria-label={t('appBar.openModelAccess')}
                onClick={handleOpenModelCatalog}
              >
                <IconPlugConnected size={15} stroke={1.8} />
                <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.modelAccess')}</span>
              </WorkbenchButton>
            </AppBarActionTooltip>
          </span>
          <span className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border')} aria-hidden="true" />
        </span>

        {/* 主动作：这里只放去出片。 */}
        <span
          data-actions={APP_BAR_ACTION_GROUPS.primary.join(' ')}
          className="nomi-appbar__group nomi-appbar__group--primary inline-flex items-center"
        >
          {/* 「导出」拆成两个诚实的词（§1.5「去重」+ 一功能一个家）：
              这颗在非预览页时只是**跳转**（原来却叫「导出」，点了什么也不导），故改叫「去出片」；
              到了预览页整颗隐藏 —— 那里控制条的「导出 MP4」才是真导出、且是唯一入口。 */}
          {workspaceMode !== 'preview' ? (
            <AppBarActionTooltip label={t('appBar.goToProduce')}>
              <WorkbenchButton
                className={cn(
                  'nomi-appbar__primary',
                  'app-no-drag',
                  'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                  'border border-transparent rounded-[var(--nomi-radius-sm)]',
                  'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] font-inherit text-body-sm',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-[var(--nomi-ink-80)]',
                  'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
                )}
                aria-label={t('appBar.goToProduce')}
                onClick={() => onWorkspaceModeChange('preview')}
              >
                <IconArrowRight size={15} stroke={1.8} />
                <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.goToProduce')}</span>
              </WorkbenchButton>
            </AppBarActionTooltip>
          ) : null}
        </span>
        </div>
      </TooltipProvider>
    </header>
  )
}
