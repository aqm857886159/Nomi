import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconDownload, IconMaximize, IconPlayerTrackNext, IconPlayerTrackPrev } from '@tabler/icons-react'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from './NodeFloatingToolbar'
import { extractVideoFrameToNode } from './extractVideoFrameToNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { openVideoDeconstruction } from './videoDeconstructionEvents'

// 视频节点浮条（按「创作优先级」排左→右，与图片工具栏一致）：左·创作：抽首帧 / 抽尾帧 ｜ 右·工具：全屏 · 下载。
// 全屏是「看」的工具，与下载同归右侧工具区，不占最左（此前全屏在最左，抢了创作动作的位）。
// 抽帧 = 从这段视频取首/尾一帧 → 落独立图片节点（extractVideoFrameToNode），能拿去当 Seedance 首尾帧 /
// 任何参考 / 接力源。抽首/尾用两个不同图标（⏮/⏭）一眼可分。容器/按钮走共享 NodeFloatingToolbar（token 合规）。

type Props = {
  node: GenerationCanvasNode
  downloading: boolean
  onDownload: (event: React.MouseEvent) => void
  onPreview: () => void
  /** 生成记录（从卡片右上角迁来）。 */
  onOpenProvenance: () => void
}

export default function NodeVideoFrameToolbar({ node, downloading, onDownload, onPreview, onOpenProvenance }: Props): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState<'first' | 'last' | null>(null)
  const extract = (which: 'first' | 'last') => {
    if (busy) return
    setBusy(which)
    void extractVideoFrameToNode(node, which).finally(() => setBusy(null))
  }
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')}>
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
      <ToolbarButton
        icon={<IconCut size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.shotCuts')}
        title={t('generationCommon.videoToolbar.shotCutsHint')}
        disabled={busy !== null}
        onClick={() => openVideoDeconstruction(node.id)}
      />
      <ToolbarDivider />
      <ToolbarIconButton
        icon={<IconMaximize size={I.size} stroke={I.stroke} />}
        title={t('generationCommon.videoToolbar.fullscreen')}
        ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')}
        onClick={onPreview}
      />
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.imageToolbar.download')}
        title={t('generationCommon.imageToolbar.downloadHint')}
        disabled={downloading}
        onClick={onDownload}
      />
      <ToolbarProvenanceButton onOpen={onOpenProvenance} />
      </FloatingToolbarShell>
  )
}
