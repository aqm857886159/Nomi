/**
 * SceneCardNode body — 场景分类节点（v0.8 极简版）。
 *
 * 信息条仍 absolute 浮在主图底部（保留场景"沉浸全图"的视觉），
 * 但只在有名字 / mood / usage 时渲染。
 * 场景名 inline 可编辑。
 */
import React from 'react'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readSceneMeta } from '../../model/nodeMetaFields'
import { useNodeUsageCount, useNodeVariantCount } from '../../hooks/useNodeRelationships'
import { STRIPED_BG_CLASS, UsageDot, VariantChip, UploadFallback } from './CardCommon'
import { useNodeImageUpload } from '../../adapters/useNodeImageUpload'
import { EditableNodeTitle } from './EditableNodeTitle'

type Props = {
  node: GenerationCanvasNode
}

function SceneCardNodeImpl({ node }: Props): JSX.Element {
  const meta = readSceneMeta(node)
  const usageCount = useNodeUsageCount(node.id, node.title)
  const variantCount = useNodeVariantCount(node.id)
  const hasImage = Boolean(node.result?.url)
  const handleUpload = useNodeImageUpload(node.id, 'scene-card-upload')

  const hasMood = Boolean(meta.mood && meta.mood.length > 0)
  const hasTitle = Boolean(node.title && node.title.trim().length > 0)
  const hasInfoBar = hasImage && (hasTitle || hasMood || usageCount > 0 || variantCount > 0)

  return (
    <div className={cn('relative w-full h-full rounded-nomi overflow-hidden bg-nomi-paper')}>
      <div className={cn('w-full h-full overflow-hidden', !hasImage && STRIPED_BG_CLASS)}>
        {hasImage ? (
          <NomiImage
            src={node.result!.url!}
            alt={node.title || ''}
            className="w-full h-full object-contain object-center select-none pointer-events-none"
          />
        ) : (
          <UploadFallback accept="image/*" label="场景图" onUpload={handleUpload} />
        )}
      </div>

      {hasInfoBar ? (
        <div
          className={cn(
            'absolute bottom-2 left-2 right-2',
            'px-3 py-2 rounded-nomi-sm',
            'bg-nomi-ink/[0.78] backdrop-blur-md text-nomi-paper',
            'flex flex-col gap-0.5',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <EditableNodeTitle
              nodeId={node.id}
              value={node.title || ''}
              placeholder="未命名场景"
              className="text-nomi-paper"
            />
            <span className="flex items-center gap-1">
              <UsageDot count={usageCount} />
              <VariantChip count={variantCount} />
            </span>
          </div>
          {hasMood ? (
            <span className="text-micro text-nomi-paper/80">
              {meta.mood!.join(' · ')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const SceneCardNode = React.memo(SceneCardNodeImpl, (prev, next) => prev.node === next.node)
SceneCardNode.displayName = 'SceneCardNode'
export default SceneCardNode
