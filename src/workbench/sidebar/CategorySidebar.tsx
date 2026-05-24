import React from 'react'
import { cn } from '../../utils/cn'
import { BUILTIN_CATEGORIES, type ProjectCategory } from '../project/projectCategories'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvasV2/store/generationCanvasStore'
import CategoryItem from './CategoryItem'
import GroupItem from './GroupItem'
import NodeItem from './NodeItem'

type Props = {
  categories?: ProjectCategory[]
}

type SidebarMenuState =
  | { type: 'category'; categoryId: string; x: number; y: number }
  | { type: 'node'; nodeId: string; x: number; y: number }
  | { type: 'group'; groupId: string; x: number; y: number }

type SidebarMenuPayload =
  | { type: 'category'; categoryId: string }
  | { type: 'node'; nodeId: string }
  | { type: 'group'; groupId: string }

const DEFAULT_GROUP_COLOR = '#d8c3a5'

export default function CategorySidebar({ categories }: Props): JSX.Element {
  const collapsed = useWorkbenchStore((s) => s.sidebarCollapsed)
  const toggle = useWorkbenchStore((s) => s.toggleSidebarCollapsed)
  const activeCategoryId = useWorkbenchStore((s) => s.activeCategoryId)
  const setActiveCategoryId = useWorkbenchStore((s) => s.setActiveCategoryId)
  const nodes = useGenerationCanvasStore((s) => s.nodes)
  const groups = useGenerationCanvasStore((s) => s.groups)
  const selectedNodeIds = useGenerationCanvasStore((s) => s.selectedNodeIds)
  const selectNode = useGenerationCanvasStore((s) => s.selectNode)
  const updateNode = useGenerationCanvasStore((s) => s.updateNode)
  const duplicateNodeForRegeneration = useGenerationCanvasStore((s) => s.duplicateNodeForRegeneration)
  const copyNodeToCategory = useGenerationCanvasStore((s) => s.copyNodeToCategory)
  const deleteNode = useGenerationCanvasStore((s) => s.deleteNode)
  const createGroup = useGenerationCanvasStore((s) => s.createGroup)
  const renameGroup = useGenerationCanvasStore((s) => s.renameGroup)
  const setGroupColor = useGenerationCanvasStore((s) => s.setGroupColor)
  const ungroup = useGenerationCanvasStore((s) => s.ungroup)
  const deleteGroup = useGenerationCanvasStore((s) => s.deleteGroup)
  const moveNodeToGroup = useGenerationCanvasStore((s) => s.moveNodeToGroup)
  const removeNodeFromGroup = useGenerationCanvasStore((s) => s.removeNodeFromGroup)
  const reorderGroup = useGenerationCanvasStore((s) => s.reorderGroup)
  const [expandedCategoryIds, setExpandedCategoryIds] = React.useState<Set<string>>(() => new Set([activeCategoryId]))
  const [menu, setMenu] = React.useState<SidebarMenuState | null>(null)

  const visible = React.useMemo(() => {
    const list = (categories && categories.length ? categories : BUILTIN_CATEGORIES)
      .filter((c) => !c.isHidden)
      .slice()
      .sort((a, b) => a.order - b.order)
    return list
  }, [categories])

  React.useEffect(() => {
    setExpandedCategoryIds((current) => {
      if (current.has(activeCategoryId)) return current
      const next = new Set(current)
      next.add(activeCategoryId)
      return next
    })
  }, [activeCategoryId])

  React.useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menu])

  const openMenu = React.useCallback((event: React.MouseEvent<HTMLElement>, nextMenu: SidebarMenuPayload) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ ...nextMenu, x: event.clientX, y: event.clientY } as SidebarMenuState)
  }, [])

  const closeMenu = React.useCallback(() => setMenu(null), [])

  const nodesByCategory = React.useMemo(() => {
    const map = new Map<string, typeof nodes>()
    for (const node of nodes) {
      const id = node.categoryId || 'shots'
      const list = map.get(id)
      if (list) list.push(node)
      else map.set(id, [node])
    }
    return map
  }, [nodes])

  const nodeById = React.useMemo(() => {
    const map = new Map<string, (typeof nodes)[number]>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const groupsByCategory = React.useMemo(() => {
    const map = new Map<string, typeof groups>()
    for (const group of groups) {
      const list = map.get(group.categoryId)
      if (list) list.push(group)
      else map.set(group.categoryId, [group])
    }
    return map
  }, [groups])

  const counts = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const [categoryId, list] of nodesByCategory) {
      map.set(categoryId, list.length)
    }
    return map
  }, [nodesByCategory])

  const toggleCategory = React.useCallback((categoryId: string) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }, [])

  const handleActivateCategory = React.useCallback((categoryId: string) => {
    setActiveCategoryId(categoryId)
    setExpandedCategoryIds((current) => {
      if (current.has(categoryId)) return current
      const next = new Set(current)
      next.add(categoryId)
      return next
    })
  }, [setActiveCategoryId])

  const handleSelectNode = React.useCallback((nodeId: string) => {
    selectNode(nodeId)
  }, [selectNode])

  const handleDropNodeOnCategory = React.useCallback((nodeId: string, categoryId: string) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    if (node.categoryId === categoryId) {
      removeNodeFromGroup(nodeId)
      return
    }
    copyNodeToCategory(nodeId, categoryId)
  }, [copyNodeToCategory, nodeById, removeNodeFromGroup])

  const handleDropNodeOnGroup = React.useCallback((nodeId: string, groupId: string) => {
    const node = nodeById.get(nodeId)
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!node || !group) return
    if (node.categoryId === group.categoryId) {
      moveNodeToGroup(nodeId, groupId)
      return
    }
    const copied = copyNodeToCategory(nodeId, group.categoryId)
    if (copied) moveNodeToGroup(copied.id, groupId)
  }, [copyNodeToCategory, groups, moveNodeToGroup, nodeById])

  const handleCreateGroup = React.useCallback((categoryId: string) => {
    const name = window.prompt('子组名称', '新建子组')
    if (name === null) return
    const created = createGroup(categoryId, name)
    if (created) {
      handleActivateCategory(categoryId)
      setExpandedCategoryIds((current) => new Set(current).add(categoryId))
    }
    closeMenu()
  }, [closeMenu, createGroup, handleActivateCategory])

  const handleCopyNode = React.useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId)
    const categoryId = node?.categoryId
    if (categoryId) copyNodeToCategory(nodeId, categoryId)
    closeMenu()
  }, [closeMenu, copyNodeToCategory, nodeById])

  const handleRenameNode = React.useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    const title = window.prompt('节点名称', node.title || node.id)
    if (title !== null && title.trim()) updateNode(nodeId, { title: title.trim() })
    closeMenu()
  }, [closeMenu, nodeById, updateNode])

  const handleRegenerateDerivedNode = React.useCallback((nodeId: string) => {
    duplicateNodeForRegeneration(nodeId)
    closeMenu()
  }, [closeMenu, duplicateNodeForRegeneration])

  const handleDeleteNode = React.useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId)
    const label = node?.title || nodeId
    if (window.confirm(`删除节点「${label}」？跨分类副本不会受影响。`)) deleteNode(nodeId)
    closeMenu()
  }, [closeMenu, deleteNode, nodeById])

  const handleRenameGroup = React.useCallback((groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    const name = window.prompt('子组名称', group.name)
    if (name !== null) renameGroup(groupId, name)
    closeMenu()
  }, [closeMenu, groups, renameGroup])

  const handleSetGroupColor = React.useCallback((groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    const color = window.prompt('组颜色（CSS 颜色值）', group.color || DEFAULT_GROUP_COLOR)
    if (color !== null) setGroupColor(groupId, color)
    closeMenu()
  }, [closeMenu, groups, setGroupColor])

  const handleUngroup = React.useCallback((groupId: string) => {
    ungroup(groupId)
    closeMenu()
  }, [closeMenu, ungroup])

  const handleDeleteGroup = React.useCallback((groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    if (window.confirm(`删除子组「${group.name}」并删除其中 ${group.nodeIds.length} 个节点？`)) deleteGroup(groupId, true)
    closeMenu()
  }, [closeMenu, deleteGroup, groups])

  const renderContextMenu = () => {
    if (!menu) return null
    const buttonClass = 'w-full px-3 py-1.5 text-left text-[12px] text-nomi-ink-70 hover:bg-nomi-ink-05'
    const dangerClass = 'w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50'
    return (
      <div
        role="menu"
        className="fixed z-50 min-w-[168px] overflow-hidden rounded-lg border border-nomi-line bg-white py-1 shadow-xl"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {menu.type === 'category' ? (
          <button type="button" role="menuitem" className={buttonClass} onClick={() => handleCreateGroup(menu.categoryId)}>
            新建子组
          </button>
        ) : null}
        {menu.type === 'node' ? (
          <>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleCopyNode(menu.nodeId)}>复制</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRenameNode(menu.nodeId)}>重命名</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRegenerateDerivedNode(menu.nodeId)}>派生重新生成</button>
            <div className="my-1 h-px bg-nomi-line" />
            <button type="button" role="menuitem" className={dangerClass} onClick={() => handleDeleteNode(menu.nodeId)}>删除</button>
          </>
        ) : null}
        {menu.type === 'group' ? (
          <>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRenameGroup(menu.groupId)}>重命名</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleSetGroupColor(menu.groupId)}>改颜色</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleUngroup(menu.groupId)}>解组（保留节点）</button>
            <div className="my-1 h-px bg-nomi-line" />
            <button type="button" role="menuitem" className={dangerClass} onClick={() => handleDeleteGroup(menu.groupId)}>删除（连节点）</button>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <>
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex flex-col h-full min-h-0 border-r border-nomi-line bg-nomi-paper',
        'transition-[width] duration-150 ease-out',
        collapsed ? 'w-[60px]' : 'w-[240px]',
      )}
      aria-label="项目分类"
    >
      <div className={cn('flex items-center px-2 py-2 border-b border-nomi-line', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? null : (
          <span className="text-[11px] uppercase tracking-wider text-nomi-ink-40">分类</span>
        )}
        <button
          type="button"
          onClick={toggle}
          className="text-nomi-ink-40 hover:text-nomi-ink p-1 rounded text-[12px]"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {visible.map((cat) => {
          const categoryNodes = nodesByCategory.get(cat.id) || []
          const categoryGroups = groupsByCategory.get(cat.id) || []
          const groupedNodeIds = new Set(categoryGroups.flatMap((group) => group.nodeIds))
          const looseNodes = categoryNodes.filter((node) => !groupedNodeIds.has(node.id))
          const expanded = expandedCategoryIds.has(cat.id)
          return (
            <div key={cat.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className="grid h-7 w-5 place-items-center rounded text-[10px] text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                    aria-label={expanded ? `折叠${cat.name}` : `展开${cat.name}`}
                    aria-expanded={expanded}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <CategoryItem
                    category={cat}
                    count={counts.get(cat.id) || 0}
                    active={activeCategoryId === cat.id}
                    collapsed={collapsed}
                    onActivate={() => handleActivateCategory(cat.id)}
                    onDropNode={(nodeId) => handleDropNodeOnCategory(nodeId, cat.id)}
                    onContextMenu={(event) => openMenu(event, { type: 'category', categoryId: cat.id })}
                  />
                </div>
              </div>
              {!collapsed && expanded ? (
                <div className="ml-5 flex flex-col gap-1 border-l border-nomi-line/70 pl-2">
                  {looseNodes.map((node) => (
                    <NodeItem
                      key={node.id}
                      node={node}
                      active={selectedNodeIds.includes(node.id)}
                      onSelect={handleSelectNode}
                      onContextMenu={(event, nodeId) => openMenu(event, { type: 'node', nodeId })}
                    />
                  ))}
                  {categoryGroups.map((group) => {
                    const memberNodes = group.nodeIds.flatMap((nodeId) => {
                      const node = nodeById.get(nodeId)
                      return node && node.categoryId === group.categoryId ? [node] : []
                    })
                    return (
                      <GroupItem
                        key={group.id}
                        group={group}
                        nodes={memberNodes}
                        selectedNodeIds={selectedNodeIds}
                        onSelectNode={handleSelectNode}
                        onDropNode={handleDropNodeOnGroup}
                        onDropGroup={(activeGroupId, overGroupId) => reorderGroup(cat.id, activeGroupId, overGroupId)}
                        onContextMenu={(event, groupId) => openMenu(event, { type: 'group', groupId })}
                        onNodeContextMenu={(event, nodeId) => openMenu(event, { type: 'node', nodeId })}
                      />
                    )
                  })}
                  {!looseNodes.length && !categoryGroups.length ? (
                    <div className="px-2 py-1.5 text-[11px] text-nomi-ink-30">暂无节点</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>
      <div className={cn('px-2 py-2 border-t border-nomi-line', collapsed && 'hidden')}>
        <button
          type="button"
          onClick={() => handleCreateGroup(activeCategoryId)}
          className={cn(
            'w-full px-2 py-1.5 text-[12px] rounded-md border border-dashed border-nomi-line',
            'text-nomi-ink-50 hover:text-nomi-ink hover:bg-nomi-ink-05',
          )}
          title="在当前分类下新建子组"
        >
          + 新子组
        </button>
      </div>
    </aside>
    {renderContextMenu()}
    </>
  )
}
