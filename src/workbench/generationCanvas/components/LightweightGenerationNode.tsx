import React from 'react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getNodeSize } from './generationCanvasGeometry'

/**
 * 画布远景/超载时的轻量节点占位（LOD 低档）：只画标题 + 状态条，不挂任何
 * 生成 body / 媒体 / 工具条。从 GenerationCanvas.tsx 抽出（R9 防巨壳），渲染逻辑逐字不动。
 */
export function LightweightGenerationNode({
  node,
  appear,
  onSelect,
}: {
  node: GenerationCanvasNode
  appear: boolean
  onSelect: (nodeId: string, additive: boolean) => void
}): JSX.Element {
  const size = getNodeSize(node)
  const status = node.status || 'idle'
  const statusLabel =
    status === 'queued'
      ? '排队中'
      : status === 'running'
        ? node.progress?.message || '生成中'
        : status === 'error'
          ? '失败'
          : status === 'success'
            ? '已生成'
            : '待生成'
  return (
    <article
      className={cn(
        'generation-canvas-v2-node',
        'absolute p-0 border-0 rounded-none bg-transparent shadow-none',
        'cursor-pointer select-none touch-none overflow-visible',
        'block',
      )}
      data-node-id={node.id}
      data-kind={node.kind}
      data-render-mode="lightweight"
      data-appear={appear ? 'true' : undefined}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: size.width,
        height: size.height,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey)
      }}
    >
      <div
        className={cn(
          'w-full h-full overflow-hidden rounded-nomi border border-nomi-line',
          'bg-nomi-paper/90 shadow-nomi-sm',
          'grid grid-rows-[4px_minmax(0,1fr)]',
        )}
      >
        <div
          className={cn(
            'w-full',
            status === 'error'
              ? 'bg-workbench-danger'
              : status === 'success'
                ? 'bg-workbench-success'
                : status === 'queued' || status === 'running'
                  ? 'bg-nomi-accent'
                  : 'bg-nomi-ink-20',
          )}
        />
        <div className="min-w-0 min-h-0 p-3 flex flex-col justify-between gap-2">
          <div className="min-w-0 truncate text-body-sm font-medium text-nomi-ink">
            {node.title || '未命名节点'}
          </div>
          <div className="min-w-0 truncate text-micro text-nomi-ink-50">
            {statusLabel}
          </div>
        </div>
      </div>
    </article>
  )
}
