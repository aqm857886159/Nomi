import React from 'react'
import { cn } from '../../utils/cn'
import type { ProjectCategory } from '../project/projectCategories'
import { getCategoryIcon } from './categoryIcons'

type Props = {
  category: ProjectCategory
  count: number
  active: boolean
  collapsed: boolean
  /** 展开态——决定行首 ▾/▸ 朝向。收起模式（collapsed）下不显示。 */
  expanded?: boolean
  /** 行内改名态（仅自定义分类、展开侧栏时启用）。 */
  editing?: boolean
  onCommitName?: (name: string) => void
  onCancelEdit?: () => void
  onActivate: () => void
  onDropNode?: (nodeId: string) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export default function CategoryItem({ category, count, active, collapsed, expanded = false, editing = false, onCommitName, onCancelEdit, onActivate, onDropNode, onContextMenu }: Props): JSX.Element {
  const [dragOver, setDragOver] = React.useState(false)
  const settledRef = React.useRef(false)
  React.useEffect(() => { if (editing) settledRef.current = false }, [editing])

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!onDropNode) return
    const types = event.dataTransfer?.types
    if (!types || !Array.from(types).includes('application/x-nomi-node-id')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!dragOver) setDragOver(true)
  }, [dragOver, onDropNode])

  const handleDragLeave = React.useCallback(() => {
    if (dragOver) setDragOver(false)
  }, [dragOver])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!onDropNode) return
    const nodeId = event.dataTransfer?.getData('application/x-nomi-node-id')
    setDragOver(false)
    if (!nodeId) return
    event.preventDefault()
    onDropNode(nodeId)
  }, [onDropNode])

  if (editing && !collapsed) {
    const Icon = getCategoryIcon(category.iconName)
    return (
      <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-nomi-sm border border-nomi-accent/30 bg-nomi-accent/10 text-caption">
        <span className="w-3 shrink-0 text-micro text-nomi-ink-40" aria-hidden>{expanded ? '▾' : '▸'}</span>
        <Icon size={16} stroke={1.5} className="shrink-0" aria-hidden />
        <input
          autoFocus
          defaultValue={category.name}
          aria-label="分类名称"
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { settledRef.current = true; onCommitName?.(event.currentTarget.value) }
            else if (event.key === 'Escape') { settledRef.current = true; onCancelEdit?.() }
          }}
          onBlur={(event) => { if (!settledRef.current) { settledRef.current = true; onCommitName?.(event.currentTarget.value) } }}
          className="min-w-0 flex-1 bg-transparent border-b border-nomi-accent/50 text-caption text-nomi-ink outline-none"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      onContextMenu={onContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-category-id={category.id}
      data-active={active ? 'true' : 'false'}
      title={collapsed ? `${category.name} (${count})` : undefined}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-nomi-sm transition-colors',
        'text-caption leading-tight border border-transparent',
        active
          ? 'bg-nomi-ink-10 text-nomi-accent'
          : 'text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
        dragOver && 'ring-2 ring-nomi-accent border-nomi-accent',
        collapsed && 'justify-center px-0',
      )}
    >
      {!collapsed ? (
        <span className="w-3 shrink-0 text-micro text-nomi-ink-40" aria-hidden>{expanded ? '▾' : '▸'}</span>
      ) : null}
      {(() => {
        const Icon = getCategoryIcon(category.iconName)
        return <Icon size={16} stroke={1.5} className="shrink-0" aria-hidden />
      })()}
      {collapsed ? (
        count > 0 ? (
          <span className="sr-only">{category.name} ({count})</span>
        ) : (
          <span className="sr-only">{category.name}</span>
        )
      ) : (
        <>
          <span className="flex-1 truncate">{category.name}</span>
          {count > 0 ? (
            <span className="text-micro text-nomi-ink-40 tabular-nums">{count}</span>
          ) : null}
        </>
      )}
      {collapsed && count > 0 ? (
        <span
          className={cn(
            'absolute -mt-5 ml-3 rounded-full bg-nomi-accent text-nomi-paper text-micro leading-none',
            'px-1.5 py-[2px] tabular-nums',
          )}
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  )
}
