import React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <span
      className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-pill bg-nomi-accent-soft px-1.5 text-micro font-semibold leading-none text-nomi-accent max-[1400px]:hidden"
      aria-label={t('appBar.assetCount', { count })}
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
  const { t } = useTranslation()
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState(projectName || t('appBar.untitledProject'))
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const brandRef = React.useRef<HTMLButtonElement | null>(null)
  const assetCount = useGlobalBrowserAssetCount()

  React.useEffect(() => {
    if (!editingProjectName && projectName) setProjectTitle(projectName)
    if (!editingProjectName && !projectName) setProjectTitle(t('appBar.untitledProject'))
  }, [projectName, editingProjectName, t])

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
            <button
              ref={brandRef}
              type="button"
              className={cn(
                'nomi-appbar__brand-btn',
                'app-no-drag',
                'inline-flex items-center border-0 bg-transparent p-0 cursor-pointer rounded-[var(--nomi-radius-sm)]',
                'transition-[opacity] duration-[var(--nomi-transition-fast)] hover:opacity-80',
              )}
              aria-label={t('appBar.aboutAndUpdate')}
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

      <div
        className={cn(
          'nomi-appbar__right',
          'app-no-drag',
          'inline-flex items-center justify-self-end gap-2 min-w-0',
          'max-[700px]:gap-1',
        )}
        role="toolbar"
        aria-label={t('appBar.globalActions')}
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
              aria-label={t('appBar.openBrowser')}
              title={t('appBar.browser')}
              onClick={openBrowser}
            >
              {/* 顶栏操作按钮统一解剖：图标 15/1.8 + 文字，窄屏一起收成 30px 方块。 */}
              <IconBrowser size={15} stroke={1.8} />
              <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.browser')}</span>
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
              aria-label={t('appBar.openAssetBox')}
              title={t('appBar.assetBox')}
              onClick={(event) => {
                dispatchGlobalAssetPopoverOpen(true, getGlobalAssetPopoverAnchorRect(event.currentTarget))
              }}
            >
              <IconBox size={15} stroke={1.7} aria-hidden="true" />
              <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.assetBox')}</span>
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
          aria-label={t('appBar.openModelAccess')}
          title={t('appBar.modelAccess')}
          onClick={handleOpenModelCatalog}
        >
          <IconPlugConnected size={15} stroke={1.8} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.modelAccess')}</span>
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
          aria-label={workspaceMode === 'preview' ? t('appBar.exportMp4') : t('appBar.goToPreviewExport')}
          title={workspaceMode === 'preview' ? t('appBar.exportMp4') : t('appBar.goToPreviewExport')}
          onClick={() => {
            // 已在预览页 → 直接触发导出（TimelinePreview 监听此事件）；否则先跳到预览页。
            if (workspaceMode === 'preview') window.dispatchEvent(new CustomEvent('nomi-request-export'))
            else onWorkspaceModeChange('preview')
          }}
        >
          <IconDownload size={15} stroke={1.8} />
          <span className={cn('nomi-appbar__action-text', 'max-[1400px]:hidden')}>{t('appBar.export')}</span>
        </WorkbenchButton>
      </div>
    </header>
  )
}
