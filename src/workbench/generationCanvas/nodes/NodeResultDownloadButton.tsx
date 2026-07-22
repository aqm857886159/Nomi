import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDownload } from '@tabler/icons-react'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton } from './NodeFloatingToolbar'
import NodeVideoFrameToolbar from './NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 非图片结果（视频等）的浮条：视频结果 → 抽首帧/抽尾帧 + 下载（NodeVideoFrameToolbar）；
// 其它非图片结果 → 仅下载。图片结果的下载在 NodeImageEditToolbar。仅在选中且有可下载结果时渲染。

type Props = {
  node: GenerationCanvasNode
  selected: boolean
  onPreview: () => void
}

export default function NodeResultDownloadButton({ node, selected, onPreview }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const { canDownload, downloading, download } = useResultDownload(node)
  if (!selected || !canDownload || node.result?.type === 'image') return null

  // 视频结果 → 专用浮条（抽首/尾帧 + 下载）。
  if (node.result?.type === 'video') {
    return <NodeVideoFrameToolbar node={node} downloading={downloading} onDownload={download} onPreview={onPreview} />
  }

  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.resultDownload.actions')}>
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        title={t('generationCommon.resultDownload.downloadHint')}
        disabled={downloading}
        onClick={download}
      />
    </FloatingToolbarShell>
  )
}
