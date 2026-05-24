import React from 'react'
import { cn } from '../../utils/cn'
import type { ProjectCategory } from '../project/projectCategories'

type Props = {
  category: ProjectCategory
  count: number
  active: boolean
  collapsed: boolean
  onActivate: () => void
  onDropNode?: (nodeId: string) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export default function CategoryItem({ category, count, active, collapsed, onActivate, onDropNode, onContextMenu }: Props): JSX.Element {
  const [dragOver, setDragOver] = React.useState(false)

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
        'w-full flex items-center gap-2 px-2 py-2 text-left rounded-md transition-colors',
        'text-[12px] leading-tight border border-transparent',
        active
          ? 'bg-nomi-accent/10 text-nomi-accent border-nomi-accent/30'
          : 'text-nomi-ink-70 hover:bg-nomi-ink-05 hover:text-nomi-ink',
        dragOver && 'ring-2 ring-nomi-accent border-nomi-accent',
        collapsed && 'justify-center px-0',
      )}
    >
      <span className="text-[16px] leading-none shrink-0" aria-hidden>{category.icon}</span>
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
            <span className="text-[11px] text-nomi-ink-40 tabular-nums">{count}</span>
          ) : null}
        </>
      )}
      {collapsed && count > 0 ? (
        <span
          className={cn(
            'absolute -mt-5 ml-3 rounded-full bg-nomi-accent text-white text-[9px] leading-none',
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
