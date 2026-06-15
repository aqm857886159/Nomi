import React from 'react'
import { BUILTIN_CATEGORIES, getBuiltinCategoryById, type ProjectCategory } from '../project/projectCategories'
import { showUndoToast } from '../../utils/showUndoToast'
import { useWorkbenchStore } from '../workbenchStore'
import { confirmDialog, promptDialog } from '../../design'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useCommittedProposal } from '../generationCanvas/agent/proposalUndo'
import CategoryItem from './CategoryItem'
import GroupItem from './GroupItem'
import NodeItem from './NodeItem'

type Props = {
  categories?: ProjectCategory[]
  /** 外壳「+」按钮按下的递增信号：每 +1 新建一个顶层分类并进入行内改名。 */
  createCategoryNonce?: number
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

/**
 * 分类导航的完整内容（分类 → 节点/子组、右键菜单、跨分类拖拽、点节点定位画布）。
 * 不含 aside/折叠/标题外壳——外壳由承载它的 Tab 面板（ProjectExplorerSidebar）提供。
 * 仅在面板展开 + 「分类」tab 激活时挂载，故始终按展开态渲染。
 */
export default function CategoryTree({ categories, createCategoryNonce = 0 }: Props): JSX.Element {
  const activeCategoryId = useWorkbenchStore((s) => s.activeCategoryId)
  const setActiveCategoryId = useWorkbenchStore((s) => s.setActiveCategoryId)
  const addCategory = useWorkbenchStore((s) => s.addCategory)
  const renameCategory = useWorkbenchStore((s) => s.renameCategory)
  const deleteCategory = useWorkbenchStore((s) => s.deleteCategory)
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
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = React.useState<string | null>(null)

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

  // 落点回报(审计 A1):AI 提议 commit 后,把刚收到节点的分类自动展开——
  // 跨分类产物(定妆卡等)不再静默归档进默认折叠的面板。
  const committedProposal = useCommittedProposal()
  React.useEffect(() => {
    const received = committedProposal?.categoryCounts
    if (!received?.length) return
    setExpandedCategoryIds((current) => {
      const missing = received.filter((item) => item.count > 0 && !current.has(item.categoryId))
      if (!missing.length) return current
      const next = new Set(current)
      for (const item of missing) next.add(item.categoryId)
      return next
    })
  }, [committedProposal])

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

  // 整行单击即收放——与「文件」tab 的文件夹 / 子组完全一致（点哪都收放，无两段式）。
  // 「激活」只作为展开时的副作用（展开 = 我要在这个分类里干活 → 画布跟随聚焦）；
  // 收起不改聚焦，避免关一个分类却把画布跳过去的意外。
  const handleCategoryRowClick = React.useCallback((categoryId: string) => {
    const willExpand = !expandedCategoryIds.has(categoryId)
    toggleCategory(categoryId)
    if (willExpand) setActiveCategoryId(categoryId)
  }, [expandedCategoryIds, setActiveCategoryId, toggleCategory])

  const handleSelectNode = React.useCallback((nodeId: string) => {
    selectNode(nodeId)
    // v0.7.3 fix: 派发 focus 事件，让 canvas 切换到目标分类 + pan/zoom 到该节点
    // 这跟"独立副本定位源节点"用的是同一个机制（GenerationCanvas 监听 nomi-focus-generation-node）
    window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId } }))
  }, [selectNode])

  const handleDropNodeOnCategory = React.useCallback((nodeId: string, categoryId: string) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    if (node.categoryId === categoryId) {
      removeNodeFromGroup(nodeId)
      return
    }
    // E.2C-26: 跨分类拖拽 → 创建独立副本 + 5 秒可撤销 toast
    const copied = copyNodeToCategory(nodeId, categoryId)
    if (copied) {
      const targetName = getBuiltinCategoryById(categoryId)?.name || categoryId
      showUndoToast({
        message: `已复制到 ${targetName}`,
        onUndo: () => deleteNode(copied.id),
      })
    }
  }, [copyNodeToCategory, deleteNode, nodeById, removeNodeFromGroup])

  const handleDropNodeOnGroup = React.useCallback((nodeId: string, groupId: string) => {
    const node = nodeById.get(nodeId)
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!node || !group) return
    if (node.categoryId === group.categoryId) {
      moveNodeToGroup(nodeId, groupId)
      return
    }
    // E.2C-26: 跨分类拖到子组 → 创建独立副本 + 加入组 + 5 秒可撤销 toast
    const copied = copyNodeToCategory(nodeId, group.categoryId)
    if (copied) {
      moveNodeToGroup(copied.id, groupId)
      const targetName = getBuiltinCategoryById(group.categoryId)?.name || group.categoryId
      showUndoToast({
        message: `已复制到 ${targetName} · ${group.name}`,
        onUndo: () => deleteNode(copied.id),
      })
    }
  }, [copyNodeToCategory, deleteNode, groups, moveNodeToGroup, nodeById])

  const handleCreateGroup = React.useCallback((categoryId: string) => {
    const created = createGroup(categoryId)
    if (created) {
      handleActivateCategory(categoryId)
      setExpandedCategoryIds((current) => new Set(current).add(categoryId))
      setEditingGroupId(created.id) // 新建即进入行内改名，免去额外弹窗
    }
    closeMenu()
  }, [closeMenu, createGroup, handleActivateCategory])

  const handleCommitGroupName = React.useCallback((groupId: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) renameGroup(groupId, trimmed)
    setEditingGroupId(null)
  }, [renameGroup])

  const handleCancelGroupEdit = React.useCallback(() => setEditingGroupId(null), [])

  // 外壳「+」按钮：每次 nonce 自增就新建一个顶层分类并进入行内改名
  // （含从「文件」tab 切回后 CategoryTree 首次挂载的情形）。
  const handleCreateCategory = React.useCallback(() => {
    const created = addCategory()
    if (!created) return
    setActiveCategoryId(created.id)
    setExpandedCategoryIds((current) => new Set(current).add(created.id))
    setEditingCategoryId(created.id)
  }, [addCategory, setActiveCategoryId])

  const lastCreateNonce = React.useRef(0)
  React.useEffect(() => {
    if (createCategoryNonce === lastCreateNonce.current) return
    lastCreateNonce.current = createCategoryNonce
    if (createCategoryNonce > 0) handleCreateCategory()
  }, [createCategoryNonce, handleCreateCategory])

  const handleCommitCategoryName = React.useCallback((categoryId: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) renameCategory(categoryId, trimmed)
    setEditingCategoryId(null)
  }, [renameCategory])

  const handleCancelCategoryEdit = React.useCallback(() => setEditingCategoryId(null), [])

  const handleRenameCategory = React.useCallback((categoryId: string) => {
    setEditingCategoryId(categoryId)
    closeMenu()
  }, [closeMenu])

  const handleDeleteCategory = React.useCallback(async (categoryId: string) => {
    const category = (categories || BUILTIN_CATEGORIES).find((c) => c.id === categoryId)
    const label = category?.name || categoryId
    closeMenu()
    const confirmed = await confirmDialog({
      title: '删除分类',
      message: `删除分类「${label}」？里面的节点会移回「分镜」，不会丢失。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (confirmed) deleteCategory(categoryId)
  }, [categories, closeMenu, deleteCategory])

  const handleCopyNode = React.useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId)
    const categoryId = node?.categoryId
    if (categoryId) copyNodeToCategory(nodeId, categoryId)
    closeMenu()
  }, [closeMenu, copyNodeToCategory, nodeById])

  const handleRenameNode = React.useCallback(async (nodeId: string) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    closeMenu()
    const title = await promptDialog({ title: '节点名称', initialValue: node.title || node.id })
    if (title !== null && title.trim()) updateNode(nodeId, { title: title.trim() })
  }, [closeMenu, nodeById, updateNode])

  const handleRegenerateDerivedNode = React.useCallback((nodeId: string) => {
    duplicateNodeForRegeneration(nodeId)
    closeMenu()
  }, [closeMenu, duplicateNodeForRegeneration])

  const handleDeleteNode = React.useCallback(async (nodeId: string) => {
    const node = nodeById.get(nodeId)
    const label = node?.title || nodeId
    closeMenu()
    const confirmed = await confirmDialog({
      title: '删除节点',
      message: `删除节点「${label}」？跨分类副本不会受影响。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (confirmed) deleteNode(nodeId)
  }, [closeMenu, deleteNode, nodeById])

  const handleRenameGroup = React.useCallback((groupId: string) => {
    setEditingGroupId(groupId) // 与新建走同一行内改名，不再弹 window.prompt
    closeMenu()
  }, [closeMenu])

  const handleSetGroupColor = React.useCallback(async (groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    closeMenu()
    const color = await promptDialog({ title: '组颜色', message: '输入 CSS 颜色值', initialValue: group.color || DEFAULT_GROUP_COLOR })
    if (color !== null) setGroupColor(groupId, color)
  }, [closeMenu, groups, setGroupColor])

  const handleUngroup = React.useCallback((groupId: string) => {
    ungroup(groupId)
    closeMenu()
  }, [closeMenu, ungroup])

  const handleDeleteGroup = React.useCallback(async (groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    closeMenu()
    const confirmed = await confirmDialog({
      title: '删除子组',
      message: `删除子组「${group.name}」并删除其中 ${group.nodeIds.length} 个节点？`,
      confirmLabel: '删除',
      danger: true,
    })
    if (confirmed) deleteGroup(groupId, true)
  }, [closeMenu, deleteGroup, groups])

  const renderContextMenu = () => {
    if (!menu) return null
    const buttonClass = 'w-full px-2.5 py-1 text-left text-caption text-nomi-ink-70 hover:bg-nomi-ink-05'
    const dangerClass = 'w-full px-2.5 py-1 text-left text-caption text-workbench-danger hover:bg-workbench-danger-soft'
    return (
      <div
        role="menu"
        className="fixed z-50 min-w-[120px] overflow-hidden rounded-md border border-nomi-line bg-white py-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {menu.type === 'category' ? (() => {
          const category = (categories || BUILTIN_CATEGORIES).find((c) => c.id === menu.categoryId)
          const isCustom = category ? !category.isBuiltin : false
          return (
            <>
              <button type="button" role="menuitem" className={buttonClass} onClick={() => handleCreateGroup(menu.categoryId)}>新建子组</button>
              {isCustom ? (
                <>
                  <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRenameCategory(menu.categoryId)}>重命名</button>
                  <div className="my-0.5 h-px bg-nomi-line" />
                  <button type="button" role="menuitem" className={dangerClass} onClick={() => handleDeleteCategory(menu.categoryId)}>删除分类</button>
                </>
              ) : null}
            </>
          )
        })() : null}
        {menu.type === 'node' ? (
          <>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleCopyNode(menu.nodeId)}>复制</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRenameNode(menu.nodeId)}>重命名</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRegenerateDerivedNode(menu.nodeId)}>派生重新生成</button>
            <div className="my-0.5 h-px bg-nomi-line" />
            <button type="button" role="menuitem" className={dangerClass} onClick={() => handleDeleteNode(menu.nodeId)}>删除</button>
          </>
        ) : null}
        {menu.type === 'group' ? (
          <>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleRenameGroup(menu.groupId)}>重命名</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleSetGroupColor(menu.groupId)}>改颜色</button>
            <button type="button" role="menuitem" className={buttonClass} onClick={() => handleUngroup(menu.groupId)}>解组（保留节点）</button>
            <div className="my-0.5 h-px bg-nomi-line" />
            <button type="button" role="menuitem" className={dangerClass} onClick={() => handleDeleteGroup(menu.groupId)}>删除（连节点）</button>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {visible.map((cat) => {
          const categoryNodes = nodesByCategory.get(cat.id) || []
          const categoryGroups = groupsByCategory.get(cat.id) || []
          const groupedNodeIds = new Set(categoryGroups.flatMap((group) => group.nodeIds))
          const looseNodes = categoryNodes.filter((node) => !groupedNodeIds.has(node.id))
          const expanded = expandedCategoryIds.has(cat.id)
          return (
            <div key={cat.id} className="flex flex-col gap-1">
              <CategoryItem
                category={cat}
                count={counts.get(cat.id) || 0}
                active={activeCategoryId === cat.id}
                collapsed={false}
                expanded={expanded}
                editing={editingCategoryId === cat.id}
                onCommitName={(name) => handleCommitCategoryName(cat.id, name)}
                onCancelEdit={handleCancelCategoryEdit}
                onActivate={() => handleCategoryRowClick(cat.id)}
                onDropNode={(nodeId) => handleDropNodeOnCategory(nodeId, cat.id)}
                onContextMenu={(event) => openMenu(event, { type: 'category', categoryId: cat.id })}
              />
              {expanded ? (
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
                        editing={editingGroupId === group.id}
                        onCommitName={handleCommitGroupName}
                        onCancelEdit={handleCancelGroupEdit}
                        onSelectNode={handleSelectNode}
                        onDropNode={handleDropNodeOnGroup}
                        onDropGroup={(activeGroupId, overGroupId) => reorderGroup(cat.id, activeGroupId, overGroupId)}
                        onContextMenu={(event, groupId) => openMenu(event, { type: 'group', groupId })}
                        onNodeContextMenu={(event, nodeId) => openMenu(event, { type: 'node', nodeId })}
                      />
                    )
                  })}
                  {!looseNodes.length && !categoryGroups.length ? (
                    <div className="px-2 py-1.5 text-micro text-nomi-ink-30">暂无节点</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>
      {renderContextMenu()}
    </>
  )
}
