import React from 'react'
import { cn } from '../../utils/cn'
import { type ProjectCategory } from '../project/projectCategories'
import { useWorkbenchStore } from '../workbenchStore'
import CategoryTree from '../sidebar/CategoryTree'
import WorkspaceFileExplorerPanel from './WorkspaceFileExplorerPanel'

type Props = {
  categories?: ProjectCategory[]
  projectId?: string | null
}

export default function ProjectExplorerSidebar({ categories, projectId = null }: Props): JSX.Element {
  const [tab, setTab] = React.useState<'categories' | 'files'>('files')
  const collapsed = useWorkbenchStore((s) => s.sidebarCollapsed)
  const toggle = useWorkbenchStore((s) => s.toggleSidebarCollapsed)

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
      <div className={cn('flex items-center px-2 py-2 border-b border-nomi-line', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? null : (
          <div className="flex items-center gap-1 rounded-md bg-nomi-bg p-0.5">
            <button type="button" onClick={() => setTab('categories')} className={cn('px-2 py-1 text-[11px] rounded', tab === 'categories' ? 'bg-nomi-paper text-nomi-ink' : 'text-nomi-ink-40')}>分类</button>
            <button type="button" onClick={() => setTab('files')} className={cn('px-2 py-1 text-[11px] rounded', tab === 'files' ? 'bg-nomi-paper text-nomi-ink' : 'text-nomi-ink-40')}>文件</button>
          </div>
        )}
        <button type="button" onClick={toggle} className="text-nomi-ink-40 hover:text-nomi-ink p-1 rounded text-[12px]" aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <button type="button" onClick={() => { setTab('categories'); toggle() }} className="w-9 h-8 rounded text-[11px] text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="展开分类面板">类</button>
          <button type="button" onClick={() => { setTab('files'); toggle() }} className="w-9 h-8 rounded text-[11px] text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg" aria-label="展开文件面板">文</button>
        </div>
      ) : tab === 'files' ? (
        <WorkspaceFileExplorerPanel projectId={projectId} />
      ) : (
        <CategoryTree categories={categories} />
      )}
    </aside>
  )
}
