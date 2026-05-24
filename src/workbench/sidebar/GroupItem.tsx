import React from 'react'
import { cn } from '../../utils/cn'
import type { GenerationCanvasNode, NodeGroup } from '../generationCanvasV2/model/generationCanvasTypes'
import NodeItem from './NodeItem'

type Props = {
  group: NodeGroup
  nodes: GenerationCanvasNode[]
  selectedNodeIds: string[]
  onSelectNode?: (nodeId: string) => void
  onDropNode?: (nodeId: string, groupId: string) => void
  onDropGroup?: (activeGroupId: string, overGroupId: string) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, groupId: string) => void
  onNodeContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, nodeId: string) => void
}

export default function GroupItem({ group, nodes, selectedNodeIds, onSelectNode, onDropNode, onDropGroup, onContextMenu, onNodeContextMenu }: Props): JSX.Element {
  const [expanded, setExpanded] = React.useState(!group.collapsed)
  const [dragOver, setDragOver] = React.useState(false)

  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/x-nomi-group-id', group.id)
    event.dataTransfer.effectAllowed = 'move'
  }, [group.id])

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types || [])
    if (!types.includes('application/x-nomi-node-id') && !types.includes('application/x-nomi-group-id')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!dragOver) setDragOver(true)
  }, [dragOver])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nodeId = event.dataTransfer.getData('application/x-nomi-node-id')
    const activeGroupId = event.dataTransfer.getData('application/x-nomi-group-id')
    setDragOver(false)
    if (nodeId) {
      event.preventDefault()
      onDropNode?.(nodeId, group.id)
      return
    }
    if (activeGroupId && activeGroupId !== group.id) {
      event.preventDefault()
      onDropGroup?.(activeGroupId, group.id)
    }
  }, [group.id, onDropGroup, onDropNode])

  return (
    <div
      className={cn('rounded-md border border-nomi-line/70 bg-white/35', dragOver && 'ring-2 ring-nomi-accent/60')}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onClick={() => setExpanded((value) => !value)}
        onContextMenu={(event) => onContextMenu?.(event, group.id)}
        aria-expanded={expanded}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md',
          'text-[11px] text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05',
        )}
        title={group.name}
      >
        <span className="w-3 text-[10px] text-nomi-ink-40" aria-hidden>{expanded ? '▾' : '▸'}</span>
        <span
          className="h-2.5 w-2.5 rounded-full border border-nomi-line shrink-0"
          style={{ backgroundColor: group.color || 'rgba(160, 132, 90, 0.18)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{group.name}</span>
        <span className="shrink-0 tabular-nums text-[10px] text-nomi-ink-40">{nodes.length}</span>
      </button>
      {expanded ? (
        <div className="pb-1">
          {nodes.length ? nodes.map((node) => (
          <NodeItem
            key={node.id}
            node={node}
            active={selectedNodeIds.includes(node.id)}
            depth={1}
            onSelect={onSelectNode}
            onContextMenu={onNodeContextMenu}
          />
          )) : (
            <div className="px-7 py-1.5 text-[11px] text-nomi-ink-30">空组</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
