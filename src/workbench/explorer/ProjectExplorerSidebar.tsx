import React from 'react'
import { Folder, FolderSearch, PanelLeftClose, PanelLeftOpen, Plus, Tags } from 'lucide-react'
import { cn } from '../../utils/cn'
import { type ProjectCategory } from '../project/projectCategories'
import { useWorkbenchStore } from '../workbenchStore'
import CategoryTree from '../sidebar/CategoryTree'
import WorkspaceFileExplorerPanel from './WorkspaceFileExplorerPanel'
import AssetFinderPanel from '../assets/autoGroup/AssetFinderPanel'

type Props = {
  categories?: ProjectCategory[]
  projectId?: string | null
}

export default function ProjectExplorerSidebar({ categories, projectId = null }: Props): JSX.Element {
  const [tab, setTab] = React.useState<'find' | 'categories' | 'files'>('files')
  const [createCategoryNonce, setCreateCategoryNonce] = React.useState(0)
  const collapsed = useWorkbenchStore((s) => s.sidebarCollapsed)
  const toggle = useWorkbenchStore((s) => s.toggleSidebarCollapsed)
  const setSidebarCollapsed = useWorkbenchStore((s) => s.setSidebarCollapsed)

  // 加号 = 新建一个顶层分类。若停在「文件」tab，先切回「分类」让用户看见新建结果。
  // （建子组改走分类行右键「新建子组」。）
  const handleAddCategory = React.useCallback(() => {
    setTab('categories')
    setCreateCategoryNonce((n) => n + 1)
  }, [])

  // picker 的「浏览全部 →」→ 展开侧栏 + 切到文件面板(全量浏览在面板,弹层只做快速取,规范 §5)。
  React.useEffect(() => {
    const open = () => { setTab('files'); setSidebarCollapsed(false) }
    window.addEventListener('nomi-open-files-panel', open)
    return () => window.removeEventListener('nomi-open-files-panel', open)
  }, [setSidebarCollapsed])

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex flex-col h-full min-h-0 border-r border-nomi-line bg-nomi-paper',
        'transition-[width] duration-150 ease-out',
        collapsed ? 'w-[60px]' : 'w-[240px]',
      )}
      aria-label="项目资源管理器"
    >
      {collapsed ? (
        <div className="flex items-center justify-center px-2 py-2 border-b border-nomi-line">
          <button
            type="button"
            onClick={toggle}
            className="grid h-7 w-8 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg"
            aria-label="展开侧栏"
            title="展开侧栏"
          >
            <PanelLeftOpen size={18} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 py-2 border-b border-nomi-line">
          <span aria-hidden />
          <div className="flex items-center justify-center gap-1">
            <div className="flex items-center gap-0.5 rounded-nomi-sm bg-nomi-bg p-0.5">
              <button type="button" onClick={() => setTab('find')} title="找素材" className={cn('flex items-center gap-1 px-2 py-1 text-micro rounded-nomi-sm', tab === 'find' ? 'bg-nomi-paper text-nomi-ink' : 'text-nomi-ink-40 hover:text-nomi-ink-60')}>
                <FolderSearch size={14} strokeWidth={1.7} />{tab !== 'find' && '找'}
              </button>
              <button type="button" onClick={() => setTab('categories')} title="分类" className={cn('flex items-center gap-1 px-2 py-1 text-micro rounded-nomi-sm', tab === 'categories' ? 'bg-nomi-paper text-nomi-ink' : 'text-nomi-ink-40 hover:text-nomi-ink-60')}>
                <Tags size={14} strokeWidth={1.7} />{tab !== 'categories' && '分类'}
              </button>
              <button type="button" onClick={() => setTab('files')} title="文件" className={cn('flex items-center gap-1 px-2 py-1 text-micro rounded-nomi-sm', tab === 'files' ? 'bg-nomi-paper text-nomi-ink' : 'text-nomi-ink-40 hover:text-nomi-ink-60')}>
                <Folder size={14} strokeWidth={1.7} />{tab !== 'files' && '文件'}
              </button>
            </div>
            <button type="button" onClick={handleAddCategory} className="grid place-items-center w-7 h-7 rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="新建分类" title="新建一个顶层分类">
              <Plus size={16} strokeWidth={1.7} />
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={toggle}
              className="grid h-7 w-8 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg"
              aria-label="收起侧栏"
              title="收起侧栏"
            >
              <PanelLeftClose size={18} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <button type="button" onClick={() => { setTab('find'); toggle() }} className="w-9 h-8 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="展开找素材面板" title="找素材"><FolderSearch size={16} strokeWidth={1.7} /></button>
          <button type="button" onClick={() => { setTab('categories'); toggle() }} className="w-9 h-8 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="展开分类面板" title="分类"><Tags size={16} strokeWidth={1.7} /></button>
          <button type="button" onClick={() => { setTab('files'); toggle() }} className="w-9 h-8 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="展开文件面板" title="文件"><Folder size={16} strokeWidth={1.7} /></button>
        </div>
      ) : tab === 'find' ? (
        <AssetFinderPanel />
      ) : tab === 'files' ? (
        <WorkspaceFileExplorerPanel projectId={projectId} />
      ) : (
        <CategoryTree categories={categories} createCategoryNonce={createCategoryNonce} />
      )}
    </aside>
  )
}
