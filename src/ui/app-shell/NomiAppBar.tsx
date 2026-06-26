import React from 'react'
import { IconBooks, IconDownload, IconPhoto, IconPlugConnected, IconBulb } from '@tabler/icons-react'
import type { WorkspaceMode } from '../../workbench/workbenchStore'
import { NomiBrand, NomiStepper, WorkbenchButton } from '../../design'
import { OnboardingChecklist } from '../../workbench/onboarding/OnboardingChecklist'
import { AboutNomiPopover } from './AboutNomiPopover'
import { cn } from '../../utils/cn'

// 「素材库」点击 → 打开真实素材库面板（不再直接弹文件对话框）。
// 上传已移进面板内部，AppBar 只负责发开面板事件（仿 nomi-open-model-catalog）。
function openAssetLibrary(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-asset-library'))
}

// 「提示词库」点击 → 打开提示词库面板（仿素材库的事件驱动开法）。
function openPromptLibrary(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-prompt-library'))
}

// 「技能库」点击 → 打开技能库面板（同一套事件驱动开法）。
function openSkillLibrary(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-skill-library'))
}

type NomiAppBarProps = {
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  projectName?: string
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
  onRenameProject?: (name: string) => void
}

export default function NomiAppBar({ workspaceMode, onWorkspaceModeChange, projectName, onBackToLibrary, onOpenModelCatalog, onRenameProject }: NomiAppBarProps): JSX.Element {
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState(projectName || '未命名 Nomi 项目')
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const brandRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (!editingProjectName && projectName) setProjectTitle(projectName)
  }, [projectName, editingProjectName])

  const commitProjectTitle = React.useCallback(() => {
    setProjectTitle((value) => {
      const trimmed = value.trim() || '未命名 Nomi 项目'
      onRenameProject?.(trimmed)
      return trimmed
    })
    setEditingProjectName(false)
  }, [onRenameProject])

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
      aria-label="Nomi 工作台"
    >
      <div className={cn(
        'nomi-appbar__left',
        'inline-flex items-center gap-3 min-w-0',
        'max-[700px]:gap-0',
      )}>
        <button
          ref={brandRef}
          type="button"
          className={cn(
            'nomi-appbar__brand-btn',
            'inline-flex items-center border-0 bg-transparent p-0 cursor-pointer rounded-[var(--nomi-radius-sm)]',
            'transition-[opacity] duration-[var(--nomi-transition-fast)] hover:opacity-80',
          )}
          aria-label="关于 Nomi · 检查更新"
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((open) => !open)}
        >
          <NomiBrand />
        </button>
        {aboutOpen ? (
          <AboutNomiPopover anchorEl={brandRef.current} onClose={() => setAboutOpen(false)} />
        ) : null}
        <span
          className={cn(
            'nomi-appbar__divider',
            'w-px h-[18px] bg-workbench-border',
            'max-[700px]:hidden',
          )}
          aria-hidden="true"
        />

        {/* Breadcrumb: [项目库] › [项目名] — unified bordered container */}
        <div
          className={cn(
            'nomi-appbar__breadcrumb',
            'inline-flex items-center h-[30px]',
            'border border-workbench-border rounded-[var(--nomi-radius-sm)]',
            'bg-workbench-bg overflow-hidden min-w-0 shrink',
          )}
          role="navigation"
          aria-label="位置导航"
        >
          {onBackToLibrary ? (
            <>
              <WorkbenchButton
                className={cn(
                  'nomi-appbar__breadcrumb-seg nomi-appbar__breadcrumb-seg--lib',
                  'inline-flex items-center h-full px-2.5',
                  'border-none bg-transparent font-inherit text-body-sm',
                  'cursor-pointer whitespace-nowrap',
                  'text-[var(--nomi-ink-40)]',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                  'max-[700px]:hidden',
                )}
                aria-label="返回项目库"
                onClick={onBackToLibrary}
              >
                项目库
              </WorkbenchButton>
              <span
                className={cn(
                  'nomi-appbar__breadcrumb-arrow',
                  'text-[var(--nomi-ink-30)] text-sm leading-none select-none shrink-0',
                  'max-[700px]:hidden',
                )}
                aria-hidden="true"
              >›</span>
            </>
          ) : null}
          {editingProjectName ? (
            <input
              className={cn(
                'nomi-appbar__breadcrumb-input',
                'h-full px-2.5 border-none',
                'bg-[color-mix(in_oklch,var(--nomi-accent)_6%,var(--nomi-bg))]',
                'text-[var(--nomi-ink)] font-inherit text-body-sm',
                'outline-none min-w-[80px] max-w-[240px]',
              )}
              value={projectTitle}
              autoFocus
              aria-label="项目名称"
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

      <NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} />

      <div
        className={cn(
          'nomi-appbar__right',
          'inline-flex items-center justify-self-end gap-2 min-w-0',
          'max-[700px]:gap-1',
        )}
        role="toolbar"
        aria-label="全局操作"
      >
        {/* 上手 4 步引导入口：停靠顶栏(始终高/不遮画布)，4/4 自动消失。 */}
        <OnboardingChecklist />
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
          )}
          aria-label="打开提示词库"
          title="提示词库"
          onClick={openPromptLibrary}
        >
          <IconBulb size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>提示词库</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
          )}
          aria-label="打开技能库"
          title="技能库"
          onClick={openSkillLibrary}
        >
          <IconBooks size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>技能库</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
          )}
          aria-label="打开素材库"
          title="素材库"
          onClick={openAssetLibrary}
        >
          <IconPhoto size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>素材库</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
          )}
          aria-label="打开模型接入"
          title="模型接入"
          onClick={handleOpenModelCatalog}
        >
          <IconPlugConnected size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>模型接入</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__primary',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-80)]',
            'max-[1400px]:w-[30px] max-[1400px]:h-[30px] max-[1400px]:justify-center max-[1400px]:p-0',
          )}
          aria-label={workspaceMode === 'preview' ? '导出 MP4' : '前往预览导出'}
          title={workspaceMode === 'preview' ? '导出 MP4' : '前往预览导出'}
          onClick={() => {
            // 已在预览页 → 直接触发导出（TimelinePreview 监听此事件）；否则先跳到预览页。
            if (workspaceMode === 'preview') window.dispatchEvent(new CustomEvent('nomi-request-export'))
            else onWorkspaceModeChange('preview')
          }}
        >
          <IconDownload size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>导出</span>
        </WorkbenchButton>
      </div>
    </header>
  )
}
