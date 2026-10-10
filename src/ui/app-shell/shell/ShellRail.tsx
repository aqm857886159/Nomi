// 左栏：60px（图标 + 11px 字），创作 / 生成 / 预览三面同一条（10-08 外壳拍板稿 Main / CreationDoc / Chrome 三块板）。
//
//   这个项目的：文稿（创作内容树）· 目录（原「分组」= CategoryTree，能力原样）· 素材 · 流程
//   所有项目共用：Skill · 提示词
//   底部：收起左栏（收起后只剩顶栏里一颗「展开左栏」）
//
// 点一项 = 从左栏右侧浮出一张抽屉卡（浮在内容上、不挤画布；点空白 / 再点同一项 / Esc 收起；右缘可拖宽）。
// 抽屉用 Mantine Drawer（无遮罩，画布照常可点、素材可直接拖进画布）+ @mantine/hooks useClickOutside。
// 项目库页不放左栏（Skill / 提示词在项目库是左上页签）。左栏不放任何「我在哪」的信息（项目名只在顶栏）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@mantine/core'
import { useClickOutside, useWindowEvent } from '@mantine/hooks'
import { IconBooks, IconBulb, IconFileText, IconFolder, IconLayoutSidebarLeftCollapse, IconListTree, IconPlus, IconRoute } from '@tabler/icons-react'
import { NOMI_OVERLAY_Z_INDEX, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { lazyWithChunkBoundary } from '../../chunkBoundary'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import DocumentListSidebar from '../../../workbench/creation/DocumentListSidebar'
import { SHELL_ASSET_DRAWER_WIDTH, SHELL_DRAWER_WIDTH, SHELL_RAIL_WIDTH, SHELL_TOPBAR_HEIGHT } from '../shellGeometry'
import { useShellLayoutStore, type ShellDrawerItem } from './shellLayoutStore'

const CategoryTree = lazyWithChunkBoundary('i18n:sidebar.categoryPanel', () => import('../../../workbench/sidebar/CategoryTree'))
const PromptLibraryContent = lazyWithChunkBoundary('i18n:sidebar.promptLibrary', () =>
  import('../../../workbench/promptLibrary/PromptLibraryPanel').then((module) => ({ default: module.PromptLibraryContent })))
const SkillLibraryContent = lazyWithChunkBoundary('i18n:sidebar.skillLibrary', () =>
  import('../../../workbench/skillLibrary/SkillLibraryPanel').then((module) => ({ default: module.SkillLibraryContent })))
const AssetLibraryContent = lazyWithChunkBoundary('i18n:sidebar.assetLibrary', () =>
  import('../../../workbench/assets/AssetLibraryPanel').then((module) => ({ default: module.AssetLibraryContent })))
const PreviewShotGrid = lazyWithChunkBoundary('i18n:previewSource.aria', () =>
  import('../../../workbench/preview/PreviewSourcePanel').then((module) => ({ default: module.ShotGrid })))
const WorkflowLibraryContent = lazyWithChunkBoundary('i18n:sidebar.workflowLibrary', () =>
  import('../../../workbench/library/WorkflowLibraryContent').then((module) => ({ default: module.WorkflowLibraryContent })))

const PROJECT_ITEMS: readonly { id: ShellDrawerItem; icon: typeof IconFolder }[] = [
  { id: 'docs', icon: IconFileText },
  { id: 'catalog', icon: IconListTree },
  { id: 'assets', icon: IconFolder },
  { id: 'flows', icon: IconRoute },
]
const SHARED_ITEMS: readonly { id: ShellDrawerItem; icon: typeof IconFolder }[] = [
  { id: 'skills', icon: IconBooks },
  { id: 'prompts', icon: IconBulb },
]

/** 抽屉卡离左栏 4px、离顶栏 4px、离窗口下缘 12px（CreationDoc 板 .drw）。 */
const DRAWER_INSET = { left: SHELL_RAIL_WIDTH + 4, top: SHELL_TOPBAR_HEIGHT + 4, bottom: 12 } as const

/** 每一项的全名与左栏短字（写成字面键，i18n 键引用门岗看得见）。 */
function railText(t: (key: string) => string, id: ShellDrawerItem): { label: string; short: string } {
  switch (id) {
    case 'docs': return { label: t('appShell.rail.docs'), short: t('appShell.rail.docsShort') }
    case 'catalog': return { label: t('appShell.rail.catalog'), short: t('appShell.rail.catalogShort') }
    case 'assets': return { label: t('appShell.rail.assets'), short: t('appShell.rail.assetsShort') }
    case 'flows': return { label: t('appShell.rail.flows'), short: t('appShell.rail.flowsShort') }
    case 'skills': return { label: t('appShell.rail.skills'), short: t('appShell.rail.skillsShort') }
    case 'prompts': return { label: t('appShell.rail.prompts'), short: t('appShell.rail.promptsShort') }
  }
}

function RailButton({ id, icon: Icon, active, onClick }: { id: ShellDrawerItem; icon: typeof IconFolder; active: boolean; onClick: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { label, short } = railText(t, id)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex size-12 shrink-0 flex-col items-center justify-center gap-[3px] rounded-panel border-0 p-0',
            'cursor-pointer transition-[background,color] duration-nomi-fast ease-nomi-fast',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
            active ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink',
          )}
          aria-label={label}
          aria-pressed={active}
          data-shell-rail-item={id}
          onClick={onClick}
        >
          <Icon size={18} stroke={1.5} aria-hidden="true" />
          {/* 英文短字可能比两个汉字宽：一行放不下就省略，全名在 tooltip 与 aria-label 里。 */}
          <span className="max-w-[46px] truncate text-micro leading-[13px]">{short}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function DrawerBody({ item, projectId, createGroupNonce }: { item: ShellDrawerItem; projectId: string | null; createGroupNonce: number }): JSX.Element {
  const { t } = useTranslation()
  const categories = useWorkbenchStore((state) => state.categories)
  // 剪辑页：「目录」抽屉最上面是可拖进时间轴 / 点击追加的已出片镜头（同剪辑页左栏「镜头」页签那一格），
  // 「素材」带音频、按时间轴用途（同剪辑页左栏「素材」页签）。协调裁决第 32 项。
  const editing = useWorkbenchStore((state) => state.workspaceMode === 'preview')
  return (
    <React.Suspense fallback={null}>
      {item === 'catalog' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {editing ? (
            <section className="border-b border-nomi-line-soft pb-1" aria-label={t('previewSource.tabs.shots')} data-shell-drawer-shots>
              <div className="px-4 pb-1 text-micro font-medium text-nomi-ink-40">{t('previewSource.tabs.shots')}</div>
              <PreviewShotGrid />
            </section>
          ) : null}
          <CategoryTree categories={categories} createCategoryNonce={createGroupNonce} />
        </div>
      )
        : item === 'docs' ? <DocumentListSidebar />
          : item === 'assets' ? (editing
            ? <AssetLibraryContent projectId={projectId} compact showHeader={false} includeAudio usageContext="timeline" />
            : <AssetLibraryContent projectId={projectId} compact showHeader={false} />)
            : item === 'flows' ? <WorkflowLibraryContent projectId={projectId} compact showHeader={false} />
              : item === 'skills' ? <SkillLibraryContent active compact showHeader={false} />
                : <PromptLibraryContent active compact showHeader={false} />}
    </React.Suspense>
  )
}

/** 抽屉内容区的无障碍名：各库沿用原来的面板名；文稿 / 目录用左栏名。 */
function drawerPanelLabel(t: (key: string) => string, item: ShellDrawerItem): string {
  if (item === 'assets') return t('sidebar.assetLibrary')
  if (item === 'flows') return t('sidebar.workflowLibrary')
  if (item === 'skills') return t('sidebar.skillLibrary')
  if (item === 'prompts') return t('sidebar.promptLibrary')
  return railText(t, item).label
}

/** 抽屉右缘的拖宽把手（沿用旧探索栏的 pointer-capture 写法，搬过来，不另造）。 */
function DrawerResizeHandle({ item, width }: { item: ShellDrawerItem; width: number }): JSX.Element {
  const { t } = useTranslation()
  const setDrawerWidth = useShellLayoutStore((state) => state.setDrawerWidth)
  const drag = React.useRef<{ startX: number; startW: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize')}
      tabIndex={0}
      className="group absolute inset-y-0 right-0 z-10 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
      onPointerDown={(event) => {
        drag.current = { startX: event.clientX, startW: width }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (drag.current) setDrawerWidth(item, drag.current.startW + (event.clientX - drag.current.startX))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          setDrawerWidth(item, width + (event.key === 'ArrowRight' ? 16 : -16))
        }
      }}
      data-shell-drawer-resize
    >
      <span className={cn('h-8 w-[3px] rounded-full transition-colors', dragging ? 'bg-nomi-accent' : 'bg-transparent group-hover:bg-nomi-ink-20 group-focus-visible:bg-nomi-accent')} />
    </div>
  )
}

export function ShellRail({ projectId }: { projectId: string | null }): JSX.Element | null {
  const { t } = useTranslation()
  const collapsed = useShellLayoutStore((state) => state.railCollapsed)
  const setCollapsed = useShellLayoutStore((state) => state.setRailCollapsed)
  const drawerWidths = useShellLayoutStore((state) => state.drawerWidth)
  const addWorkbenchDocument = useWorkbenchStore((state) => state.addWorkbenchDocument)
  const [open, setOpen] = React.useState<ShellDrawerItem | null>(null)
  const [createGroupNonce, setCreateGroupNonce] = React.useState(0)
  const [railNode, setRailNode] = React.useState<HTMLElement | null>(null)
  const [drawerNode, setDrawerNode] = React.useState<HTMLElement | null>(null)
  // 点空白收起；左栏自己的点击由「再点同一项」处理，不算外面。
  // 抽屉里点出的菜单 / 弹窗（portal 到 body）不算外面：它们挂着 Radix / Mantine 的弹层属性。
  useClickOutside((event) => {
    const target = event.target as Element | null
    if (target?.closest?.('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper], .mantine-Popover-dropdown')) return
    setOpen(null)
  }, null, [railNode, drawerNode])

  // Esc 收抽屉——但抽屉上面还叠着别的弹层（素材全屏预览、确认卡…）时，这一下 Esc 归那一层，抽屉不跟着关
  // （#1136 复核实测：在素材抽屉里双击开全屏预览，按 Esc 预览和抽屉一起没了）。所以不用 Drawer 自带的 closeOnEscape。
  useWindowEvent('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return
    const ownDialog = drawerNode?.closest('[role="dialog"]') ?? null
    const otherLayer = [...document.querySelectorAll('[role="dialog"], [role="menu"]')].some((node) => node !== ownDialog && !ownDialog?.contains(node))
    if (!otherLayer) setOpen(null)
  })

  // 切项目 = 收起抽屉（旧探索栏「切项目收起左栏」那一条的新家）。
  React.useEffect(() => { setOpen(null) }, [projectId])

  // 现役入口照旧能打开对应抽屉：素材 picker 的「浏览全部 →」、Agent / Skill 选择器的「去 Skill 库」。
  React.useEffect(() => {
    const openAssets = () => { setCollapsed(false); setOpen('assets') }
    const openSkills = () => { setCollapsed(false); setOpen('skills') }
    window.addEventListener('nomi-open-files-panel', openAssets)
    window.addEventListener('nomi-open-skill-library', openSkills)
    return () => {
      window.removeEventListener('nomi-open-files-panel', openAssets)
      window.removeEventListener('nomi-open-skill-library', openSkills)
    }
  }, [setCollapsed])

  if (collapsed) return null
  const toggle = (item: ShellDrawerItem) => setOpen((current) => (current === item ? null : item))
  const width = open ? drawerWidths[open] ?? (open === 'assets' ? SHELL_ASSET_DRAWER_WIDTH : SHELL_DRAWER_WIDTH) : SHELL_DRAWER_WIDTH
  const headerAction = open === 'docs'
    ? <WorkbenchIconButton icon={<IconPlus size={16} stroke={1.5} />} label={t('creationAi.documentList.newDocumentAria')} size="sm" onClick={() => addWorkbenchDocument()} />
    : open === 'catalog'
      ? <WorkbenchIconButton icon={<IconPlus size={16} stroke={1.5} />} label={t('sidebar.newGroup')} size="sm" onClick={() => setCreateGroupNonce((n) => n + 1)} />
      : null
  return (
    <>
      <nav
        ref={setRailNode}
        className="flex h-full flex-col items-center bg-nomi-chrome pb-2.5 pt-1.5"
        style={{ width: SHELL_RAIL_WIDTH }}
        aria-label={t('appShell.rail.aria')}
        data-shell-rail
      >
        <TooltipProvider delayDuration={180} skipDelayDuration={80}>
          <div className="flex flex-col items-center gap-1" role="group" aria-label={t('appShell.rail.projectGroup')} data-shell-rail-group="project">
            {PROJECT_ITEMS.map((item) => <RailButton key={item.id} {...item} active={open === item.id} onClick={() => toggle(item.id)} />)}
          </div>
          <div className="my-2 h-px w-6 shrink-0 bg-nomi-line" aria-hidden="true" />
          <div className="flex flex-col items-center gap-1" role="group" aria-label={t('appShell.rail.sharedGroup')} data-shell-rail-group="shared">
            {SHARED_ITEMS.map((item) => <RailButton key={item.id} {...item} active={open === item.id} onClick={() => toggle(item.id)} />)}
          </div>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60 transition-colors hover:bg-nomi-ink-10 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent"
                aria-label={t('appShell.rail.collapse')}
                onClick={() => { setOpen(null); setCollapsed(true) }}
                data-shell-rail-collapse
              >
                <IconLayoutSidebarLeftCollapse size={18} stroke={1.5} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('appShell.rail.collapse')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </nav>
      <Drawer
        opened={open !== null}
        onClose={() => setOpen(null)}
        position="left"
        size={width}
        withOverlay={false}
        withCloseButton={false}
        trapFocus={false}
        lockScroll={false}
        closeOnEscape={false}
        // 层级合同（overlayLayers.ts）：抽屉是浮在内容上的面板（floatingPanel 4000），不是对话框——主题给 Drawer 的默认层级是
        // dialog（9100），会把素材全屏预览（applicationModal 9000）和抽屉里点出的菜单压在下面（#1136 复核实测）。
        zIndex={NOMI_OVERLAY_Z_INDEX.floatingPanel}
        transitionProps={{ transition: 'slide-right', duration: 160 }}
        classNames={{
          inner: 'pointer-events-none',
          content: 'pointer-events-auto relative flex flex-col overflow-hidden rounded-nomi-lg bg-nomi-paper shadow-nomi-lg ring-1 ring-nomi-line-soft',
          body: 'flex min-h-0 flex-1 flex-col p-0',
        }}
        styles={{
          inner: { top: DRAWER_INSET.top, left: DRAWER_INSET.left, bottom: DRAWER_INSET.bottom, height: 'auto' },
          content: { height: '100%', maxHeight: '100%', flex: `0 0 ${width}px` },
        }}
        aria-label={open ? railText(t, open).label : undefined}
      >
        <div ref={setDrawerNode} className="flex min-h-0 flex-1 flex-col" data-shell-drawer={open ?? undefined}>
          <header className="flex h-11 shrink-0 items-center gap-1.5 pl-4 pr-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-body-sm font-semibold text-nomi-ink">{open ? railText(t, open).label : ''}</h2>
            {headerAction}
          </header>
          {/* 内容区沿用各库原来的面板名当无障碍名（素材库 / 流程库…）：外壳只搬容器，不改内容的身份。 */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={open ? drawerPanelLabel(t, open) : undefined}>
            {open ? <DrawerBody item={open} projectId={projectId} createGroupNonce={createGroupNonce} /> : null}
          </section>
          {open ? <DrawerResizeHandle item={open} width={width} /> : null}
        </div>
      </Drawer>
    </>
  )
}
