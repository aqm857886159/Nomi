/**
 * CharacterCardNode body — 角色分类节点的渲染主体。
 *
 * v0.8 极简版：
 * - 删了固定 80px "信息区"；内容空时不渲染。
 * - 删了顶部 "角色" tag（父分组已经标了）。
 * - 删了图像内层 border（避免圆角套圆角）。
 * - 角色名 inline 可编辑（单击进入编辑态，失焦保存）。
 *
 * 注：本组件**只渲染卡片 body**。节点拖动 / 选中 / 缩放 仍由 BaseGenerationNode 提供。
 */
import React from 'react'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readCharacterMeta } from '../../model/nodeMetaFields'
import { useNodeUsageCount, useNodeVariantCount } from '../../hooks/useNodeRelationships'
import { STRIPED_BG_CLASS, UsageDot, VariantChip, UploadFallback } from './CardCommon'
import { useNodeImageUpload } from '../../adapters/useNodeImageUpload'
import { EditableNodeTitle } from './EditableNodeTitle'

type Props = {
  node: GenerationCanvasNode
}

function CharacterCardNodeImpl({ node }: Props): JSX.Element {
  const meta = readCharacterMeta(node)
  const usageCount = useNodeUsageCount(node.id, node.title)
  const variantCount = useNodeVariantCount(node.id)
  const handleUpload = useNodeImageUpload(node.id, 'character-card-upload')
  const hasImage = Boolean(node.result?.url)

  // 当三种内容都为空时，信息区整段不渲染——节点只剩图（或占位）。
  const hasTagline = Boolean(meta.tagline)
  const hasUsage = usageCount > 0
  const hasVariant = variantCount > 0
  const hasInfoArea = hasImage || hasTagline || hasUsage || hasVariant

  return (
    <div className={cn('w-full h-full flex flex-col rounded-nomi-sm overflow-hidden bg-nomi-paper')}>
      <div className={cn('w-full flex-1 min-h-0 overflow-hidden', !hasImage && STRIPED_BG_CLASS)}>
        {hasImage ? (
          <NomiImage
            src={node.result!.url!}
            alt={node.title || ''}
            className="w-full h-full object-contain object-center select-none pointer-events-none"
          />
        ) : (
          <UploadFallback accept="image/*" label="角色图" onUpload={handleUpload} />
        )}
      </div>

      {hasInfoArea ? (
        <div className="shrink-0 px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <EditableNodeTitle
              nodeId={node.id}
              value={node.title || ''}
              placeholder="未命名角色"
            />
            <UsageDot count={usageCount} />
          </div>
          {hasTagline ? (
            <span className="text-caption text-nomi-ink-60 truncate" title={meta.tagline}>
              {meta.tagline}
            </span>
          ) : null}
          {hasVariant ? (
            <div className="flex justify-end mt-auto">
              <VariantChip count={variantCount} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const CharacterCardNode = React.memo(CharacterCardNodeImpl, (prev, next) => prev.node === next.node)
CharacterCardNode.displayName = 'CharacterCardNode'
export default CharacterCardNode
