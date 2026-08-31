import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCut,
  IconDownload,
  IconMaximize,
  IconMovie,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
} from '@tabler/icons-react'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarDivider,
  ToolbarIconButton,
  ToolbarMenu,
  ToolbarProvenanceButton,
} from './NodeFloatingToolbar'
import { extractVideoFrameToNode } from './extractVideoFrameToNode'
import NodeShotCutPanel from './NodeShotCutPanel'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 视频的三个取画面动作共享一个菜单；全屏、下载、生成记录保持右侧图标动作。

type Props = {
  node: GenerationCanvasNode
  downloading: boolean
  onDownload: (event: React.MouseEvent) => void
  onPreview: () => void
  /** 生成记录（从卡片右上角迁来）。 */
  onOpenProvenance: () => void
}

export default function NodeVideoFrameToolbar({
  node,
  downloading,
  onDownload,
  onPreview,
  onOpenProvenance,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState<'first' | 'last' | null>(null)
  const [shotCutOpen, setShotCutOpen] = React.useState(false)
  const extract = (which: 'first' | 'last') => {
    if (busy) return
    setBusy(which)
    void extractVideoFrameToNode(node, which).finally(() => setBusy(null))
  }
  return (
    <>
      {shotCutOpen ? <NodeShotCutPanel node={node} onClose={() => setShotCutOpen(false)} /> : null}
      <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')}>
        <ToolbarMenu
          icon={<IconMovie size={I.size} stroke={I.stroke} />}
          label={busy ? t('generationCommon.videoToolbar.extracting') : t('generationCommon.videoToolbar.capture')}
          disabled={busy !== null}
          items={[
            { kind: 'label', label: t('generationCommon.videoToolbar.captureGroup') },
            {
              icon: <IconPlayerTrackPrev size={I.size} stroke={I.stroke} />,
              label: t('generationCommon.videoToolbar.firstFrame'),
              onClick: () => extract('first'),
            },
            {
              icon: <IconPlayerTrackNext size={I.size} stroke={I.stroke} />,
              label: t('generationCommon.videoToolbar.lastFrame'),
              onClick: () => extract('last'),
            },
            {
              icon: <IconCut size={I.size} stroke={I.stroke} />,
              label: t('generationCommon.videoToolbar.shotCuts'),
              onClick: () => setShotCutOpen(true),
            },
          ]}
        />
        <ToolbarDivider />
        <ToolbarIconButton
          icon={<IconMaximize size={I.size} stroke={I.stroke} />}
          title={t('generationCommon.videoToolbar.fullscreen')}
          ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')}
          onClick={onPreview}
        />
        <ToolbarIconButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          title={t('generationCommon.imageToolbar.downloadHint')}
          ariaLabel={t('generationCommon.imageToolbar.download')}
          disabled={downloading}
          onClick={onDownload}
        />
        <ToolbarProvenanceButton onOpen={onOpenProvenance} />
      </FloatingToolbarShell>
    </>
  )
}
