import React from 'react'
import { IconDownload, IconPhoto, IconPlugConnected } from '@tabler/icons-react'
import type { WorkspaceMode } from '../../workbench/workbenchStore'
import { NomiBrand, NomiStepper, WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'

type NomiAppBarProps = {
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  projectName?: string
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
  onRenameProject?: (name: string) => void
}

export default function NomiAppBar({ workspaceMode, onWorkspaceModeChange, projectName, onBackToLibrary, onOpenModelCatalog, onRenameProject }: NomiAppBarProps): JSX.Element {
  const assetInputRef = React.useRef<HTMLInputElement>(null)
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState(projectName || '未命名 Nomi 项目')

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

  const handleAssetFilesSelected = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []).filter((file) => file.type.startsWith('image/'))
    event.currentTarget.value = ''
    if (!files.length) return
    onWorkspaceModeChange('generation')
    void import('../../workbench/generationCanvasV2/adapters/assetImportAdapter')
      .then(({ importImageFilesToGenerationCanvas }) => {
        void importImageFilesToGenerationCanvas(files, {
          basePosition: { x: 120, y: 90 },
        })
      })
      .catch((error) => {
        console.error('image import failed', error)
      })
  }, [onWorkspaceModeChange])

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
        <NomiBrand />
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
                  'border-none bg-transparent font-inherit text-[13px]',
                  'cursor-pointer whitespace-nowrap',
                  'text-[var(--nomi-ink-50)]',
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
                'text-[var(--nomi-ink)] font-inherit text-[13px]',
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
                'border-none bg-transparent font-inherit text-[13px]',
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
        <input
          ref={assetInputRef}
          className={cn(
            'nomi-appbar__asset-input',
            'absolute w-px h-px overflow-hidden opacity-0 pointer-events-none',
          )}
          type="file"
          accept="image/*"
          multiple
          aria-label="图片素材文件选择器"
          onChange={handleAssetFilesSelected}
        />
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-[13px]',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[700px]:w-[30px] max-[700px]:h-[30px] max-[700px]:justify-center max-[700px]:p-0',
          )}
          aria-label="打开图片素材导入"
          title="素材库"
          onClick={() => assetInputRef.current?.click()}
        >
          <IconPhoto size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[700px]:hidden')}>素材库</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-[13px]',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[700px]:w-[30px] max-[700px]:h-[30px] max-[700px]:justify-center max-[700px]:p-0',
          )}
          aria-label="打开模型接入"
          title="模型接入"
          onClick={handleOpenModelCatalog}
        >
          <IconPlugConnected size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[700px]:hidden')}>模型接入</span>
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__primary',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] font-inherit text-[13px]',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-80)]',
            'max-[700px]:w-[30px] max-[700px]:h-[30px] max-[700px]:justify-center max-[700px]:p-0',
          )}
          aria-label="前往预览导出"
          title="导出"
          onClick={() => onWorkspaceModeChange('preview')}
        >
          <IconDownload size={15} stroke={1.7} />
          <span className={cn('nomi-appbar__action-text', 'max-[700px]:hidden')}>导出</span>
        </WorkbenchButton>
      </div>
    </header>
  )
}
