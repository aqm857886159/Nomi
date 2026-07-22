import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDownload, IconMaximize, IconPlayerTrackNext, IconPlayerTrackPrev } from '@tabler/icons-react'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarIconButton,
} from './NodeFloatingToolbar'
import { extractVideoFrameToNode } from './extractVideoFrameToNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 视频节点浮条（用户拍板「抽帧能力」的用户入口）：抽首帧 / 抽尾帧 ｜ 下载。
// 抽帧 = 从这段视频取首/尾一帧 → 落独立图片节点（extractVideoFrameToNode），能拿去当 Seedance 首尾帧 /
// 任何参考 / 接力源。抽首/尾用两个不同图标（⏮/⏭）一眼可分。容器/按钮走共享 NodeFloatingToolbar（token 合规）。

type Props = {
  node: GenerationCanvasNode
  downloading: boolean
  onDownload: (event: React.MouseEvent) => void
  onPreview: () => void
}

export default function NodeVideoFrameToolbar({ node, downloading, onDownload, onPreview }: Props): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState<'first' | 'last' | null>(null)
  const extract = (which: 'first' | 'last') => {
    if (busy) return
    setBusy(which)
    void extractVideoFrameToNode(node, which).finally(() => setBusy(null))
  }
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')}>
      <ToolbarIconButton
        icon={<IconMaximize size={I.size} stroke={I.stroke} />}
        title={t('generationCommon.videoToolbar.fullscreen')}
        ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')}
        onClick={onPreview}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<IconPlayerTrackPrev size={I.size} stroke={I.stroke} />}
        label={
          busy === 'first'
            ? t('generationCommon.videoToolbar.extracting')
            : t('generationCommon.videoToolbar.firstFrame')
        }
        title={t('generationCommon.videoToolbar.firstFrameHint')}
        disabled={busy !== null}
        onClick={() => extract('first')}
      />
      <ToolbarButton
        icon={<IconPlayerTrackNext size={I.size} stroke={I.stroke} />}
        label={
          busy === 'last' ? t('generationCommon.videoToolbar.extracting') : t('generationCommon.videoToolbar.lastFrame')
        }
        title={t('generationCommon.videoToolbar.lastFrameHint')}
        disabled={busy !== null}
        onClick={() => extract('last')}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.imageToolbar.download')}
        title={t('generationCommon.imageToolbar.downloadHint')}
        disabled={downloading}
        onClick={onDownload}
      />
    </FloatingToolbarShell>
  )
}
