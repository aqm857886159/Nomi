// 设计实验室 · 屏「视频节点的下一步」· 浮条与取景台（骨架卡 + 生产浮条积木）。
//
// 浮条这一排用的全是生产积木：外壳 `FloatingToolbarShell`、下拉 `ToolbarActionMenu`（→ `WorkbenchMenu`）、
// 按钮 `ToolbarButton` / `ToolbarIconButton`、分隔 `ToolbarDivider`，右半段的「提取深度」是生产的 `NodeDepthActionButton`。
// 新的只有**哪几颗钮、排什么顺序**：当前帧迁到卡内相机；上方「截帧▾」仅保留首帧 / 尾帧。
//
// 唯一的占位是**节点卡本身**（同 `videoDepth/videoDepthLabKit.tsx`、`nodeQuickActions/…LabKit.tsx` 的理由：真卡会把
// 现役浮条一起渲出来，没法把新浮条挂上去）。外壳类名与现役卡逐字相同；里面是一个真 `<video>`，所以播放头是真的。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconDownload, IconLayoutRows, IconMaximize, IconPhoto, IconPlayerTrackNext, IconPlayerTrackPrev, IconTable } from '@tabler/icons-react'
import { LabCanvasViewport } from '../labCanvasViewport'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from '../../../workbench/generationCanvas/nodes/NodeFloatingToolbar'
import { ToolbarActionMenu } from '../../../workbench/generationCanvas/nodes/ToolbarActionMenu'
import NodeDepthActionButton from '../../../workbench/generationCanvas/videoDepth/NodeDepthActionButton'
import type { WorkbenchMenuIcon } from '../../../design/menu'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'
import { COPY, type VnLocale } from './videoNodeNextCopy'
import { VIDEO } from './videoNodeNextFixtures'

export const VN_CARD = { width: 340, height: 191 } as const
export const VN_CELL_WIDTH = 980
export const VN_CELL_HEIGHT = 760
const noop = (): void => undefined

export function videoSourceNode(locale: VnLocale): GenerationCanvasNode {
  return {
    id: 'vn-source',
    kind: 'video',
    title: COPY[locale].sourceTitle,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { ...VN_CARD },
    status: 'success',
    meta: { videoWidth: 640, videoHeight: 360, videoAspectRatio: 16 / 9, modelKey: 'seedance-2', modelVendor: 'apimart' },
    result: { id: 'vn-source-r', type: 'video', url: VIDEO, createdAt: 1 },
  } as GenerationCanvasNode
}

// ── 浮条 ─────────────────────────────────────────────────────────────────────

export function NextVideoToolbar({ node, locale, onBoundaryCapture = noop, captureDisabled = false, onTrim = noop, onShotCuts = noop, trimActive = false }: { node: GenerationCanvasNode; locale: VnLocale; onBoundaryCapture?: (which: 'first' | 'last') => void; captureDisabled?: boolean; onTrim?: () => void; onShotCuts?: () => void; trimActive?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const c = COPY[locale]
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')} nodeId={node.id}>
      <ToolbarActionMenu
        id="capture-frame"
        icon={<IconPhoto size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.captureFrame')}
        menuLabel={t('generationCommon.videoToolbar.captureFrame')}
        disabled={captureDisabled}
        items={[
          { id: 'capture-first', icon: IconPlayerTrackPrev as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.firstFrame'), onSelect: () => onBoundaryCapture('first') },
          { id: 'capture-last', icon: IconPlayerTrackNext as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.lastFrame'), onSelect: () => onBoundaryCapture('last') },
        ]}
      />
      <ToolbarButton icon={<IconCut size={I.size} stroke={I.stroke} />} label={trimActive ? t('generationCommon.videoTrim.confirm') : c.trim} actionId="trim" accent={trimActive} disabled={captureDisabled} onClick={onTrim} />
      <ToolbarActionMenu
        id="break-down"
        icon={<IconLayoutRows size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.breakDown')}
        menuLabel={t('generationCommon.videoToolbar.breakDown')}
        items={[
          { id: 'shot-cuts', icon: IconLayoutRows as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.shotCuts'), onSelect: onShotCuts },
          { id: 'shot-table', icon: IconTable as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.shotTable'), onSelect: noop },
        ]}
      />
      <NodeDepthActionButton reportFeedback={noop} node={node} />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
      <ToolbarDivider />
      <ToolbarIconButton icon={<IconMaximize size={I.size} stroke={I.stroke} />} title={t('generationCommon.videoToolbar.fullscreen')} ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')} onClick={noop} />
      <ToolbarIconButton icon={<IconDownload size={I.size} stroke={I.stroke} />} ariaLabel={t('generationCommon.imageToolbar.download')} title={t('generationCommon.imageToolbar.downloadHint')} onClick={noop} />
      <ToolbarProvenanceButton onOpen={noop} />
    </FloatingToolbarShell>
  )
}

// ── 取景台 ────────────────────────────────────────────────────────────────────

export function LabStage({ width = VN_CELL_WIDTH, height = VN_CELL_HEIGHT, zoom = 1, children }: { width?: number; height?: number; zoom?: number; children: React.ReactNode }): JSX.Element {
  return (
    <div data-design-lab-stage="video-node-next" className="workbench-generation__canvas relative overflow-hidden rounded-nomi border border-nomi-line" style={{ width, height }}>
      {/* 真画布的舞台类：点阵底色 + 浮条「左右夹住、太窄就折行」的测量都认它。 */}
      <div className="generation-canvas-v2__stage group/canvas"><LabCanvasViewport zoom={zoom}>{children}</LabCanvasViewport></div>
    </div>
  )
}

/** 种进 store：浮条里的「复制」钮读 store。 */
export function useSeededSource(node: GenerationCanvasNode): boolean {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    installCatalogBridge()
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: [node], edges: [], selectedNodeIds: [node.id] })
    setReady(true)
  }, [node])
  return ready
}

export function useLocaleHold(locale: VnLocale): boolean {
  return useLabLocale(locale)
}
