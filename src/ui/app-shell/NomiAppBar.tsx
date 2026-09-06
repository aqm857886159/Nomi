import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconBrowser, IconDownload, IconPlugConnected, IconSettings } from '@tabler/icons-react'
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
import CollapsedAiChip from './CollapsedAiChip'
import { useGenerationCanvasStore } from '../../workbench/generationCanvas/store/generationCanvasStore'
import { cn } from '../../utils/cn'
import { APP_BAR_ACTION_GROUPS } from './appBarActionGroups'
import EditingLayoutMenu from '../../workbench/preview/EditingLayoutMenu'
import { requestPreviewExport } from '../../workbench/preview/previewExportRequest'

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
        'relative z-[120] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center',
        'h-[var(--workbench-topbar-height)] px-[18px]',
        'border-b border-workbench-border bg-workbench-surface',
        'max-[700px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[700px]:gap-x-1.5 max-[700px]:px-2',
      )}
      aria-label={t('appBar.workspace')}
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
              // 项目名是用户自己起的、按创建那刻的界面语言存进磁盘的内容(en 用户建的项目也可能带中文,
              // 反之亦然)——它不是 UI 文案、不该被 EN-DOM 断言网当漏译。标 data-user-content 让走查整棵豁免。
              data-user-content
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
              // 见上:项目名是用户内容(持久化的项目名),不是 UI 文案。文本与 title 都可能非当前界面语言,
              // 标 data-user-content 让 EN-DOM 断言网整棵豁免(否则 en 下一个中文项目名会被误报成漏译)。
              data-user-content
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
        {/* 剪辑面「布局」菜单（合同 §2.1/§2.2：五块开关 + 四预设，固定在顶栏，不塞进 Nomi 面板头）。
            只在预览页出现——它调的是剪辑面那五块面板，别处没有对象可调。 */}
        {workspaceMode === 'preview' ? (
          <span
            data-actions={APP_BAR_ACTION_GROUPS.layout.join(' ')}
            className={cn('nomi-appbar__group nomi-appbar__group--layout', 'inline-flex items-center gap-2.5')}
          >
            <EditingLayoutMenu />
            <span className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border')} aria-hidden="true" />
          </span>
        ) : null}

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
                    'max-[1600px]:w-[30px] max-[1600px]:h-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
                  )}
                  aria-label={t('appBar.openBrowser')}
                  onClick={openBrowser}
                >
                  {/* 顶栏操作按钮统一解剖：图标 15/1.8 + 文字，窄屏一起收成 30px 方块。 */}
                  <IconBrowser size={15} stroke={1.8} />
                  <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{t('appBar.browser')}</span>
                </WorkbenchButton>
              </AppBarActionTooltip>
            ) : null}
          </span>
          <span className={cn('nomi-appbar__divider', 'w-px h-[18px] bg-workbench-border')} aria-hidden="true" />
        </span>

        {/* 右槽互斥（视图 06）：拆解面板占槽时，让位的「生成」AI 栏收成此角标；点它还原右栏。
            只在生成区 + 拆解占槽 + AI 收起时出现，其余情况自返 null（不常驻）。 */}
        <CollapsedAiChip workspaceMode={workspaceMode} />

        {/* 配置：系统设置与模型快捷入口归在一起；二者最终落到同一张设置对话框。 */}
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
                    'max-[1600px]:w-[30px] max-[1600px]:h-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
                  )}
                  aria-label={t('settings.title')}
                  onClick={onOpenSettings}
                >
                  <IconSettings size={15} stroke={1.8} />
                  <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{t('settings.title')}</span>
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
                  'max-[1600px]:w-[30px] max-[1600px]:h-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
                )}
                aria-label={t('appBar.openModelAccess')}
                onClick={handleOpenModelCatalog}
              >
                <IconPlugConnected size={15} stroke={1.8} />
                <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{t('appBar.modelAccess')}</span>
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
              这颗在非预览页时只是**跳转**（原来却叫「导出」，点了什么也不导），故改叫「去出片」。
              到了预览页它换成真导出「导出 MP4」——合同 §2.2 把导出从预览控制条撤到顶栏右上
              （CapCut / ChatCut / OpenCut 一致），属性面板只放分辨率/质量参数、不放执行按钮。 */}
          {workspaceMode === 'preview' ? (
            <AppBarActionTooltip label={t('timelinePreview.exportMp4')}>
              <WorkbenchButton
                className={cn(
                  'nomi-appbar__primary',
                  'app-no-drag',
                  'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                  'border border-transparent rounded-[var(--nomi-radius-sm)]',
                  'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] font-inherit text-body-sm',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-[var(--nomi-ink-80)]',
                  'max-[1600px]:w-[30px] max-[1600px]:h-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
                )}
                aria-label={t('timelinePreview.exportMp4')}
                onClick={requestPreviewExport}
              >
                <IconDownload size={15} stroke={1.8} />
                <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{t('timelinePreview.exportMp4')}</span>
              </WorkbenchButton>
            </AppBarActionTooltip>
          ) : (
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
                  'max-[1600px]:w-[30px] max-[1600px]:h-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
                )}
                aria-label={t('appBar.goToProduce')}
                onClick={() => onWorkspaceModeChange('preview')}
              >
                <IconArrowRight size={15} stroke={1.8} />
                <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{t('appBar.goToProduce')}</span>
              </WorkbenchButton>
            </AppBarActionTooltip>
          )}
        </span>
        </div>
      </TooltipProvider>
    </header>
  )
}
