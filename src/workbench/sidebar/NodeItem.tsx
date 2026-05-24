import React from 'react'
import { cn } from '../../utils/cn'
import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'

const NODE_KIND_LABEL: Partial<Record<GenerationCanvasNode['kind'], string>> = {
  text: '文',
  character: '角',
  scene: '景',
  image: '图',
  keyframe: '帧',
  video: '影',
  shot: '镜',
  output: '出',
  panorama: '全',
}

type Props = {
  node: GenerationCanvasNode
  active?: boolean
  depth?: number
  onSelect?: (nodeId: string) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, nodeId: string) => void
}

export default function NodeItem({ node, active = false, depth = 0, onSelect, onContextMenu }: Props): JSX.Element {
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/x-nomi-node-id', node.id)
    event.dataTransfer.effectAllowed = 'move'
  }, [node.id])

  const handleClick = React.useCallback(() => {
    onSelect?.(node.id)
  }, [node.id, onSelect])

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onContextMenu={(event) => onContextMenu?.(event, node.id)}
      data-node-id={node.id}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        'text-[11px] leading-tight border border-transparent',
        active
          ? 'bg-nomi-accent/10 text-nomi-accent border-nomi-accent/20'
          : 'text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
      )}
      style={{ paddingLeft: `${8 + depth * 10}px` }}
      title={node.title || node.id}
    >
      <span className="grid place-items-center h-4 w-4 shrink-0 rounded bg-nomi-ink-05 text-[9px] text-nomi-ink-50" aria-hidden>
        {NODE_KIND_LABEL[node.kind] || '节'}
      </span>
      <span className="min-w-0 flex-1 truncate">{node.title || node.id}</span>
      {node.derivedFrom ? (
        <span className="shrink-0 rounded-full bg-nomi-accent/10 px-1.5 py-0.5 text-[9px] text-nomi-accent" title="由其他节点派生">
          ↩
        </span>
      ) : null}
    </button>
  )
}
