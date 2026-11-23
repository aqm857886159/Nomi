import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKBENCH_MENU_TRIGGER_OPEN_CLASS } from '../../design'
import { cn } from '../../utils/cn'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { NODE_DRAG_MIME } from './groupDragDisclosure'

const SHORT_LABEL_KINDS = new Set<GenerationCanvasNode['kind']>([
  'text',
  'character',
  'scene',
  'image',
  'keyframe',
  'video',
  'shot',
  'output',
  'panorama',
])

type Props = {
  node: GenerationCanvasNode
  active?: boolean
  depth?: number
  onSelect?: (nodeId: string) => void
  onDragStartNode?: (nodeId: string) => void
  /**
   * 右键菜单：把这一行（真实 <button>）包成触发器（`WorkbenchContextMenu`）。由分类树 / 子组给，行自己不认识菜单内容；
   * 菜单开着时行带 `data-state="open"`，非激活态叠 `WORKBENCH_MENU_TRIGGER_OPEN_CLASS` 显出打开态。
   */
  contextMenu?: (trigger: React.ReactElement) => React.ReactElement
}

export default function NodeItem({
  node,
  active = false,
  depth = 0,
  onSelect,
  onDragStartNode,
  contextMenu,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const shortKind = SHORT_LABEL_KINDS.has(node.kind) ? node.kind : 'fallback'
  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(NODE_DRAG_MIME, node.id)
      event.dataTransfer.effectAllowed = 'move'
      onDragStartNode?.(node.id)
    },
    [node.id, onDragStartNode],
  )

  const handleClick = React.useCallback(() => {
    onSelect?.(node.id)
  }, [node.id, onSelect])

  const row = (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      data-node-id={node.id}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'w-full flex items-center gap-2 rounded-nomi-sm px-2 py-1.5 text-left transition-colors',
        'text-micro leading-tight border border-transparent',
        active ? 'bg-nomi-ink-10 text-nomi-ink' : cn('text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink', WORKBENCH_MENU_TRIGGER_OPEN_CLASS),
      )}
      style={{ paddingLeft: `${8 + depth * 10}px` }}
      title={node.title || node.id}
    >
      <span
        className="grid place-items-center h-4 w-4 shrink-0 rounded-nomi-sm bg-nomi-ink-05 text-micro text-nomi-ink-40"
        aria-hidden
      >
        {t(`libraries.sidebar.nodeKindShort.${shortKind}`)}
      </span>
      <span className="min-w-0 flex-1 truncate">{node.title || node.id}</span>
      {node.derivedFrom ? (
        <span
          className="shrink-0 rounded-full bg-nomi-accent/10 px-1.5 py-0.5 text-micro text-nomi-accent"
          title={t('sidebar.derivedNode')}
        >
          ↩
        </span>
      ) : null}
    </button>
  )
  return contextMenu ? contextMenu(row) : row
}
