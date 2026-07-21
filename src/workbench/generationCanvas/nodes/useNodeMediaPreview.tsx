import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import NodeMediaPreviewDialog from './NodeMediaPreviewDialog'
import NodeResultDownloadButton from './NodeResultDownloadButton'

/** 图片工具条与视频结果浮条共用的预览状态/渲染出口。 */
export function useNodeMediaPreview(
  node: GenerationCanvasNode,
  resultActionsSelected: boolean,
): { openMediaPreview: () => void; mediaPreviewControls: JSX.Element } {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const openMediaPreview = React.useCallback(() => setOpen(true), [])
  const closeMediaPreview = React.useCallback(() => setOpen(false), [])
  const result = node.result
  return {
    openMediaPreview,
    mediaPreviewControls: (
      <>
        <NodeResultDownloadButton node={node} selected={resultActionsSelected} onPreview={openMediaPreview} />
        {open && result?.url && (result.type === 'image' || result.type === 'video') ? (
          <NodeMediaPreviewDialog
            mediaType={result.type}
            url={result.url}
            title={
              node.title ||
              (result.type === 'video'
                ? t('generationCommon.imagePreview.video')
                : t('generationCommon.imagePreview.image'))
            }
            onClose={closeMediaPreview}
          />
        ) : null}
      </>
    ),
  }
}
