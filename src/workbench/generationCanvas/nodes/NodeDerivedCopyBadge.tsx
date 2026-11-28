// 跨分类独立副本角标（E.2C-25）：标签行里那颗「独立副本」，点了定位回来源节点。从 BaseGenerationNode 原样搬出（按职责拆）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCopy } from '@tabler/icons-react'
import { getBuiltinCategoryById } from '../../project/projectCategories'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById, selectCanvasNodeExists } from '../store/canvasNodeGenerationIndex'
import { FOCUS_GENERATION_NODE_EVENT } from './nodeSizing'

/** derivedFrom 仅承载「跨分类独立副本」语义（同分类重生成在 regeneratedFrom），所以只在有 derivedFrom 时挂。 */
export function NodeDerivedCopyBadge({ derivedFrom }: { derivedFrom: string }): JSX.Element {
  const { t } = useTranslation()
  // S3(2026-09-12)：这几条原先各扫一遍 state.nodes。每张卡都挂一份，
  // 全选拖动时 N 张卡每帧各扫一遍全表 = O(N²)。改走 canvasNodeGenerationIndex 的
  // 单次派生索引（每个 store 版本算一次，每张卡只读自己那一格）。
  const sourceNodeTitle = useGenerationCanvasStore(
    (state) => selectCanvasNodeById(state, derivedFrom)?.title,
  )
  const sourceNodeCategoryId = useGenerationCanvasStore(
    (state) => selectCanvasNodeById(state, derivedFrom)?.categoryId,
  )
  const sourceNodeExists = useGenerationCanvasStore((state) =>
    selectCanvasNodeExists(state, derivedFrom),
  )
  const handleFocusSourceNode = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!derivedFrom || typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: derivedFrom } }))
    },
    [derivedFrom],
  )
  // 2026-09-05：这几条的 zh+en 词条一直都在，只是渲染处写死了中文（英文界面恒显中文），现接回词条。
  const sourceNodeLabel = sourceNodeTitle || (derivedFrom && !sourceNodeExists ? t('generationCommon.node.sourceMissing') : derivedFrom || '')
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
      <IconCopy size={13} stroke={1.8} aria-hidden="true" />
      <span>{t('generationCommon.node.independentCopy')}</span>
    </button>
  )
}
