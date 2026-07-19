import React from 'react'
import { IconBox, IconBrowser, IconDownload, IconPlugConnected } from '@tabler/icons-react'
import type { WorkspaceMode } from '../../workbench/workbenchStore'
import { NomiBrand, NomiStepper, WorkbenchButton } from '../../design'
import { OnboardingChecklist } from '../../workbench/onboarding/OnboardingChecklist'
import { AboutNomiPopover } from './AboutNomiPopover'
import { cn } from '../../utils/cn'
import { handleWindowTitlebarDoubleClick } from './windowTitlebarDoubleClick'
import { dispatchGlobalAssetPopoverOpen, getGlobalAssetPopoverAnchorRect } from '../browser/overlay/globalAssetPopoverEvents'
import { useGlobalBrowserAssetCount } from '../browser/assets/useGlobalBrowserAssets'

// 平台分流：win32 下品牌/关于 + 上手清单都让位给 WorkbenchShell 的自绘标题栏（windowbar），
// 本栏不重复渲染；非 win32（mac/Linux）保持原生窗口，品牌与清单仍住这里——两平台都有家、不丢失、不重复。
const isWindows = window.nomiDesktop?.platform === 'win32'

function openBrowser(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-browser'))
}

function AssetCountBadge({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null
  return (
    <span
      className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-pill bg-nomi-accent-soft px-1.5 text-micro font-semibold leading-none text-nomi-accent max-[1400px]:hidden"
      aria-label={`${count} 个素材`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

type NomiAppBarProps = {
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  projectName?: string
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
  onRenameProject?: (name: string) => void
}

export default function NomiAppBar({
  workspaceMode,
  onWorkspaceModeChange,
  projectName,
  onBackToLibrary,
  onOpenModelCatalog,
  onRenameProject,
}: NomiAppBarProps): JSX.Element {
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState(projectName || '未命名 Nomi 项目')
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const brandRef = React.useRef<HTMLButtonElement | null>(null)
  const assetCount = useGlobalBrowserAssetCount()

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
        isWindows && 'app-drag',
        'relative z-[120] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center',
        'h-[var(--workbench-topbar-height)] px-[18px]',
        'border-b border-workbench-border bg-workbench-surface',
        'max-[700px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[700px]:gap-x-1.5 max-[700px]:px-2',
      )}
      aria-label="Nomi 工作台"
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
            <button
              ref={brandRef}
              type="button"
              className={cn(
                'nomi-appbar__brand-btn',
                'app-no-drag',
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
            {aboutOpen ? <AboutNomiPopover anchorEl={brandRef.current} onClose={() => setAboutOpen(false)} /> : null}
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
          aria-label="位置导航"
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

      <div
        className={cn(
          'nomi-appbar__right',
          'app-no-drag',
          'inline-flex items-center justify-self-end gap-2 min-w-0',
          'max-[700px]:gap-1',
        )}
        role="toolbar"
        aria-label="全局操作"
      >
        {/* 上手 4 步引导入口：非 win32 住这里（始终高/不遮画布，4/4 自动消失）。
            win32 已移进 WorkbenchShell 自绘标题栏，本栏不重复渲染——两平台都有家、不丢 mac 清单。 */}
        {!isWindows ? <OnboardingChecklist /> : null}
        {!isWindows ? (
          <>
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
              aria-label="打开浏览器"
              title="浏览器"
              onClick={openBrowser}
            >
              {/* 顶栏操作按钮统一解剖：图标 15/1.8 + 文字，窄屏一起收成 30px 方块。 */}
              <IconBrowser size={15} stroke={1.8} />
              <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>浏览器</span>
            </WorkbenchButton>
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
              aria-label="打开素材盒"
              title="素材盒"
              onClick={(event) => {
                dispatchGlobalAssetPopoverOpen(true, getGlobalAssetPopoverAnchorRect(event.currentTarget))
              }}
            >
              <IconBox size={15} stroke={1.7} aria-hidden="true" />
              <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>素材盒</span>
              <AssetCountBadge count={assetCount} />
            </WorkbenchButton>
          </>
        ) : null}
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
          aria-label="打开模型接入"
          title="模型接入"
          onClick={handleOpenModelCatalog}
        >
          <IconPlugConnected size={15} stroke={1.8} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>模型接入</span>
        </WorkbenchButton>
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
          aria-label={workspaceMode === 'preview' ? '导出 MP4' : '前往预览导出'}
          title={workspaceMode === 'preview' ? '导出 MP4' : '前往预览导出'}
          onClick={() => {
            // 已在预览页 → 直接触发导出（TimelinePreview 监听此事件）；否则先跳到预览页。
            if (workspaceMode === 'preview') window.dispatchEvent(new CustomEvent('nomi-request-export'))
            else onWorkspaceModeChange('preview')
          }}
        >
          <IconDownload size={15} stroke={1.8} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>导出</span>
        </WorkbenchButton>
      </div>
    </header>
  )
}
