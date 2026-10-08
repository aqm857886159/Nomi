// 新外壳的左栏：60px（图标 + 短字标签），创作 / 生成 / 预览三面同一条；项目库页只显示「所有项目共用」那组。
//
//   这个项目的：文稿（= 原创作页「创作内容」树）、镜头与分组、素材、流程
//   所有项目共用：Skill、提示词
//
// 点一项 = 从左栏右侧滑出抽屉（约 300px，素材约 500px），**浮在内容上、不挤画布**；
// 点空白 / 再点同一项 / Esc 收起。抽屉用 Mantine Drawer（不带遮罩，画布照常可点、素材可拖进画布），
// 点外收起用 @mantine/hooks 的 useClickOutside——两者都是现成件，不自写弹层与点外判断。
// 左栏不放任何「我在哪」的信息（项目名只在顶栏，避开 09-08 R3 判过的「项目名两处显示」）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@mantine/core'
import { useClickOutside } from '@mantine/hooks'
import { IconBooks, IconBulb, IconFileText, IconFolder, IconPlus, IconRoute, IconStack2, IconX } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { lazyWithChunkBoundary } from '../../chunkBoundary'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import DocumentListSidebar from '../../../workbench/creation/DocumentListSidebar'
import { SHELL_ASSET_DRAWER_WIDTH, SHELL_DRAWER_WIDTH, SHELL_RAIL_WIDTH, SHELL_TOPBAR_HEIGHT } from '../shellSpaceSpecimen'

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

export type ShellRailItem = 'docs' | 'shots' | 'assets' | 'flows' | 'skills' | 'prompts'

const PROJECT_ITEMS: readonly { id: ShellRailItem; icon: typeof IconFolder }[] = [
  { id: 'docs', icon: IconFileText },
  { id: 'shots', icon: IconStack2 },
  { id: 'assets', icon: IconFolder },
  { id: 'flows', icon: IconRoute },
]
const SHARED_ITEMS: readonly { id: ShellRailItem; icon: typeof IconFolder }[] = [
  { id: 'skills', icon: IconBooks },
  { id: 'prompts', icon: IconBulb },
]

/** 每一项的全名与左栏短字（写成字面键，i18n 键引用门岗看得见）。 */
function railText(t: (key: string) => string, id: ShellRailItem): { label: string; short: string } {
  switch (id) {
    case 'docs': return { label: t('shellSpace.rail.docs'), short: t('shellSpace.rail.docsLabel') }
    case 'shots': return { label: t('shellSpace.rail.shots'), short: t('shellSpace.rail.shotsLabel') }
    case 'assets': return { label: t('shellSpace.rail.assets'), short: t('shellSpace.rail.assetsLabel') }
    case 'flows': return { label: t('shellSpace.rail.flows'), short: t('shellSpace.rail.flowsLabel') }
    case 'skills': return { label: t('shellSpace.rail.skills'), short: t('shellSpace.rail.skillsLabel') }
    case 'prompts': return { label: t('shellSpace.rail.prompts'), short: t('shellSpace.rail.promptsLabel') }
  }
}

function drawerWidth(item: ShellRailItem): number {
  return item === 'assets' ? SHELL_ASSET_DRAWER_WIDTH : SHELL_DRAWER_WIDTH
}

function RailButton({ id, icon: Icon, active, onClick }: { id: ShellRailItem; icon: typeof IconFolder; active: boolean; onClick: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { label, short } = railText(t, id)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-12 flex-col items-center gap-1 rounded-nomi-sm border-0 py-1.5',
            'cursor-pointer transition-[background,color] duration-nomi-fast ease-nomi-fast',
            active ? 'bg-nomi-ink-05 text-nomi-ink' : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}
          aria-label={label}
          aria-pressed={active}
          data-shell-rail-item={id}
          onClick={onClick}
        >
          <Icon size={18} stroke={1.7} aria-hidden="true" />
          <span className="max-w-full truncate text-micro leading-none">{short}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function DrawerBody({ item, projectId }: { item: ShellRailItem; projectId: string | null }): JSX.Element {
  const categories = useWorkbenchStore((state) => state.categories)
  // 剪辑页：「镜头」抽屉先给可拖进时间轴的已出片镜头（原剪辑页左栏「镜头」tab），「素材」带音频（原「素材」tab）。
  const editing = useWorkbenchStore((state) => state.workspaceMode === 'preview')
  const [createCategoryNonce, setCreateCategoryNonce] = React.useState(0)
  const { t } = useTranslation()
  return (
    <React.Suspense fallback={null}>
      {item === 'shots' ? (
        <>
          <div className="flex justify-end px-2 pt-1">
            <WorkbenchIconButton icon={<IconPlus size={16} stroke={1.7} />} label={t('sidebar.newGroup')} size="sm" onClick={() => setCreateCategoryNonce((n) => n + 1)} />
          </div>
          {editing ? <div className="border-b border-nomi-line-soft"><PreviewShotGrid /></div> : null}
          <CategoryTree categories={categories} createCategoryNonce={createCategoryNonce} />
        </>
      ) : item === 'docs' ? <DocumentListSidebar variant="drawer" />
        : item === 'assets' ? (editing
          ? <AssetLibraryContent projectId={projectId} compact showHeader={false} includeAudio usageContext="timeline" />
          : <AssetLibraryContent projectId={projectId} compact showHeader={false} />)
          : item === 'flows' ? <WorkflowLibraryContent projectId={projectId} compact showHeader={false} />
            : item === 'skills' ? <SkillLibraryContent active compact showHeader={false} />
              : <PromptLibraryContent active compact showHeader={false} />}
    </React.Suspense>
  )
}

export function ShellRail({ projectId, inProject }: { projectId: string | null; inProject: boolean }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState<ShellRailItem | null>(null)
  const [railNode, setRailNode] = React.useState<HTMLElement | null>(null)
  const [drawerNode, setDrawerNode] = React.useState<HTMLElement | null>(null)
  // 点空白收起；左栏自己的点击由「再点同一项」处理，不算外面。
  useClickOutside(() => setOpen(null), null, [railNode, drawerNode])

  // 现役入口照旧能打开对应抽屉：素材 picker 的「浏览全部 →」、Agent 的「去 Skill 库」。
  React.useEffect(() => {
    const openAssets = () => setOpen('assets')
    const openSkills = () => setOpen('skills')
    window.addEventListener('nomi-open-files-panel', openAssets)
    window.addEventListener('nomi-open-skill-library', openSkills)
    return () => {
      window.removeEventListener('nomi-open-files-panel', openAssets)
      window.removeEventListener('nomi-open-skill-library', openSkills)
    }
  }, [])

  const toggle = (item: ShellRailItem) => setOpen((current) => (current === item ? null : item))
  const width = open ? drawerWidth(open) : SHELL_DRAWER_WIDTH
  return (
    <>
      <nav
        ref={setRailNode}
        className="flex h-full flex-col items-center gap-1 border-r border-nomi-line bg-nomi-paper py-2"
        style={{ width: SHELL_RAIL_WIDTH }}
        aria-label={t('shellSpace.rail.aria')}
        data-shell-rail
      >
        <TooltipProvider delayDuration={180} skipDelayDuration={80}>
          {inProject ? (
            <div className="flex flex-col items-center gap-1" role="group" aria-label={t('shellSpace.rail.projectGroup')} data-shell-rail-group="project">
              {PROJECT_ITEMS.map((item) => <RailButton key={item.id} {...item} active={open === item.id} onClick={() => toggle(item.id)} />)}
            </div>
          ) : null}
          {inProject ? <div className="my-1.5 h-px w-7 shrink-0 bg-nomi-line" aria-hidden="true" /> : null}
          <div className="flex flex-col items-center gap-1" role="group" aria-label={t('shellSpace.rail.sharedGroup')} data-shell-rail-group="shared">
            {SHARED_ITEMS.map((item) => <RailButton key={item.id} {...item} active={open === item.id} onClick={() => toggle(item.id)} />)}
          </div>
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
        closeOnEscape
        transitionProps={{ transition: 'slide-right', duration: 160 }}
        classNames={{
          inner: 'pointer-events-none',
          content: 'pointer-events-auto flex flex-col border-r border-nomi-line bg-nomi-paper shadow-nomi-lg',
          body: 'flex min-h-0 flex-1 flex-col p-0',
        }}
        styles={{ inner: { top: SHELL_TOPBAR_HEIGHT, left: SHELL_RAIL_WIDTH, height: `calc(100% - ${SHELL_TOPBAR_HEIGHT}px)` }, content: { height: '100%', maxHeight: '100%', borderRadius: 0 } }}
        aria-label={open ? railText(t, open).label : undefined}
      >
        <div ref={setDrawerNode} className="flex min-h-0 flex-1 flex-col" data-shell-drawer={open ?? undefined}>
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-nomi-line px-3">
            <h2 className="m-0 min-w-0 flex-1 truncate text-body-sm font-semibold text-nomi-ink">{open ? railText(t, open).label : ''}</h2>
            <WorkbenchIconButton icon={<IconX size={15} stroke={1.7} />} label={t('shellSpace.rail.close')} size="sm" onClick={() => setOpen(null)} />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {open ? <DrawerBody item={open} projectId={projectId} /> : null}
          </div>
        </div>
      </Drawer>
    </>
  )
}
