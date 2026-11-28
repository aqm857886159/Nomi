// 与 React Flow 缩放/平移坐标解耦的**唯一节点内容与动作舞台**（画布 `BaseGenerationNode` 与列表大详情 `GenerationListDetail` 同源挂载）。
//
// 为什么抽这一层（P0/P1/P2）：
// 以前画布节点的真实能力（富文本正文编辑与选区改写、真实 `<audio>` 播放与转写 SRT、失败/可找回面板、裁切/九宫格/抠图/视频抽帧修剪、
// 上时间轴、定妆/定稿、样片行）全耦合在 `BaseGenerationNode` 巨壳里，而 `GenerationListDetail` 另手写了只读 4 行 `TextPreview` 与
// 48 根静态假竖条 `AudioStrip`，每加一种节点能力两边就漂移一次。
// 现在节点正文与动作统一住进 `NodeStageSurface`：
// - `host="canvas"`：挂在 React Flow 节点外壳内，工具栏经 `NodeStageHostContext` 走反向缩放浮条；
// - `host="list-detail"`：挂在列表大详情 600px 同轴舞台内，工具栏走流式内联条，`canvas-only` 节点按 `NODE_SURFACE_CONTRACTS`
//   显式给出「去画布」指路。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconExternalLink } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { anchorFreezeToolbarProps } from '../fixation/freezeAnchor'
import { useWaitingForFrameSource } from '../hooks/useNodeRelationships'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodeLabel,
  isGenerationNodeKind,
  isImageLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { ImageQuickActionsToolbarHost } from '../quickActions/ImageQuickActionsToolbarHost'
import { useArtifactNodeSlots } from './artifact/artifactNodeSlots'
import { canvasImageSourceOf } from './canvasImageSource'
import { DeferredNodeImage } from './DeferredNodeMedia'
import { isLocalImageOpPending, isRemoveBackgroundPending, isRemoveBackgroundResult } from './localImageOpPhase'
import { NodeFailureReport } from './NodeErrorReport'
import { EmptyNodeVariantToolbar } from './NodeFloatingToolbar'
import { NodeGeneratingOverlay } from './NodeGeneratingOverlay'
import { NodeLayerSplitStatus } from './NodeLayerSplitStatus'
import { resolveNodeVisualSize } from './nodeSizing'
import { NodeStageHostContext, type NodeStageHost } from './nodeStageHostContext'
import { getNodeSurfaceContract } from './nodeSurfaceContract'
import { NodeVideoPlaybackGuard } from './NodeVideoPlaybackGuard'
import { NodeVideoSessionProvider } from './NodeVideoSession'
import PanoramaUploadFallback from './PanoramaUploadFallback'
import ProvenancePanel from './ProvenancePanel'
import {
  LocalImageOpPendingStatus,
  PendingGenerationPlaceholder,
  RemoveBackgroundPendingPlaceholder,
} from './render/CardCommon'
import { CROP_ONLY } from './render/cropGridGeometry'
import ImageCropGridActionBar from './render/ImageCropGridActionBar'
import ImageCropGridOverlay from './render/ImageCropGridOverlay'
import { NodeCardBody } from './render/NodeCardBody'
import PanoramaNodeToolbar from './render/PanoramaNodeToolbar'
import { previewBackgroundClass } from './render/previewBackground'
import TextDocumentNode from './render/TextDocumentNode'
import { getGenerationNodeIcon } from './renderRegistry'
import { isCardRenderKind, resolveNodeRenderKind } from './resolveRenderKind'
import { nodeHasVersionCards } from './versionCards/nodeVersionEntries'
import { NodeVersionCardsHost } from './versionCards/NodeVersionCardsHost'
import { useNodeImageEditing } from './useNodeImageEditing'
import { useNodeMediaMeasurement } from './useNodeMediaMeasurement'
import { useNodeMediaPreview } from './useNodeMediaPreview'
import { useNodePanoramaHandlers, usePanoramaFullscreenTrigger } from './useNodePanoramaHandlers'
import { NodeInlineWhiteboardHost } from './whiteboard/NodeInlineWhiteboardHost'
import { useWhiteboardSession } from './whiteboard/whiteboardSession'
import { readLayerSplitMark } from './whiteboard/whiteboardState'

const Model3DViewer = lazyWithChunkBoundary('3D 模型预览', () => import('./model3d/Model3DViewer'))
const PanoramaViewer = lazyWithChunkBoundary('全景预览', () => import('./PanoramaViewer'))

function NodeBodyLoading(): JSX.Element {
  return <div className="h-full w-full rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line" />
}

export type NodeStageSurfaceProps = {
  host: NodeStageHost
  node: GenerationCanvasNode
  selected?: boolean
  isMultiSelectActive?: boolean
  readOnly?: boolean
  mediaPreviewPriority?: boolean
  visualSize?: { width: number; height: number }
  detailFrameStyle?: React.CSSProperties
  videoPreviewRequested?: boolean
  derivedReady?: boolean
  onFeedback: (message: string) => void
  onOpenInCanvas?: () => void
}

function CanvasOnlyStagePointer({
  node,
  onOpenInCanvas,
}: {
  node: GenerationCanvasNode
  onOpenInCanvas?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const kindLabel = isGenerationNodeKind(node.kind) ? getGenerationNodeLabel(node.kind) : node.kind
  const Icon = isGenerationNodeKind(node.kind) ? getGenerationNodeIcon(node.kind) : IconExternalLink
  return (
    <div
      data-node-stage-surface="list-detail"
      data-node-stage-canvas-only={node.kind}
      className="flex w-full flex-col items-center justify-center gap-3 rounded-panel border border-nomi-line bg-nomi-paper px-6 py-10 text-center shadow-nomi-sm"
    >
      <span className="grid size-11 place-items-center rounded-nomi bg-nomi-ink-05 text-nomi-ink-60">
        <Icon size={22} stroke={1.6} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-body font-semibold text-nomi-ink">{node.title || kindLabel}</span>
        <span className="text-body-sm text-nomi-ink-60">{t('generationList.detail.canvasOnly')}</span>
      </div>
      {onOpenInCanvas ? (
        <WorkbenchButton size="sm" variant="primary" onClick={onOpenInCanvas}>
          <IconExternalLink aria-hidden />
          {t('generationList.openInCanvas')}
        </WorkbenchButton>
      ) : null}
    </div>
  )
}

function NodeStageSurfaceBody({
  host,
  node,
  selected = false,
  isMultiSelectActive = false,
  readOnly = false,
  mediaPreviewPriority = false,
  visualSize,
  detailFrameStyle,
  videoPreviewRequested = false,
  derivedReady = false,
  onFeedback,
  onOpenInCanvas,
}: NodeStageSurfaceProps): JSX.Element {
  const isListDetail = host === 'list-detail'
  const contract = getNodeSurfaceContract(node.kind)
  const [provenanceOpen, setProvenanceOpen] = React.useState(false)
  const [textEditing, setTextEditing] = React.useState(false)
  const panoramaFullscreen = usePanoramaFullscreenTrigger()
  const panoramaUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const effectiveSize = visualSize ?? resolveNodeVisualSize(node)
  const whiteboardOpen = useWhiteboardSession((state) => state.nodeId === node.id) && !readOnly
  const actionsActive = (isListDetail ? true : selected && !isMultiSelectActive) && !readOnly

  const { openMediaPreview, mediaPreviewControls, mediaPreviewDoubleClick } = useNodeMediaPreview(
    node,
    actionsActive && !whiteboardOpen,
    () => setProvenanceOpen(true),
    onFeedback,
  )
  const mediaMeasurement = useNodeMediaMeasurement(node)
  const imageEditing = useNodeImageEditing(node, effectiveSize, onFeedback)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  const waitingUpstream = useWaitingForFrameSource(node.id, nodeExecutionKind === 'video')
  const { handlePanoramaFileChange, handlePanoramaScreenshot } = useNodePanoramaHandlers(node, effectiveSize, onFeedback)
  const artifactSlots = useArtifactNodeSlots(node, {
    reportFeedback: onFeedback,
    selected: actionsActive,
    isMultiSelectActive,
    readOnly,
  })

  if (isListDetail && contract.stageMode === 'canvas-only') {
    return <CanvasOnlyStagePointer node={node} onOpenInCanvas={onOpenInCanvas} />
  }

  const isAssetKind = node.kind === 'asset'
  const renderKind = resolveNodeRenderKind(node)
  const isCardKind = isCardRenderKind(renderKind)
  const isTextKind = node.kind === 'text'
  const hasResult = Boolean(node.result?.url)
  const localImageOpPending = isLocalImageOpPending(node)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasFailureOverlay = node.status === 'error' || node.status === 'recoverable'

  const toolbars = (
    <>
      <EmptyNodeVariantToolbar
        nodeId={node.id}
        visible={actionsActive && !hasResult && !whiteboardOpen && !textEditing}
      />
      {node.kind === 'panorama' && actionsActive && node.result?.url ? (
        <PanoramaNodeToolbar
          node={node}
          reportFeedback={onFeedback}
          fullscreenRef={panoramaFullscreen.ref}
          uploadInputRef={panoramaUploadInputRef}
          onFileChange={handlePanoramaFileChange}
          onOpenProvenance={() => setProvenanceOpen(true)}
        />
      ) : null}
      {node.kind !== 'panorama' &&
      (node.kind === 'image' || isAssetKind || isImageLikeGenerationNodeKind(node.kind)) &&
      actionsActive &&
      !whiteboardOpen &&
      node.result?.type === 'image' &&
      node.result.url ? (
        <ImageQuickActionsToolbarHost
          reportFeedback={onFeedback}
          node={node}
          editGrid={imageEditing.editGrid}
          imageOpBusy={imageEditing.imageOpBusy}
          {...anchorFreezeToolbarProps(node)}
          onGridSplit={(spec) => imageEditing.openEdit(spec)}
          onCrop={() => imageEditing.openEdit(CROP_ONLY)}
          onTransform={(op) => void imageEditing.handleImageTransform(op)}
          onRemoveBackground={() => void imageEditing.handleRemoveBackground()}
          removeBackgroundBusy={isRemoveBackgroundPending(node)}
          onPreview={openMediaPreview}
          onOpenProvenance={() => setProvenanceOpen(true)}
        />
      ) : null}
      {mediaPreviewControls}
      {artifactSlots.toolbar}
    </>
  )

  const mediaPreviewContent = (
    <>
      {artifactSlots.body ? artifactSlots.body : node.kind === 'panorama' ? (
        node.result?.url || node.meta?.imageUrl ? (
          <React.Suspense fallback={<NodeBodyLoading />}>
            <PanoramaViewer
              nodeId={node.id}
              imageUrl={(node.result?.url || node.meta?.imageUrl) as string}
              width={effectiveSize.width}
              height={effectiveSize.height}
              onEnterFullscreen={panoramaFullscreen.onEnterFullscreen}
              onScreenshot={handlePanoramaScreenshot}
            />
          </React.Suspense>
        ) : (
          <PanoramaUploadFallback onChange={handlePanoramaFileChange} height={effectiveSize.height} />
        )
      ) : node.result?.url ? (
        node.result.type === 'model3d' ? (
          <React.Suspense fallback={<NodeBodyLoading />}>
            <Model3DViewer url={node.result.url} />
          </React.Suspense>
        ) : node.result.type === 'video' ? (
          <NodeVideoPlaybackGuard
            node={node}
            reportFeedback={onFeedback}
            previewRequested={isListDetail || videoPreviewRequested}
            engaged={actionsActive}
            data-node-preview-video="true"
            className={cn('h-full min-h-0 w-full object-contain pointer-events-auto', 'bg-nomi-ink-05 select-none')}
            priority={isListDetail || mediaPreviewPriority}
            crossOrigin="use-credentials"
            controls
            playsInline
            draggable={false}
            onLoadedMetadata={mediaMeasurement.onVideoMetadata}
          />
        ) : (
          <DeferredNodeImage
            className={cn(
              'h-full min-h-0 w-full object-contain pointer-events-none select-none',
              localImageOpPending && 'blur-sm scale-[1.02] transition-[filter,opacity] animate-remove-bg-pulse-slow',
            )}
            src={canvasImageSourceOf({ ...node.result, type: 'image' })!}
            priority={isListDetail || mediaPreviewPriority}
            alt=""
            onLoad={mediaMeasurement.onImageLoad}
          />
        )
      ) : localImageOpPending ? (
        <RemoveBackgroundPendingPlaceholder title={node.title} progress={node.progress?.percent} />
      ) : isCardKind || isTextKind ? null : (
        <PendingGenerationPlaceholder
          node={node}
          waitingUpstream={waitingUpstream}
          derivedReady={derivedReady}
        />
      )}
      {imageEditing.editGrid !== null &&
      (node.kind === 'image' || isAssetKind) &&
      node.result?.type === 'image' &&
      node.result.url ? (
        <ImageCropGridOverlay
          imageUrl={node.result.url}
          gridSize={imageEditing.editGrid}
          onDraftChange={imageEditing.reportDraft}
        />
      ) : null}
      {localImageOpPending && hasResult ? (
        <LocalImageOpPendingStatus message={node.progress?.message} progress={node.progress?.percent} />
      ) : null}
    </>
  )

  if (!isListDetail) {
    return (
      <>
        {toolbars}
        {whiteboardOpen ? <NodeInlineWhiteboardHost node={node} /> : null}
        <ProvenancePanel node={node} open={provenanceOpen} onClose={() => setProvenanceOpen(false)} />
        <NodeFailureReport node={node} onFeedback={onFeedback} summaryVisible={false} />
        {isCardKind && !whiteboardOpen ? <NodeCardBody renderKind={renderKind} node={node} readOnly={readOnly} /> : null}
        {isTextKind ? (
          <div className="h-full w-full">
            <TextDocumentNode node={node} onEditingChange={setTextEditing} />
          </div>
        ) : null}
        <div
          data-board={readLayerSplitMark(node.result) ? 'layers.node-composite' : undefined}
          className={cn(
            'generation-canvas-v2-node__preview',
            'relative z-[2] h-full min-h-0 w-full overflow-hidden',
            'rounded-nomi shadow-nomi-md cursor-grab touch-none ring-1 ring-inset ring-nomi-line',
            previewBackgroundClass(hasResult, isRemoveBackgroundResult(node.result)),
            isGenerating && node.progress?.phase === 'clipboard-import' && 'ring-nomi-accent/50 animate-remove-bg-pulse',
            (isCardKind || isTextKind || whiteboardOpen) && 'hidden',
          )}
          draggable={false}
          {...mediaPreviewDoubleClick}
        >
          {mediaPreviewContent}
        </div>
        <ImageCropGridActionBar editing={imageEditing} />
        {nodeHasVersionCards(node) ? (
          <NodeVersionCardsHost onFeedback={onFeedback} node={node} readOnly={readOnly} nodeSize={effectiveSize} entryHidden={imageEditing.editGrid !== null} />
        ) : null}
        {!localImageOpPending && !isTextKind ? <NodeGeneratingOverlay reportFeedback={onFeedback} node={node} /> : null}
      </>
    )
  }

  // ── host="list-detail"：600px 同中轴舞台（正文/媒体框 + 错误恢复 + 内联操作条 + 图层标 + 样片行）──
  return (
    <div className="flex w-full flex-col items-center" data-node-stage-surface="list-detail">
      <ProvenancePanel node={node} open={provenanceOpen} onClose={() => setProvenanceOpen(false)} />
      {whiteboardOpen ? (
        <div className="relative min-h-[320px] w-full overflow-hidden rounded-panel ring-1 ring-nomi-line" data-list-detail-preview>
          <NodeInlineWhiteboardHost node={node} />
        </div>
      ) : isTextKind ? (
        <div className="relative h-[260px] w-full" data-list-detail-preview>
          <NodeFailureReport node={node} onFeedback={onFeedback} />
          <TextDocumentNode node={node} onEditingChange={setTextEditing} />
        </div>
      ) : isCardKind ? (
        <div
          className={cn(
            'relative mx-auto w-full',
            renderKind === 'audio-strip'
              ? hasFailureOverlay ? 'min-h-[200px]' : 'h-[88px]'
              : 'min-h-[240px] max-w-[360px]',
          )}
          style={renderKind === 'audio-strip' ? undefined : detailFrameStyle}
          data-list-detail-preview
        >
          <NodeFailureReport node={node} onFeedback={onFeedback} />
          <NodeCardBody renderKind={renderKind} node={node} readOnly={readOnly} />
          {!localImageOpPending ? <NodeGeneratingOverlay reportFeedback={onFeedback} node={node} /> : null}
        </div>
      ) : (
        <div
          data-board={readLayerSplitMark(node.result) ? 'layers.node-composite' : undefined}
          className={cn(
            'relative mx-auto w-full overflow-hidden rounded-panel ring-1 ring-nomi-line-soft',
            previewBackgroundClass(hasResult, isRemoveBackgroundResult(node.result)),
          )}
          style={detailFrameStyle}
          data-list-detail-preview
          {...mediaPreviewDoubleClick}
        >
          <NodeFailureReport node={node} onFeedback={onFeedback} />
          {mediaPreviewContent}
          {!localImageOpPending ? <NodeGeneratingOverlay reportFeedback={onFeedback} node={node} /> : null}
        </div>
      )}
      <ImageCropGridActionBar editing={imageEditing} />
      {!whiteboardOpen && readLayerSplitMark(node.result) ? (
        <div className="mt-2 flex items-center justify-center">
          <NodeLayerSplitStatus node={node} />
        </div>
      ) : null}
      {toolbars}
    </div>
  )
}

export function NodeStageSurface(props: NodeStageSurfaceProps): JSX.Element {
  const content = <NodeStageSurfaceBody {...props} />
  const withVideoSession = props.host === 'list-detail' && props.node.result?.type === 'video'
    ? (
        <NodeVideoSessionProvider key={`${props.node.id}:${props.node.result?.url}`} node={props.node} writable={!props.readOnly}>
          {content}
        </NodeVideoSessionProvider>
      )
    : content
  return (
    <NodeStageHostContext.Provider value={props.host}>
      {withVideoSession}
    </NodeStageHostContext.Provider>
  )
}
