import React from 'react'
import {
  IconBooks,
  IconBulb,
  IconFolder,
  IconFolderSearch,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconTags,
  IconWorld,
} from '@tabler/icons-react'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../design'
import { type ProjectCategory } from '../project/projectCategories'
import { useWorkbenchStore } from '../workbenchStore'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'

const CategoryTree = lazyWithChunkBoundary('分类面板', () => import('../sidebar/CategoryTree'))
const PromptLibraryContent = lazyWithChunkBoundary('提示词库', () =>
  import('../promptLibrary/PromptLibraryPanel').then((module) => ({
    default: module.PromptLibraryContent,
  })),
)
const SkillLibraryContent = lazyWithChunkBoundary('技能库', () =>
  import('../skillLibrary/SkillLibraryPanel').then((module) => ({
    default: module.SkillLibraryContent,
  })),
)
const AssetLibraryContent = lazyWithChunkBoundary('素材库', () =>
  import('../assets/AssetLibraryPanel').then((module) => ({
    default: module.AssetLibraryContent,
  })),
)
import AssetFinderPanel from '../assets/autoGroup/AssetFinderPanel'

type Props = {
  categories?: ProjectCategory[]
  projectId?: string | null
}

type ProjectSidebarTab = 'find' | 'categories' | 'prompt-library' | 'skill-library' | 'asset-library'

const PROJECT_SIDEBAR_COLLAPSED_WIDTH = 60
const PROJECT_SIDEBAR_EXPANDED_WIDTH = 300
const PROJECT_LIBRARY_SIDEBAR_EXPANDED_WIDTH = 500
const PROJECT_SIDEBAR_RAIL_WIDTH = 60

const RAIL_BUTTON_CLASS = cn(
  'grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent',
  'cursor-pointer text-nomi-ink-40 transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

// 方案A（2026-07-12 拍板）：rail 图标下带微字，治「一列孤图标认不出」；tooltip 保留全名。
const RAIL_ITEM_BUTTON_CLASS = cn(
  'flex w-11 flex-col items-center gap-0.5 rounded-nomi-sm border-0 bg-transparent py-1.5',
  'cursor-pointer text-nomi-ink-40 transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

const RAIL_BUTTON_ACTIVE_CLASS = 'bg-nomi-ink text-nomi-paper shadow-nomi-sm'

const PANEL_ICON_BUTTON_CLASS = cn(
  'grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent',
  'cursor-pointer text-nomi-ink-40 transition-[background,border-color,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
)

function sidebarPanelTitle(tab: ProjectSidebarTab): string {
  if (tab === 'find') return '找素材'
  if (tab === 'categories') return '分类'
  if (tab === 'prompt-library') return '提示词库'
  if (tab === 'skill-library') return '技能库'
  return '素材库'
}

function isLibraryTab(tab: ProjectSidebarTab): boolean {
  return tab === 'prompt-library' || tab === 'skill-library' || tab === 'asset-library'
}

export default function ProjectExplorerSidebar({ categories, projectId = null }: Props): JSX.Element {
  const [tab, setTab] = React.useState<ProjectSidebarTab>('asset-library')
  const [createCategoryNonce, setCreateCategoryNonce] = React.useState(0)
  const collapsed = useWorkbenchStore((s) => s.sidebarCollapsed)
  const toggle = useWorkbenchStore((s) => s.toggleSidebarCollapsed)
  const setSidebarCollapsed = useWorkbenchStore((s) => s.setSidebarCollapsed)

  // 加号 = 新建一个顶层分类（建子组改走分类行右键「新建子组」）。
  const handleAddCategory = React.useCallback(() => {
    setTab('categories')
    setSidebarCollapsed(false)
    setCreateCategoryNonce((n) => n + 1)
  }, [setSidebarCollapsed])

  const selectTab = React.useCallback((nextTab: ProjectSidebarTab) => {
    if (!collapsed && tab === nextTab) {
      setSidebarCollapsed(true)
      return
    }
    setTab(nextTab)
    setSidebarCollapsed(false)
  }, [collapsed, setSidebarCollapsed, tab])

  // picker 的「浏览全部 →」→ 展开侧栏 + 切到素材库（弹层只做快速取）。
  React.useEffect(() => {
    const open = () => {
      setTab('asset-library')
      setSidebarCollapsed(false)
    }
    window.addEventListener('nomi-open-files-panel', open)
    return () => window.removeEventListener('nomi-open-files-panel', open)
  }, [setSidebarCollapsed])

  const railItems = React.useMemo(
    () => [
      {
        id: 'asset-library' as const,
        label: '素材库',
        icon: IconFolder,
      },
      {
        id: 'find' as const,
        label: '找素材',
        icon: IconFolderSearch,
      },
      {
        id: 'categories' as const,
        label: '分类',
        railLabel: '分类',
        icon: IconTags,
      },
    ],
    [],
  )

  const libraryRailItems = React.useMemo(
    () => [
      {
        id: 'prompt-library' as const,
        label: '提示词库',
        railLabel: '提示词',
        icon: IconBulb,
      },
      {
        id: 'skill-library' as const,
        label: '技能库',
        railLabel: '技能',
        icon: IconBooks,
      },
    ],
    [],
  )

  const panelTitle = sidebarPanelTitle(tab)
  const expandedWidth = isLibraryTab(tab) ? PROJECT_LIBRARY_SIDEBAR_EXPANDED_WIDTH : PROJECT_SIDEBAR_EXPANDED_WIDTH

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex h-full min-h-0 shrink-0 overflow-hidden border-r border-nomi-line bg-nomi-paper text-nomi-ink',
        'transition-[width] duration-150 ease-out',
      )}
      style={{ width: collapsed ? PROJECT_SIDEBAR_COLLAPSED_WIDTH : expandedWidth }}
      aria-label="项目资源管理器"
    >
      <TooltipProvider delayDuration={180} skipDelayDuration={80}>
        <div
          className="flex shrink-0 flex-col items-center border-r border-nomi-line-soft bg-nomi-paper px-2 py-3"
          style={{ width: PROJECT_SIDEBAR_RAIL_WIDTH }}
        >
          <nav className="flex flex-1 flex-col items-center gap-2.5 pt-1" aria-label="项目侧栏导航">
            {railItems.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(RAIL_ITEM_BUTTON_CLASS, active && RAIL_BUTTON_ACTIVE_CLASS)}
                      aria-label={item.label}
                      aria-pressed={active}
                      onClick={() => selectTab(item.id)}
                    >
                      <Icon size={20} stroke={1.85} aria-hidden="true" />
                      <span className="text-micro leading-none">{item.railLabel ?? item.label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            })}
            <div className="my-1 h-px w-6 shrink-0 bg-nomi-line-soft" aria-hidden="true" />
            {libraryRailItems.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(RAIL_ITEM_BUTTON_CLASS, active && RAIL_BUTTON_ACTIVE_CLASS)}
                      aria-label={item.label}
                      aria-pressed={active}
                      onClick={() => selectTab(item.id)}
                    >
                      <Icon size={20} stroke={1.85} aria-hidden="true" />
                      <span className="text-micro leading-none">{item.railLabel ?? item.label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
          <div className="flex flex-col items-center gap-2 pb-1">
            <Tooltip>
              <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                className={RAIL_BUTTON_CLASS}
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand size={20} stroke={1.85} aria-hidden="true" />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={20} stroke={1.85} aria-hidden="true" />
                )}
              </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? '展开侧栏' : '收起侧栏'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {!collapsed ? (
          <section className="relative flex min-w-0 flex-1 flex-col bg-nomi-paper" aria-label={panelTitle}>
            <>
              <header className="flex h-12 shrink-0 items-center border-b border-nomi-line-soft px-3">
                  <h2 className="m-0 min-w-0 flex-1 truncate text-body-sm font-bold leading-none text-nomi-ink">
                    {panelTitle}
                  </h2>
                  {/* M0 捕捞窗入口原本住 AssetLibraryPanel 自己的 header——侧栏 showHeader={false}
                      画瘦头后必须在这里补位，否则整个功能不可达（PR#36 合入走查抓出的回归）。 */}
                  {tab === 'asset-library' ? (
                    <button
                      type="button"
                      className={cn(
                        'mr-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-nomi-line bg-nomi-paper px-3',
                        'cursor-pointer text-caption font-semibold text-nomi-ink transition-[background] duration-[var(--nomi-transition-fast)]',
                        'hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:opacity-40',
                      )}
                      disabled={!projectId}
                      aria-label="网页捕捞"
                      title="打开捕捞窗：右键网页图片即可存进素材库"
                      onClick={() => {
                        if (projectId) void getDesktopBridge()?.browserCapture?.open({ projectId })
                      }}
                    >
                      <IconWorld size={13} stroke={2} aria-hidden="true" />
                      网页捕捞
                    </button>
                  ) : null}
                  {tab === 'categories' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleAddCategory}
                          className={PANEL_ICON_BUTTON_CLASS}
                          aria-label="新建分类"
                        >
                          <IconPlus size={18} stroke={1.85} aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">新建分类</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={toggle}
                        className={PANEL_ICON_BUTTON_CLASS}
                        aria-label="收起侧栏"
                      >
                        <IconLayoutSidebarLeftCollapse size={18} stroke={1.85} aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">收起侧栏</TooltipContent>
                  </Tooltip>
              </header>
              {tab === 'find' ? (
                  <AssetFinderPanel />
                ) : tab === 'categories' ? (
                  <React.Suspense fallback={null}>
                    <CategoryTree categories={categories} createCategoryNonce={createCategoryNonce} />
                  </React.Suspense>
                ) : tab === 'prompt-library' ? (
                  <React.Suspense fallback={null}>
                    <PromptLibraryContent active compact showHeader={false} />
                  </React.Suspense>
                ) : tab === 'skill-library' ? (
                  <React.Suspense fallback={null}>
                    <SkillLibraryContent active compact showHeader={false} />
                  </React.Suspense>
                ) : (
                  <React.Suspense fallback={null}>
                    <AssetLibraryContent projectId={projectId} compact showHeader={false} />
                  </React.Suspense>
              )}
            </>
          </section>
        ) : null}
      </TooltipProvider>
    </aside>
  )
}
