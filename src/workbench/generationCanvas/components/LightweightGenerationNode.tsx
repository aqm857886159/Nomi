import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getCanvasNodeVisualSize } from './generationCanvasGeometry'
import { resolveLightweightNodePreview } from './canvasNodeLevelOfDetail'
import { DeferredNodeImage, DeferredNodeVideo } from '../nodes/DeferredNodeMedia'

/**
 * 画布远景/超载时的轻量节点占位（LOD 低档）：保留结果媒体缩略图，
 * 不挂生成 body 或工具条。从 GenerationCanvas.tsx 抽出（R9 防巨壳）。
 */
export function LightweightGenerationNode({
  node,
  appear,
  selected = false,
  readOnly = false,
}: {
  node: GenerationCanvasNode
  appear: boolean
  selected?: boolean
  readOnly?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const size = getCanvasNodeVisualSize(node)
  const preview = resolveLightweightNodePreview(node)
  const status = node.status || 'idle'
  const statusLabel =
    status === 'queued'
      ? t('generationCommon.lightweightNode.queued')
      : status === 'running'
        ? node.progress?.message || t('generationCommon.lightweightNode.running')
        : status === 'error'
          ? t('generationCommon.lightweightNode.error')
          : status === 'success'
            ? t('generationCommon.lightweightNode.success')
            : t('generationCommon.lightweightNode.idle')
  return (
    <article
      className={cn(
        'generation-canvas-v2-node',
        'absolute p-0 border-0 rounded-none bg-transparent shadow-none',
        readOnly ? 'cursor-default' : 'cursor-pointer',
        'select-none touch-none overflow-visible',
        'block',
      )}
      data-node-id={node.id}
      data-kind={node.kind}
      data-selected={selected ? 'true' : 'false'}
      data-render-mode="lightweight"
      data-appear={appear ? 'true' : undefined}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: size.width,
        height: size.height,
      }}
    >
      <div
        className={cn(
          'w-full h-full overflow-hidden rounded-nomi border',
          selected ? 'border-nomi-accent ring-2 ring-nomi-accent' : 'border-nomi-line',
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
        <div className="relative min-w-0 min-h-0 overflow-hidden bg-nomi-ink-05">
          {preview?.kind === 'image' ? (
            <DeferredNodeImage
              src={preview.src}
              alt=""
              className="absolute inset-0 size-full object-cover pointer-events-none"
            />
          ) : preview?.kind === 'video' ? (
            <DeferredNodeVideo
              src={preview.src}
              className="absolute inset-0 size-full object-cover pointer-events-none"
              crossOrigin="use-credentials"
              muted
              playsInline
              preload="metadata"
              controls={false}
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 flex min-w-0 flex-col gap-1 bg-nomi-paper/90 p-3">
            <div className="min-w-0 truncate text-body-sm font-medium text-nomi-ink">
              {node.title || t('generationCommon.lightweightNode.untitled')}
            </div>
            <div className="min-w-0 truncate text-micro text-nomi-ink-40">
              {statusLabel}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
