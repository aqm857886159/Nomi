import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCopy } from '@tabler/icons-react'
import { ICON_TIERS } from '../../../design'
import { getBuiltinCategoryById } from '../../project/projectCategories'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById, selectCanvasNodeExists } from '../store/canvasNodeGenerationIndex'
import { FOCUS_GENERATION_NODE_EVENT } from './nodeSizing'

/**
 * E.2C-25 副本角标：跨分类独立副本永久显示（derivedFrom 仅承载此语义；同分类重生成在 regeneratedFrom）。
 * 点它定位回源节点；源节点没了就灰掉并说清。从 BaseGenerationNode 搬出（按职责拆巨壳），行为不变。
 */
export function NodeIndependentCopyBadge({ derivedFrom }: { derivedFrom: string }): JSX.Element {
  const { t } = useTranslation()
  // S3(2026-09-12)：这几条原先各扫一遍 state.nodes。每张卡都挂一份，
  // 全选拖动时 N 张卡每帧各扫一遍全表 = O(N²)。改走 canvasNodeGenerationIndex 的
  // 单次派生索引（每个 store 版本算一次，每张卡只读自己那一格）。
  const sourceNodeTitle = useGenerationCanvasStore((state) => selectCanvasNodeById(state, derivedFrom)?.title)
  const sourceNodeCategoryId = useGenerationCanvasStore((state) => selectCanvasNodeById(state, derivedFrom)?.categoryId)
  const sourceNodeExists = useGenerationCanvasStore((state) => selectCanvasNodeExists(state, derivedFrom))
  const handleFocusSourceNode = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: derivedFrom } }))
    },
    [derivedFrom],
  )
  // 2026-09-05：这几条的 zh+en 词条一直都在，只是渲染处写死了中文（英文界面恒显中文），现接回词条。
  const sourceNodeLabel = sourceNodeTitle || (!sourceNodeExists ? t('generationCommon.node.sourceMissing') : derivedFrom)
  const sourceCategoryName = sourceNodeCategoryId ? getBuiltinCategoryById(sourceNodeCategoryId)?.name : null
  const independentCopyLabel =
    sourceCategoryName && sourceNodeExists
      ? t('generationCommon.node.copyFromCategory', { category: sourceCategoryName, source: sourceNodeLabel })
      : sourceNodeExists
        ? t('generationCommon.node.copyFrom', { source: sourceNodeLabel })
        : t('generationCommon.node.copySourceMissing')
  return (
    <button
      type="button"
      className="generation-canvas-v2-node__derived-badge"
      aria-label={
        sourceNodeExists
          ? t('generationCommon.node.locateSource', { source: sourceNodeLabel })
          : t('generationCommon.node.sourceNoLongerExists')
      }
      title={independentCopyLabel}
      disabled={!sourceNodeExists}
      onClick={handleFocusSourceNode}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconCopy size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden="true" />
      <span>{t('generationCommon.node.independentCopy')}</span>
    </button>
  )
}
