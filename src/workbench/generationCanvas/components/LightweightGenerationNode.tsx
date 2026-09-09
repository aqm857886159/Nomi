import React from 'react'
import { NodeGenerationStatus } from '../nodes/NodeGenerationStatus'
import { NodeLabelRow } from '../nodes/NodeLabelRow'
import { ShotPreviewOverlays } from '../nodes/ConvertShotToVideoButton'
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
      <NodeLabelRow>
        <ShotPreviewOverlays shotIndex={node.shotIndex ?? null} />
        <span className="min-w-0 flex-1 truncate font-normal text-nomi-ink-60">{node.title || t('generationCommon.lightweightNode.untitled')}</span>
      </NodeLabelRow>
      <div data-node-inline-status className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+40px)] z-[4] flex h-7 items-center [&_[data-generation-message]]:truncate [&_[data-generation-status]]:bg-nomi-paper/90">
        <NodeGenerationStatus node={node} />
      </div>
      <div
        className={cn(
          'w-full h-full overflow-hidden rounded-nomi border',
          selected ? 'border-nomi-accent ring-2 ring-nomi-accent' : 'border-nomi-line',
          'bg-nomi-paper/90 shadow-nomi-sm',
          'grid',
        )}
      >
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

        </div>
      </div>
    </article>
  )
}
