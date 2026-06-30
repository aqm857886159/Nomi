/**
 * PropCardNode body — 道具分类节点（v0.8 极简版）。
 *
 * - 信息区按内容条件渲染（空则 0px）。
 * - 道具名 inline 可编辑。
 */
import React from 'react'
import { IconLink } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readPropMeta } from '../../model/nodeMetaFields'
import { useNodeUsageCount } from '../../hooks/useNodeRelationships'
import { STRIPED_BG_CLASS, UsageDot, UploadFallback } from './CardCommon'
import { useNodeImageUpload } from '../../adapters/useNodeImageUpload'
import { EditableNodeTitle } from './EditableNodeTitle'
import { DeferredNodeImage } from '../DeferredNodeMedia'

type Props = {
  node: GenerationCanvasNode
}

function PropCardNodeImpl({ node }: Props): JSX.Element {
  const meta = readPropMeta(node)
  const usageCount = useNodeUsageCount(node.id, node.title)
  const hasImage = Boolean(node.result?.url)
  const handleUpload = useNodeImageUpload(node.id, 'prop-card-upload')

  const hasOwner = Boolean(meta.ownedBy)
  const hasUsage = usageCount > 0
  const hasInfoArea = hasImage || hasOwner || hasUsage

  return (
    <div className={cn('w-full h-full flex flex-col rounded-nomi-sm overflow-hidden bg-nomi-paper')}>
      <div className={cn('relative w-full flex-1 min-h-0 overflow-hidden', !hasImage && STRIPED_BG_CLASS)}>
        {hasImage ? (
          <DeferredNodeImage
            src={node.result!.url!}
            alt={node.title || ''}
            className="w-full h-full object-contain object-center select-none pointer-events-none"
          />
        ) : (
          <UploadFallback accept="image/*" label="道具图" onUpload={handleUpload} />
        )}
      </div>

      {hasInfoArea ? (
        <div className="shrink-0 px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <EditableNodeTitle
              nodeId={node.id}
              value={node.title || ''}
              placeholder="未命名道具"
            />
            <UsageDot count={usageCount} />
          </div>
          {hasOwner ? (
            <span className="inline-flex items-center gap-1 text-caption font-medium text-nomi-accent">
              <IconLink size={13} stroke={1.8} aria-hidden />
              <span className="truncate" title={`属于 ${meta.ownedBy}`}>
                {meta.ownedBy}的
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const PropCardNode = React.memo(PropCardNodeImpl, (prev, next) => prev.node === next.node)
PropCardNode.displayName = 'PropCardNode'
export default PropCardNode
