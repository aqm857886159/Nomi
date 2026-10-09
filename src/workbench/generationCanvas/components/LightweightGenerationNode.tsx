import React, { type JSX } from 'react'
import { NodeGenerationStatus } from '../nodes/NodeGenerationStatus'
import { NodeLabelRow } from '../nodes/NodeLabelRow'
import { useShotIdentity } from '../hooks/useNodeRelationships'
import { NodeShotLabel } from '../../generation/list/CanvasListLinks'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getCanvasNodeVisualSize } from './generationCanvasGeometry'
import { resolveLightweightNodePreview } from './canvasNodeLevelOfDetail'
import { useNodeMediaMeasurement } from '../nodes/useNodeMediaMeasurement'
import { readNodeCardInfoHeight } from '../nodes/nodeSizing'
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
  const shotIdentity = useShotIdentity(node.id)
  const size = getCanvasNodeVisualSize(node)
  const preview = resolveLightweightNodePreview(node)
  const mediaMeasurement = useNodeMediaMeasurement(node)
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
      // 身份三件套（id / kind / status）在**每一档 LOD 上都要在**：它们回答的是「这张卡是谁、
      // 现在是什么状态」，与「这一档画多细」无关。2026-09-15 的屏幕尺寸 LOD（#787 的另一半）
      // 就是在这里栽的：卡片一拿到结果媒体就掉进轻量档，而轻量档没有 data-status，于是
      // 「重试成功了吗」这件事在 DOM 上凭空消失（走查等不到 success，实际上生成是成功的）。
      // 结论不是「测试写太死」，是这一层的契约漏了一格——补在这里，任何 LOD 判据改动都不再能弄丢它。
      data-status={node.status}
      data-render-mode="lightweight"
      data-appear={appear ? 'true' : undefined}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: size.width,
        height: size.height,
      }}
    >
      <NodeLabelRow>
        <NodeShotLabel node={node} shotRole={shotIdentity.shotRole}>
          <span className="min-w-0 flex-1 truncate font-normal text-nomi-ink-60">{node.title || t('generationCommon.lightweightNode.untitled')}</span>
        </NodeShotLabel>
      </NodeLabelRow>
      <div data-node-inline-status className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+40px)] z-[4] flex h-7 items-center [&_[data-generation-message]]:truncate [&_[data-generation-status]]:bg-nomi-paper/90">
        <NodeGenerationStatus node={node} />
      </div>
      <div
        className={cn(
          'w-full h-full overflow-hidden rounded-nomi ring-1 ring-inset',
          selected ? 'ring-2 ring-nomi-accent' : 'ring-nomi-line',
          'bg-nomi-paper/90 shadow-nomi-sm',
          'grid',
        )}
      >
        <div className="relative min-w-0 min-h-0 overflow-hidden bg-nomi-ink-05" style={{ height: size.height - readNodeCardInfoHeight(node) }}>
          {preview?.kind === 'image' ? (
            <DeferredNodeImage
              src={preview.src}
              alt=""
              onLoad={mediaMeasurement.onImageLoad}
              className="absolute inset-0 size-full object-contain pointer-events-none"
            />
          ) : preview?.kind === 'video' ? (
            <DeferredNodeVideo
              src={preview.src}
              className="absolute inset-0 size-full object-contain pointer-events-none"
              crossOrigin="use-credentials"
              muted
              playsInline
              preload="metadata"
              controls={false}
              onLoadedMetadata={mediaMeasurement.onVideoMetadata}
            />
          ) : null}

        </div>
      </div>
    </article>
  )
}
