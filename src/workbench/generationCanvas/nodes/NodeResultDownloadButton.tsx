import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconDownload, IconSparkles } from '@tabler/icons-react'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDuplicateVariantButton, ToolbarIconButton, ToolbarProvenanceButton } from './NodeFloatingToolbar'
import { anchorFreezeToolbarProps } from '../fixation/freezeAnchor'
import NodeVideoFrameToolbar from './NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 非图片结果（视频等）的浮条：视频结果 → 抽首帧/抽尾帧 + 下载（NodeVideoFrameToolbar）；
// 其它非图片结果 → 仅下载。图片结果的下载在 ImageQuickActionsToolbar。仅在选中且有可下载结果时渲染。

type Props = {
  reportFeedback: (message: string) => void
  node: GenerationCanvasNode
  selected: boolean
  onPreview: () => void
  /** 生成记录（从卡片右上角迁来；这条链覆盖视频与其它非图片结果）。 */
  onOpenProvenance: () => void
}

export default function NodeResultDownloadButton({ reportFeedback, node, selected, onPreview, onOpenProvenance }: Props): JSX.Element | null {

  const { t } = useTranslation()
  const { canDownload, downloading, download } = useResultDownload(node, reportFeedback)
  if (!selected || !canDownload || node.result?.type === 'image') return null

  // 视频结果 → 专用浮条（抽首/尾帧 + 下载）。
  if (node.result?.type === 'video') {
    return <><NodeVideoFrameToolbar reportFeedback={reportFeedback} node={node} downloading={downloading} onDownload={download} onPreview={onPreview} onOpenProvenance={onOpenProvenance} /></>
  }

  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.resultDownload.actions')} nodeId={node.id}>

      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        title={t('generationCommon.resultDownload.downloadHint')}
        disabled={downloading}
        onClick={download}
      />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
      {(() => {
        const freeze = anchorFreezeToolbarProps(node)
        return freeze.canFreezeShot && freeze.onToggleFreeze ? (
          <ToolbarIconButton
            actionId="toggle-frozen"
            icon={freeze.frozen ? <IconCheck size={I.size} stroke={I.stroke} /> : <IconSparkles size={I.size} stroke={I.stroke} />}
            title={freeze.frozen ? t('generationCommon.imageToolbar.shotFinalizedHint') : t('generationCommon.imageToolbar.shotFinalizeHint')}
            ariaLabel={freeze.frozen ? t('generationCommon.imageToolbar.shotFinalized') : t('generationCommon.imageToolbar.shotFinalize')}
            onClick={freeze.onToggleFreeze}
          />
        ) : null
      })()}
      <ToolbarProvenanceButton onOpen={onOpenProvenance} />
    </FloatingToolbarShell>
  )
}
