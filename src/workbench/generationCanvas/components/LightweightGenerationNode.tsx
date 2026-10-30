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
import { getGenerationNodeIcon } from '../nodes/renderRegistry'
import { NodeHoverTimelineHandle } from '../nodes/NodeFloatingToolbar'
import { NodeEmptyState } from '../nodes/render/NodeEmptyState'
import { NodeEmptyStateProvider } from '../nodes/render/NodeEmptyStateProvider'
import { EMPTY_STATE_COMPACT_MIN_HEIGHT } from '../nodes/render/nodeEmptyStateLayout'

/**
 * 画布远景/超载时的轻量节点占位（LOD 低档）：保留结果媒体缩略图，
 * 不挂生成 body 或工具条。从 GenerationCanvas.tsx 抽出（R9 防巨壳）。
 */
export function LightweightGenerationNode({
  node,
  appear,
  selected = false,
  readOnly = false,
  loading = false,
}: {
  node: GenerationCanvasNode
  appear: boolean
  selected?: boolean
  readOnly?: boolean
  /** 这是 Suspense 兜底（该种类的渲染器 chunk 还没到）：不是真正的轻量档，chunk 一到整张卡会被换成另一棵树。 */
  loading?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const shotIdentity = useShotIdentity(node.id)
  const size = getCanvasNodeVisualSize(node)
  const bodyHeight = size.height - readNodeCardInfoHeight(node)
  const preview = resolveLightweightNodePreview(node)
  const mediaMeasurement = useNodeMediaMeasurement(node)
  const Icon = getGenerationNodeIcon(node.kind)
  // 「悬停也能拖」（用户 2026-10-12 拍板）远看时也算数：缩小画布往剪辑卡里拖素材就靠它。但几十张远看卡每张都挂一份
  // 就白加 DOM，所以光标进来才挂。用 mouse 事件、不用 pointer 事件：原生拖放一起手浏览器就发 pointercancel /
  // pointerleave，这时摘掉把手拖放就断了；拖放期间不发 mouse 事件，拖完才收。
  const [hovered, setHovered] = React.useState(false)
  const offersTimelineHandle = !readOnly && !loading
  return (
    <article
      className={cn(
        'generation-canvas-v2-node group/node',
        'absolute p-0 border-0 rounded-none bg-transparent shadow-none',
        readOnly ? 'cursor-default' : 'cursor-pointer',
        'select-none touch-none overflow-visible',
        'block',
      )}
      onMouseEnter={offersTimelineHandle ? () => setHovered(true) : undefined}
      onMouseLeave={offersTimelineHandle ? () => setHovered(false) : undefined}
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
      // 兜底态的卡一会儿就会被换掉（换掉那一刻，按下去还没抬起的点击会丢：浏览器不给被摘掉的元素发 click）。
      // 走查点卡前按这个标记等「卡已经是正式的」，和人等卡出来再点是同一件事。
      data-node-loading={loading ? 'true' : undefined}
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
      {hovered && offersTimelineHandle ? <NodeHoverTimelineHandle nodeId={node.id} /> : null}
      <div
        className={cn(
          'w-full h-full overflow-hidden rounded-nomi ring-1 ring-inset',
          'ring-nomi-line',
          'bg-nomi-paper/90 shadow-nomi-sm',
          'grid',
        )}
      >
        <div className="relative min-w-0 min-h-0 overflow-hidden bg-nomi-ink-05" style={{ height: bodyHeight }}>
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
          ) : (
            <NodeEmptyStateProvider engaged={false} readOnly>
              <NodeEmptyState icon={<Icon size={18} stroke={1.5} />} height={bodyHeight} strip={bodyHeight < EMPTY_STATE_COMPACT_MIN_HEIGHT} />
            </NodeEmptyStateProvider>
          )}

        </div>
      </div>
    </article>
  )
}
