import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import type { GenerationCanvasNode, NodeGroup } from '../generationCanvas/model/generationCanvasTypes'
import NodeItem from './NodeItem'

// 用户子组未指定颜色时的默认色点底色（暖灰半透明，与品牌一致）。
const DEFAULT_GROUP_TINT = 'rgba(160,132,90,0.18)'

type Props = {
  group: NodeGroup
  nodes: GenerationCanvasNode[]
  selectedNodeIds: string[]
  editing?: boolean
  onCommitName?: (groupId: string, name: string) => void
  onCancelEdit?: () => void
  onSelectNode?: (nodeId: string) => void
  onDropNode?: (nodeId: string, groupId: string) => void
  onDropGroup?: (activeGroupId: string, overGroupId: string) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, groupId: string) => void
  onNodeContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, nodeId: string) => void
}

export default function GroupItem({
  group,
  nodes,
  selectedNodeIds,
  editing = false,
  onCommitName,
  onCancelEdit,
  onSelectNode,
  onDropNode,
  onDropGroup,
  onContextMenu,
  onNodeContextMenu,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(!group.collapsed)
  const [dragOver, setDragOver] = React.useState(false)
  // 已提交/取消标记：避免 Enter/Escape 后 input 再 blur 触发二次提交。
  const settledRef = React.useRef(false)
  React.useEffect(() => {
    if (editing) settledRef.current = false
  }, [editing])

  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData('application/x-nomi-group-id', group.id)
      event.dataTransfer.effectAllowed = 'move'
    },
    [group.id],
  )

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const types = Array.from(event.dataTransfer?.types || [])
      if (!types.includes('application/x-nomi-node-id') && !types.includes('application/x-nomi-group-id')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (!dragOver) setDragOver(true)
    },
    [dragOver],
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
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
    },
    [group.id, onDropGroup, onDropNode],
  )

  return (
    <div
      className={cn(
        'rounded-nomi-sm border border-nomi-line/70 bg-nomi-paper/35',
        dragOver && 'ring-2 ring-nomi-accent/60',
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {editing ? (
        <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-nomi-sm text-micro text-nomi-ink-60">
          <span className="w-3 text-micro text-nomi-ink-40" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <span
            className="h-2.5 w-2.5 rounded-full border border-nomi-line shrink-0"
            style={{ backgroundColor: group.color || DEFAULT_GROUP_TINT }}
            aria-hidden
          />
          <input
            autoFocus
            defaultValue={group.name}
            aria-label={t('libraries.sidebar.subgroupName')}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                settledRef.current = true
                onCommitName?.(group.id, event.currentTarget.value)
              } else if (event.key === 'Escape') {
                settledRef.current = true
                onCancelEdit?.()
              }
            }}
            onBlur={(event) => {
              if (!settledRef.current) {
                settledRef.current = true
                onCommitName?.(group.id, event.currentTarget.value)
              }
            }}
            className="min-w-0 flex-1 bg-transparent border-b border-nomi-accent/40 text-micro text-nomi-ink outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onClick={() => setExpanded((value) => !value)}
          onContextMenu={(event) => onContextMenu?.(event, group.id)}
          aria-expanded={expanded}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-nomi-sm',
            'text-micro text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05',
          )}
          title={group.name}
        >
          <span className="w-3 text-micro text-nomi-ink-40" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <span
            className="h-2.5 w-2.5 rounded-full border border-nomi-line shrink-0"
            style={{ backgroundColor: group.color || DEFAULT_GROUP_TINT }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <span className="shrink-0 tabular-nums text-micro text-nomi-ink-40">{nodes.length}</span>
        </button>
      )}
      {expanded ? (
        <div className="pb-1">
          {nodes.length ? (
            nodes.map((node) => (
              <NodeItem
                key={node.id}
                node={node}
                active={selectedNodeIds.includes(node.id)}
                depth={1}
                onSelect={onSelectNode}
                onContextMenu={onNodeContextMenu}
              />
            ))
          ) : (
            <div className="px-7 py-1.5 text-micro text-nomi-ink-30">{t('libraries.sidebar.emptyGroup')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
