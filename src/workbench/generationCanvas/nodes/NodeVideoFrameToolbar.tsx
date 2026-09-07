import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconDownload, IconMaximize, IconPlayerTrackNext, IconPlayerTrackPrev, IconScissors } from '@tabler/icons-react'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from './NodeFloatingToolbar'
import { extractVideoFrameToNode } from './extractVideoFrameToNode'
import NodeShotCutPanel from './NodeShotCutPanel'
import NodeDepthActionButton from '../videoDepth/NodeDepthActionButton'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 视频节点浮条（按「创作优先级」排左→右，与图片工具栏一致）：左·创作：抽首帧 / 抽尾帧 ｜ 右·工具：全屏 · 下载。
// 全屏是「看」的工具，与下载同归右侧工具区，不占最左（此前全屏在最左，抢了创作动作的位）。
// 抽帧 = 从这段视频取首/尾一帧 → 落独立图片节点（extractVideoFrameToNode），能拿去当 Seedance 首尾帧 /
// 任何参考 / 接力源。抽首/尾用两个不同图标（⏮/⏭）一眼可分。容器/按钮走共享 NodeFloatingToolbar（token 合规）。
//
// 「提取深度」（2026-09-07）排在拆参考片右边，因为左半段这几个是同一族：**从这段片子里
// 取出点什么，落成一张新卡**（一帧 / 一批帧 / 一张分镜表 / 一段深度视频）。§1.5 的「≤5」
// 管的是 L1 常驻条，这条浮条整条都是 L2（选中才出），所以加的不是常驻预算；真正要守的是
// 「一功能一个家」——深度提取从此只有这一个入口，独立节点与加号菜单里的那份同 commit 删掉。

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
  const [shotCutOpen, setShotCutOpen] = React.useState(false)
  const openDeconstruction = useGenerationCanvasStore((state) => state.openVideoDeconstruction)
  const deconstructOpen = useGenerationCanvasStore((state) => state.videoDeconstructionOpenNodeId === node.id)
  const extract = (which: 'first' | 'last') => {
    if (busy) return
    setBusy(which)
    void extractVideoFrameToNode(node, which).finally(() => setBusy(null))
  }
  return (
    <>
    {shotCutOpen ? <NodeShotCutPanel node={node} onClose={() => setShotCutOpen(false)} /> : null}
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
        onClick={() => setShotCutOpen(true)}
      />
      <ToolbarButton
        icon={<IconScissors size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.deconstruct')}
        title={t('generationCommon.videoToolbar.deconstructHint')}
        accent={deconstructOpen}
        disabled={busy !== null}
        onClick={() => openDeconstruction(node.id, { title: node.title || '', videoUrl: node.result?.url || '' })}
      />
      <NodeDepthActionButton node={node} disabled={busy !== null} />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
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
    </>
  )
}
