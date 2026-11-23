import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKBENCH_MENU_TRIGGER_OPEN_CLASS } from '../../design'
import { cn } from '../../utils/cn'
import type { GenerationCanvasNode, NodeGroup } from '../generationCanvas/model/generationCanvasTypes'
import {
  GROUP_DRAG_MIME,
  NODE_DRAG_EXPAND_DELAY_MS,
  NODE_DRAG_MIME,
  classifySidebarDrag,
} from './groupDragDisclosure'
import NodeItem from './NodeItem'
import { GROUP_VISUAL_CLASS } from '../generationCanvas/components/groupVisualContract'

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
  /** 子组头这一行的右键菜单（只包子组头 <button>，不包成员列表——成员各有各的菜单）。 */
  contextMenu?: (trigger: React.ReactElement) => React.ReactElement
  /** 成员节点行的右键菜单。 */
  nodeContextMenu?: (nodeId: string) => (trigger: React.ReactElement) => React.ReactElement
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
  contextMenu,
  nodeContextMenu,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(!group.collapsed)
  const [dragOver, setDragOver] = React.useState(false)
  const expandTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // 已提交/取消标记：避免 Enter/Escape 后 input 再 blur 触发二次提交。
  const settledRef = React.useRef(false)
  React.useEffect(() => {
    if (editing) settledRef.current = false
  }, [editing])

  const clearExpandTimer = React.useCallback(() => {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
    expandTimerRef.current = null
  }, [])

  React.useEffect(() => clearExpandTimer, [clearExpandTimer])

  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(GROUP_DRAG_MIME, group.id)
      event.dataTransfer.effectAllowed = 'move'
    },
    [group.id],
  )

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const dragKind = classifySidebarDrag(Array.from(event.dataTransfer?.types || []))
      if (!dragKind) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (!dragOver) setDragOver(true)
      if (dragKind === 'node' && !expanded && !expandTimerRef.current) {
        expandTimerRef.current = setTimeout(() => {
          setExpanded(true)
          expandTimerRef.current = null
        }, NODE_DRAG_EXPAND_DELAY_MS)
      }
    },
    [dragOver, expanded],
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const nodeId = event.dataTransfer.getData(NODE_DRAG_MIME)
      const activeGroupId = event.dataTransfer.getData(GROUP_DRAG_MIME)
      clearExpandTimer()
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
    [clearExpandTimer, group.id, onDropGroup, onDropNode],
  )

  const handleDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      clearExpandTimer()
      setDragOver(false)
    },
    [clearExpandTimer],
  )

  const wrapHeader = contextMenu ?? ((trigger: React.ReactElement) => trigger)
  return (
    <div
      className={cn(
        'rounded-nomi-sm border border-nomi-line/70 bg-nomi-paper/35',
        dragOver && 'ring-2 ring-nomi-ink-30',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {editing ? (
        <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-nomi-sm text-micro text-nomi-ink-60">
          <span className="w-3 text-micro text-nomi-ink-40" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <span
            className={cn('size-2.5 shrink-0 rounded-full border', GROUP_VISUAL_CLASS.marker)}
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
            className="min-w-0 flex-1 border-b border-nomi-ink-30 bg-transparent text-micro text-nomi-ink outline-none focus:border-nomi-ink-60"
          />
        </div>
      ) : wrapHeader(
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-nomi-sm',
            'text-micro text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05',
            // 子组行没有选中态：菜单开着一律走统一打开态。
            WORKBENCH_MENU_TRIGGER_OPEN_CLASS,
          )}
          title={group.name}
        >
          <span className="w-3 text-micro text-nomi-ink-40" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <span
            className={cn('size-2.5 shrink-0 rounded-full border', GROUP_VISUAL_CLASS.marker)}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <span className="shrink-0 tabular-nums text-micro text-nomi-ink-40">{nodes.length}</span>
        </button>,
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
                onDragStartNode={() => setExpanded(false)}
                contextMenu={nodeContextMenu?.(node.id)}
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
