import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconDownload, IconLayoutRows, IconMaximize, IconPhoto, IconPlayerTrackNext, IconPlayerTrackPrev, IconTable } from '@tabler/icons-react'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from './NodeFloatingToolbar'
import { ToolbarActionMenu } from './ToolbarActionMenu'
import type { VideoFrameRequest } from './extractVideoFrameToNode'
import { useNodeVideoClock, useNodeVideoSession } from './useNodeVideoSession'
import NodeShotCutPanel from './NodeShotCutPanel'
import NodeVideoClipPanel from './NodeVideoClipPanel'
import { startVideoTrim } from './trimVideoToNode'
import NodeDepthActionButton from '../videoDepth/NodeDepthActionButton'
import { ensureDeconstructionShotTable } from './shotTable/factBridge'
import type { WorkbenchMenuIcon } from '../../../design/menu'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 视频节点浮条（按「创作优先级」排左→右，与图片工具栏一致）：左·创作：截帧▾（首帧/尾帧）· 拆解▾（按镜头拆/镜头表）｜ 右·工具：全屏 · 下载。
// 全屏是「看」的工具，与下载同归右侧工具区，不占最左（此前全屏在最左，抢了创作动作的位）。
// 截帧 = 从这段视频取一帧 → 旁边落独立图片节点并连线（extractVideoFrameToNode），能拿去当 Seedance 首尾帧 /
// 任何参考 / 接力源。当前帧在原卡底栏由相机一键截取；首/尾用两个不同图标（⏮/⏭）一眼可分。容器/按钮走共享 NodeFloatingToolbar（token 合规）。
//
// 「提取深度」（2026-09-07）排在拆参考片右边，因为左半段这几个是同一族：**从这段片子里
// 取出点什么，落成一张新卡**（一帧 / 一批帧 / 一张分镜表 / 一段深度视频）。§1.5 的「≤5」
// 管的是 L1 常驻条，这条浮条整条都是 L2（选中才出），所以加的不是常驻预算；真正要守的是
// 「一功能一个家」——深度提取从此只有这一个入口，独立节点与加号菜单里的那份同 commit 删掉。

type Props = {
  reportFeedback: (message: string) => void
  node: GenerationCanvasNode
  downloading: boolean
  onDownload: (event: React.MouseEvent) => void
  onPreview: () => void
  /** 生成记录（从卡片右上角迁来）。 */
  onOpenProvenance: () => void
}

export default function NodeVideoFrameToolbar({ reportFeedback, node, downloading, onDownload, onPreview, onOpenProvenance }: Props): JSX.Element {

  const { t } = useTranslation()
  const session = useNodeVideoSession()
  const { busy } = session
  const clock = useNodeVideoClock(session.player)
  const [shotCutOpen, setShotCutOpen] = React.useState(false)
  const [clipOpen, setClipOpen] = React.useState(false)
  const capture = (request: VideoFrameRequest) => session.capture(request, reportFeedback)
  return (
    <>

    {clipOpen ? (
      <NodeVideoClipPanel
        node={node}
        onClose={() => setClipOpen(false)}
      />
    ) : null}
    {shotCutOpen ? <NodeShotCutPanel onFeedback={reportFeedback} node={node} onClose={() => setShotCutOpen(false)} /> : null}
    <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')} nodeId={node.id}>
      <ToolbarActionMenu
        id="capture-frame"
        icon={<IconPhoto size={I.size} stroke={I.stroke} />}
        label={busy ? t('generationCommon.videoToolbar.capturing') : t('generationCommon.videoToolbar.captureFrame')}
        menuLabel={t('generationCommon.videoToolbar.captureFrame')}
        disabled={busy}
        items={[
          { id: 'capture-first', icon: IconPlayerTrackPrev as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.firstFrame'), onSelect: () => capture('first') },
          { id: 'capture-last', icon: IconPlayerTrackNext as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.lastFrame'), onSelect: () => capture('last') },
        ]}
      />
      <ToolbarButton
        icon={<IconCut size={I.size} stroke={I.stroke} />}
        label={t(clipOpen ? 'generationCommon.videoTrim.confirm' : 'generationCommon.videoTrim.toolbar')}
        actionId="trim"
        accent={clipOpen}
        disabled={busy || (clipOpen && (!clock.ready || clock.duration < 0.1))}
        onClick={() => {
          if (clipOpen) {
            const range = session.selection.current
            if (range && startVideoTrim(node, { startSeconds: range.start, endSeconds: range.end }, reportFeedback)) setClipOpen(false)
          } else { setShotCutOpen(false); setClipOpen(true) }
        }}
      />
      <ToolbarActionMenu
        id="break-down"
        icon={<IconLayoutRows size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.breakDown')}
        menuLabel={t('generationCommon.videoToolbar.breakDown')}
        disabled={busy}
        items={[
          { id: 'shot-cuts', icon: IconLayoutRows as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.shotCuts'), description: t('generationCommon.videoToolbar.shotCutsHint'), onSelect: () => { setClipOpen(false); setShotCutOpen(true) } },
          {
            id: 'shot-table',
            icon: IconTable as WorkbenchMenuIcon,
            label: t('generationCommon.videoToolbar.shotTable'),
            description: t('generationCommon.videoToolbar.deconstructHint'),
            // 只建表并选中它，不开拆（2026-10-18 拆解前选模型）：读图 / 转写模型在表下方的拆解栏里选好，点「拆解」才走报价卡、才花钱。
            onSelect: () => { ensureDeconstructionShotTable(node.id) },
          },
        ]}
      />
      <NodeDepthActionButton reportFeedback={reportFeedback} node={node} disabled={busy} />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
      <ToolbarDivider />
      <ToolbarIconButton
        icon={<IconMaximize size={I.size} stroke={I.stroke} />}
        title={t('generationCommon.videoToolbar.fullscreen')}
        ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')}
        onClick={onPreview}
      />
      <ToolbarIconButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        ariaLabel={t('generationCommon.imageToolbar.download')}
        title={t('generationCommon.imageToolbar.downloadHint')}
        disabled={downloading}
        onClick={onDownload}
      />
      <ToolbarProvenanceButton onOpen={onOpenProvenance} />
      </FloatingToolbarShell>
    </>
  )
}
