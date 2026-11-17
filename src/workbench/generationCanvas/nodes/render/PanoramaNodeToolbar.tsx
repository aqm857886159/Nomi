import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconDownload, IconMaximize, IconUpload } from '@tabler/icons-react'
import { FloatingToolbarShell, TOOLBAR_ICON as TBI, ToolbarButton, ToolbarDivider, ToolbarVariantProvenanceActions } from '../NodeFloatingToolbar'
import { useResultDownload } from '../useResultDownload'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { acceptAttrForSurface } from '../../../../../electron/shared/contracts/mediaImportPolicy'

const PANORAMA_UPLOAD_ACCEPT = acceptAttrForSurface('panorama')

/**
 * 全景节点的浮条（预览 / 重新上传 / 下载 / 出处）。从 BaseGenerationNode 原样搬出：宿主是登记在案的巨壳
 * （check:filesize 有基线、只许减不许增），这一块自成一单元，只靠宿主传进来的三个句柄工作。
 */
export default function PanoramaNodeToolbar({ node, reportFeedback, fullscreenRef, uploadInputRef, onFileChange, onOpenProvenance }: {
  node: GenerationCanvasNode
  reportFeedback: (message: string) => void
  fullscreenRef: React.RefObject<(() => void) | null>
  uploadInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: React.ChangeEventHandler<HTMLInputElement>
  onOpenProvenance: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { downloading, download } = useResultDownload(node, reportFeedback)
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.node.panoramaActions')} nodeId={node.id}>
      <ToolbarButton
        icon={<IconMaximize size={TBI.size} stroke={TBI.stroke} />}
        label={t('generationCommon.node.panoramaPreview')}
        title={t('generationCommon.node.panoramaPreview')}
        onClick={() => fullscreenRef.current?.()}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<IconUpload size={TBI.size} stroke={TBI.stroke} />}
        label={t('generationCommon.node.reupload')}
        title={t('generationCommon.node.reuploadPanorama')}
        onClick={() => uploadInputRef.current?.click()}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<IconDownload size={TBI.size} stroke={TBI.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        title={t('generationCommon.resultDownload.downloadHint')}
        disabled={downloading}
        onClick={download}
      />
      <ToolbarVariantProvenanceActions nodeId={node.id} onOpenProvenance={onOpenProvenance} />
      <input ref={uploadInputRef} className="hidden" type="file" accept={PANORAMA_UPLOAD_ACCEPT} onChange={onFileChange} />
    </FloatingToolbarShell>
  )
}
