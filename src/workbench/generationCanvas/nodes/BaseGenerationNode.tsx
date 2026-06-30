import React from 'react'
import { IconCheck, IconCopy, IconDownload, IconInfoCircle, IconMaximize, IconUpload } from '@tabler/icons-react'
import ProvenancePanel from './ProvenancePanel'
import { resolveNodeRenderKind, isCardRenderKind } from './resolveRenderKind'
import ShotMountBadges from './render/ShotMountBadges'
import { getBuiltinCategoryById } from '../../project/projectCategories'
import { NodeCardBody } from './render/NodeCardBody'
import ImageCropGridOverlay from './render/ImageCropGridOverlay'
import NodeImageEditToolbar from './NodeImageEditToolbar'
import NodeResultDownloadButton from './NodeResultDownloadButton'
import { ImageResultStackControls } from './ImageResultStack'
import { FloatingToolbarShell, TOOLBAR_ICON as TBI, ToolbarButton, ToolbarDivider } from './NodeFloatingToolbar'
import { useNodeImageEditing } from './useNodeImageEditing'
import { useNodeDragResize } from './useNodeDragResize'
import { useHasFrameSourceEdge, useShotIndex, useMountedCards } from '../hooks/useNodeRelationships'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import {
  GeneratingOverlay,
  PendingGenerationPlaceholder,
  RemoveBackgroundPendingOverlay,
  RemoveBackgroundPendingPlaceholder,
  Scene3DEditorLoading,
  STRIPED_BG_CLASS,
} from './render/CardCommon'
import PanoramaUploadFallback from './PanoramaUploadFallback'
import { MagneticConnectionHandle } from './NodeConnectionHandles'
import { SideTimelineDragHandle, TimelineNotchDragHandle } from './NodeTimelineDragHandles'
import { cn } from '../../../utils/cn'
import { DeferredNodeImage, DeferredNodeVideo } from './DeferredNodeMedia'
import { useNodePanoramaHandlers } from './useNodePanoramaHandlers'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  encodeTimelineGenerationNodeDragPayload,
  TIMELINE_GENERATION_NODE_DRAG_MIME,
} from '../../timeline/timelineDragPayload'
import { getTrackTypeForClipType } from '../../timeline/timelineTypes'
import { buildClipFromGenerationNode } from '../model/buildClipFromGenerationNode'
import { toast } from '../../../ui/toast'
import { canRunGenerationNode, confirmAndRunNode } from '../runner/generationRunController'
import { retryLocalAssetImport } from '../adapters/assetImportAdapter'
import { NodeErrorReport } from './NodeErrorReport'
import { NodeRecoverableReport } from './NodeRecoverableReport'
import { dismissRecoverableNode, recoverNodeResult } from '../runner/recoverTaskActions'
import { WorkbenchButton } from '../../../design'
import { completeNodeConnection } from './completeNodeConnection'
import { buildVideoPlaybackUrl } from '../../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../../media/videoPlaybackDiagnostics'
import { getGenerationNodeExecutionKind, isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { applyFixationMakeup } from '../fixation/buildFixationNode'
import { TechnicalReviewBadge } from './TechnicalReviewBadge'
import { canDragGenerationNodeToTimeline } from '../model/timelineDragAffordance'
import { useResultDownload } from './useResultDownload'
import {
  STATUS_LABEL,
  RESIZE_DIRECTIONS,
  getNodeSizeBounds,
  FOCUS_GENERATION_NODE_EVENT,
  computeMediaMetaPatch,
  resolveNodeVisualSize,
} from './nodeSizing'

export type BaseGenerationNodeProps = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly?: boolean
  focusFlash?: boolean
  appear?: boolean
}
const Scene3DEditor = lazyWithChunkBoundary('3D 场景编辑器', () => import('./Scene3DEditor')) // A5：chunk 失败只降级本卡
const Model3DViewer = lazyWithChunkBoundary('3D 模型预览', () => import('./model3d/Model3DViewer')) // 生成出的 .glb 卡内可旋转预览（R3F）
const TextDocumentNode = lazyWithChunkBoundary('文本节点编辑器', () => import('./render/TextDocumentNode'))
const PanoramaViewer = lazyWithChunkBoundary('全景预览', () => import('./PanoramaViewer'))
const NodeGenerationComposer = lazyWithChunkBoundary('节点生成面板', () => import('./NodeGenerationComposer'))

function NodeBodyLoading(): JSX.Element {
  return <div className="h-full w-full rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line" />
}

function BaseGenerationNodeImpl({
  node,
  selected,
  readOnly = false,
  focusFlash = false,
  appear = false,
}: BaseGenerationNodeProps): JSX.Element {
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  // v0.7.2 perf: 订阅 boolean primitive 而不是整个 selectedNodeIds 数组
  // 之前数组引用每次变都触发所有节点 rerender；现在仅当 multi-select 状态翻转时触发
  const isMultiSelectActive = useGenerationCanvasStore((state) => state.selectedNodeIds.length > 1)
  // v0.7.2 perf: sourceNode 拆成两个 primitive 订阅，避免对象引用引发的伪 update
  const sourceNodeTitle = useGenerationCanvasStore((state) => {
    if (!node.derivedFrom) return undefined
    return state.nodes.find((candidate) => candidate.id === node.derivedFrom)?.title
  })
  const sourceNodeCategoryId = useGenerationCanvasStore((state) => {
    if (!node.derivedFrom) return undefined
    return state.nodes.find((candidate) => candidate.id === node.derivedFrom)?.categoryId
  })
  const sourceNodeExists = useGenerationCanvasStore((state) => {
    if (!node.derivedFrom) return false
    return state.nodes.some((candidate) => candidate.id === node.derivedFrom)
  })
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  // v0.7.2 perf: 只关心 "this node 是否是 pending source"，boolean
  const isPendingConnectionSource = useGenerationCanvasStore((state) => state.pendingConnectionSourceId === node.id)
  const pendingConnectionSourceSide = useGenerationCanvasStore((state) =>
    state.pendingConnectionSourceId === node.id ? state.pendingConnectionSourceSide : null,
  )
  const isPendingConnectionTarget = useGenerationCanvasStore(
    (state) => state.pendingConnectionSourceId !== '' && state.pendingConnectionSourceId !== node.id,
  )
  // perf：canvasZoom 仅事件处理器用、渲染从不读它；改按需 getState() 避免缩放时全节点重渲。
  const panoramaFullscreenRef = React.useRef<(() => void) | null>(null)
  const panoramaUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  // E11: provenance viewer open state (mounted into node header for AI-generated assets)
  const [provenanceOpen, setProvenanceOpen] = React.useState(false)
  const [imageStackOpen, setImageStackOpen] = React.useState(false)
  const handleImageStackOpenChange = React.useCallback((nextOpen: boolean) => {
    setImageStackOpen(nextOpen)
  }, [])

  // C5: 自由缩放边界按 kind 取（text 比媒体节点更大）。在拖拽/缩放闭包之前算好，
  // 让 handlePointerMove 与渲染期的尺寸计算用同一份 bounds。
  const sizeBounds = getNodeSizeBounds(node.kind)

  const handleTimelineDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(TIMELINE_GENERATION_NODE_DRAG_MIME, encodeTimelineGenerationNodeDragPayload(node))
  }

  const handleConnectionDragStart = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, side: ConnectionAnchorSide = 'right') => {
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.currentTarget.releasePointerCapture === 'function') {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      startConnection(node.id, side)
    },
    [node.id, startConnection],
  )

  const handleAddToTimelineAtPlayhead = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const timeline = useWorkbenchStore.getState().timeline
    const startFrame = timeline.playheadFrame
    const clip = buildClipFromGenerationNode(node, {
      fps: timeline.fps,
      startFrame,
    })
    if (!clip) {
      toast('该节点还没生成画面，先点「生成」', 'info')
      return
    }
    useWorkbenchStore.getState().addTimelineClipAtFrame(clip, getTrackTypeForClipType(clip.type), startFrame)
  }

  const updateMediaDimensions = (width: number, height: number, durationSeconds?: number) => {
    const patch = computeMediaMetaPatch({
      resultType: node.result?.type,
      meta: node.meta || {},
      currentSize: node.size,
      width,
      height,
      durationSeconds,
    })
    if (patch) updateNode(node.id, patch)
  }

  const handleFocusSourceNode = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!node.derivedFrom || typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: node.derivedFrom } }))
    },
    [node.derivedFrom],
  )

  const status = node.status || 'idle'
  // E.2.1: shots 分类的 composer 真正 flex-inlined（不再 absolute 浮在节点下方）
  // 配合 spec §6.1 修正 3：composer 内嵌到 card flex 流，与图像区共占节点视觉空间
  // [DESIGN-CARDS-07] renderKind 分发：非 shots 分类用专属 card 组件
  // renderKind 优先级：node.renderKind > 按 categoryId 推断
  // 素材节点：永远走纯图片预览。强制 renderKind=undefined，否则落进 cast/scene 分类的素材
  // 会被推断成角色卡/场景卡（A1.5 边界 1）。素材不挂 composer、不渲染生成占位。
  const isAssetKind = node.kind === 'asset'
  // renderKind 分发收口在 resolveRenderKind（纯函数,单测锁优先级:kind > categoryId）。
  const renderKind = resolveNodeRenderKind(node)
  const isCardKind = isCardRenderKind(renderKind)
  // C5: 文本节点走专属可编辑 body（TextDocumentNode），像 card 那样脱离图片预览。
  const isTextKind = node.kind === 'text'
  const hasResult = Boolean(node.result?.url)
  const mediaPreviewPriority = selected || focusFlash
  const isRemoveBackgroundPending =
    (node.status === 'queued' || node.status === 'running') && node.progress?.phase === 'remove-background'
  // 可视尺寸（卡片固定宽 / 动态高）的单一真相源 resolveNodeVisualSize——连线锚点 / 最小地图 /
  // fitView 与本外壳共用同一函数，避免名义 size 与渲染尺寸两套真相源（连线起笔飘在节点外的根因）。
  const visualSize = resolveNodeVisualSize(node)
  const previewHeight = visualSize.height
  const { handlePointerDown, handlePointerMove, handlePointerUp, handleResizePointerDown } = useNodeDragResize({
    node,
    selected,
    readOnly,
    isMultiSelectActive,
    sizeBounds,
    visualSize,
    selectNode,
    captureHistory,
    moveNode,
    moveSelectedNodes,
    updateNode,
    commitPersistedChange,
  })
  const isGenerating = status === 'queued' || status === 'running'
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate，而不是 getState() 同步读
  // 之前 getState() 在 render 外读，不响应 nodes/edges 变化，是个隐藏 bug
  const canGenerate =
    useGenerationCanvasStore((state) =>
      canRunGenerationNode(node, {
        nodes: state.nodes,
        edges: state.edges,
      }),
    ) && !isGenerating
  const canSendToTimeline = canDragGenerationNodeToTimeline(node, {
    readOnly,
  })
  const showTimelineNotch =
    canSendToTimeline && node.kind !== 'scene3d' && node.result?.type === 'image' && !imageStackOpen
  const showSideTimelineDrag = canSendToTimeline && node.kind !== 'scene3d' && !showTimelineNotch
  // 失败态不再显示文字徽标——错误信息已铺满节点正文（NodeErrorReport），
  // 顶部再写一遍「生成失败」是重复噪音（2026-06-03 6 角色评审）。
  const showStatusBadge = status === 'queued' || status === 'running'

  // v0.7.2 perf: 用 primitive 订阅 sourceNodeTitle / categoryId / exists 重组 label
  const sourceNodeLabel =
    sourceNodeTitle || (node.derivedFrom && !sourceNodeExists ? '源节点已不在当前项目' : node.derivedFrom || '')
  const sourceCategoryName = sourceNodeCategoryId ? getBuiltinCategoryById(sourceNodeCategoryId)?.name : null
  const independentCopyLabel =
    sourceCategoryName && sourceNodeExists
      ? `独立副本（来自 ${sourceCategoryName}·${sourceNodeLabel}）`
      : sourceNodeExists
        ? `独立副本（来自 ${sourceNodeLabel}）`
        : '独立副本（源节点已不存在）'
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  // L3：待生成卡给镜头序号，让未选中的占位卡也能一眼分清哪个镜头（非 shots 返回 null）。
  const shotIndex = useShotIndex(node.id, node.categoryId)
  // 切片2：镜头「挂了哪些设定卡」——不选中也能一眼看出挂了林夏/咖啡馆（可审计，免数连线）。
  const mountedCards = useMountedCards(node.id)
  const hasFrameSourceEdge = useHasFrameSourceEdge(node.id, nodeExecutionKind === 'video') // A15：已连上游边时占位不再喊「拖图」
  const needsFirstFrame = nodeExecutionKind === 'video' && !canGenerate && !isGenerating
  const { handlePanoramaFileChange, handlePanoramaScreenshot } = useNodePanoramaHandlers(node, visualSize)

  // 图片本地编辑（切图 / 裁剪 / 旋转翻转）—— A1.5 抽进 useNodeImageEditing。
  // 图片类与素材类共用；编辑产物进入当前节点历史堆叠，并切换为主图。
  const imageEditing = useNodeImageEditing(node, visualSize)
  const { downloading: panoramaDownloading, download: downloadPanorama } = useResultDownload(node)
  const showImageResultStack =
    !isCardKind &&
    !isTextKind &&
    node.kind !== 'panorama' &&
    node.result?.type === 'image' &&
    Boolean(node.result.url) &&
    (node.kind === 'image' || isAssetKind || isImageLikeGenerationNodeKind(node.kind))
  const useMagneticConnectionHandles =
    node.kind !== 'panorama' && (node.kind === 'image' || isAssetKind || isImageLikeGenerationNodeKind(node.kind))

  return (
    <article
      className={cn(
        'generation-canvas-v2-node',
        'absolute p-0 border-0 rounded-none bg-transparent shadow-none',
        'cursor-grab select-none touch-none overflow-visible',
        'data-[selected=true]:z-[5]',
        'block group/node',
      )}
      data-node-id={node.id}
      data-kind={node.kind}
      data-expanded={selected ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-focus-flash={focusFlash ? 'true' : 'false'}
      data-appear={appear ? 'true' : undefined}
      data-status={status}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: visualSize.width,
        height: visualSize.height,
        gridTemplateRows: `${previewHeight}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {!readOnly && node.kind !== 'panorama' ? (
        selected && useMagneticConnectionHandles && !isPendingConnectionSource ? (
          <>
            <MagneticConnectionHandle
              side="left"
              active={isPendingConnectionTarget || pendingConnectionSourceSide === 'left'}
              pendingTarget={isPendingConnectionTarget}
              onStart={handleConnectionDragStart}
              onComplete={(event) => {
                event.stopPropagation()
                completeNodeConnection(node.id)
              }}
            />
            <MagneticConnectionHandle
              side="right"
              active={isPendingConnectionTarget || pendingConnectionSourceSide === 'right'}
              pendingTarget={isPendingConnectionTarget}
              onStart={handleConnectionDragStart}
              onComplete={(event) => {
                event.stopPropagation()
                completeNodeConnection(node.id)
              }}
            />
          </>
        ) : (
          <>
            <WorkbenchButton
              className={cn(
                'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--input',
                'absolute top-1/2 left-[-14px] inline-grid w-7 h-7 place-items-center p-0',
                'border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair',
                'opacity-80 transition-opacity duration-150 hover:opacity-100',
                'data-[active=true]:opacity-100',
              )}
              aria-label={isPendingConnectionTarget ? '连接到此节点' : '从此节点开始连线'}
              data-active={isPendingConnectionTarget ? 'true' : 'false'}
              onPointerDown={(event) => {
                if (isPendingConnectionTarget) {
                  event.stopPropagation()
                  return
                }
                handleConnectionDragStart(event, 'left')
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (!isPendingConnectionTarget) return
                completeNodeConnection(node.id)
              }}
            >
              <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
            </WorkbenchButton>
            <WorkbenchButton
              className={cn(
                'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--output',
                'absolute top-1/2 right-[-14px] inline-grid w-7 h-7 place-items-center p-0',
                'border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair',
                'opacity-80 transition-opacity duration-150 hover:opacity-100',
                'data-[active=true]:opacity-100',
              )}
              aria-label="从此节点开始连线"
              data-active={isPendingConnectionSource ? 'true' : 'false'}
              onPointerDown={(event) => handleConnectionDragStart(event, 'right')}
            >
              <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
            </WorkbenchButton>
          </>
        )
      ) : null}

      {node.kind === 'panorama' && selected && !isMultiSelectActive && !readOnly && node.result?.url ? (
        <FloatingToolbarShell ariaLabel="全景图操作">
          <ToolbarButton
            icon={<IconMaximize size={TBI.size} stroke={TBI.stroke} />}
            label="全景预览"
            title="全景预览"
            onClick={() => panoramaFullscreenRef.current?.()}
          />
          <ToolbarDivider />
          <ToolbarButton
            icon={<IconUpload size={TBI.size} stroke={TBI.stroke} />}
            label="重新上传"
            title="重新上传全景图"
            onClick={() => panoramaUploadInputRef.current?.click()}
          />
          <ToolbarDivider />
          <ToolbarButton
            icon={<IconDownload size={TBI.size} stroke={TBI.stroke} />}
            label="下载"
            title="下载 / 另存到本地"
            disabled={panoramaDownloading}
            onClick={downloadPanorama}
          />
          <input
            ref={panoramaUploadInputRef}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={handlePanoramaFileChange}
          />
        </FloatingToolbarShell>
      ) : null}

      {node.kind !== 'panorama' &&
      (node.kind === 'image' || isAssetKind || isImageLikeGenerationNodeKind(node.kind)) &&
      selected &&
      !isMultiSelectActive &&
      !readOnly &&
      !imageStackOpen &&
      node.result?.type === 'image' &&
      node.result.url ? (
        <NodeImageEditToolbar
          node={node}
          editGrid={imageEditing.editGrid}
          imageOpBusy={imageEditing.imageOpBusy}
          onMakeup={() => applyFixationMakeup(node)}
          onGridSplit={(g) => imageEditing.openEdit(g)}
          onCrop={() => imageEditing.openEdit(1)}
          onTransform={(op) => void imageEditing.handleImageTransform(op)}
          onRemoveBackground={() => void imageEditing.handleRemoveBackground()}
          removeBackgroundBusy={isRemoveBackgroundPending}
        />
      ) : null}

      {/* 视频等无编辑工具条的结果：单独一条「下载」浮条；多选时藏（只留居中批量条，不糊一片）。 */}
      <NodeResultDownloadButton node={node} selected={selected && !isMultiSelectActive && !imageStackOpen} />

      <header
        className={cn(
          'generation-canvas-v2-node__header',
          'absolute top-[10px] left-[10px] right-[10px] z-[2]',
          'flex items-center justify-start gap-2 min-h-0 p-0',
          'pointer-events-auto cursor-grab',
        )}
      >
        {showStatusBadge ? (
          <span
            className={cn(
              'text-micro font-medium tracking-[0.06em] uppercase',
              'py-[3px] px-2 rounded-nomi-sm backdrop-blur-[8px]',
              'bg-nomi-paper/[0.82] text-nomi-ink-60',
              'data-[status=success]:text-workbench-success-ink data-[status=success]:bg-workbench-success-soft',
              'data-[status=error]:text-workbench-danger data-[status=error]:bg-workbench-danger-soft',
            )}
            data-status={status}
          >
            {(isGenerating && node.progress?.message) || STATUS_LABEL[status] || status}
          </span>
        ) : null}
        <TechnicalReviewBadge meta={node.meta} />
        {/* 锁徽标已移到 NodeGenerationComposer 底栏（编辑面板），卡片预览保持干净（用户反馈②）。 */}
        {/* E.2C-25 副本角标：跨分类独立副本永久显示（derivedFrom 仅承载此语义；同分类重生成在 regeneratedFrom）。 */}
        {node.derivedFrom ? (
          <button
            type="button"
            className="generation-canvas-v2-node__derived-badge"
            aria-label={sourceNodeExists ? `定位源节点：${sourceNodeLabel}` : '源节点已不存在'}
            title={independentCopyLabel}
            disabled={!sourceNodeExists}
            onClick={handleFocusSourceNode}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconCopy size={13} stroke={1.8} aria-hidden="true" />
            <span>独立副本</span>
          </button>
        ) : null}
        {hasResult && !imageStackOpen ? (
          <button
            type="button"
            className={cn(
              'ml-auto inline-grid place-items-center w-6 h-6 rounded-full',
              'bg-nomi-paper/[0.82] text-nomi-ink-60 hover:text-nomi-ink',
              'backdrop-blur-[8px] cursor-pointer pointer-events-auto',
              'transition-colors duration-150',
            )}
            aria-label="查看生成记录"
            title="生成记录 / Provenance"
            onClick={(event) => {
              event.stopPropagation()
              setProvenanceOpen(true)
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconInfoCircle size={14} stroke={1.6} />
          </button>
        ) : null}
      </header>

      {/* 切片2：镜头挂载的设定卡徽章——不选中也能一眼看「挂了谁」（卡节点不显，组件空挂载自返 null）。 */}
      {!isCardKind ? <ShotMountBadges cards={mountedCards} /> : null}

      <ProvenancePanel node={node} open={provenanceOpen} onClose={() => setProvenanceOpen(false)} />

      {/* 失败态：错误卡铺满节点正文（absolute inset-0 z-[5]），盖占位底纹但不挡 composer/resize/handles。 */}
      {status === 'error' && node.error ? (
        <NodeErrorReport
          message={node.error}
          onRetry={
            isAssetKind && node.meta?.source === 'clipboard-url'
              ? undefined
              : () => {
                  void (node.meta?.retryableImport === true
                    ? retryLocalAssetImport(node.id)
                    : confirmAndRunNode(node.id))
                }
          }
        />
      ) : null}

      {/* 可找回态：异步任务超时但上游可能已出片——中性面板 + 一键重新拉取（query 不扣费），不进红色错误桶。 */}
      {status === 'recoverable' ? (
        <NodeRecoverableReport
          onRecover={() => {
            void recoverNodeResult(node.id)
          }}
          onDismiss={() => {
            dismissRecoverableNode(node.id)
          }}
        />
      ) : null}

      {/* [DESIGN-CARDS-07] 卡片分发抽到 NodeCardBody（R9 治巨壳）：非 shots 分类共用外壳只换 body。 */}
      {isCardKind ? <NodeCardBody renderKind={renderKind} node={node} readOnly={readOnly} /> : null}

      {/* C5: 文本节点。外层不裁剪让浮动格式条浮到节点上方（圆角/阴影/裁剪在 TextDocumentNode 内层 body）。 */}
      {isTextKind ? (
        <div className="w-full h-full">
          <React.Suspense fallback={<NodeBodyLoading />}>
            <TextDocumentNode node={node} />
          </React.Suspense>
        </div>
      ) : null}

      <div
        className={cn(
          'generation-canvas-v2-node__preview',
          'relative w-full h-full min-h-0 overflow-hidden',
          // ring=中性细描边（box-shadow，零布局位移）：缩小/密集时卡片有边界、不糊进浅色画布（②）。
          'rounded-nomi shadow-nomi-md cursor-grab touch-none ring-1 ring-inset ring-nomi-line',
          // 棋盘格占位底纹只在「未生成」态出现；有结果后节点尺寸已贴合图片比例，
          // 不再露出底纹，避免图片外面套一层框。
          !hasResult && STRIPED_BG_CLASS,
          isGenerating &&
            node.progress?.phase === 'clipboard-import' &&
            'ring-nomi-accent/50 [animation:_remove-bg-pulse_1.2s_ease-in-out_infinite]',
          // [DESIGN-CARDS-07] 卡片模式隐藏 preview div；C5 文本节点同理。
          (isCardKind || isTextKind) && 'hidden',
        )}
        data-timeline-draggable={canSendToTimeline ? 'true' : 'false'}
        draggable={false}
      >
        {node.kind === 'scene3d' ? (
          <React.Suspense fallback={<Scene3DEditorLoading />}>
            <Scene3DEditor node={node} width={visualSize.width} height={previewHeight} readOnly={readOnly} />
          </React.Suspense>
        ) : node.kind === 'panorama' ? (
          node.result?.url || node.meta?.imageUrl ? (
            <React.Suspense fallback={<NodeBodyLoading />}>
              <PanoramaViewer
                imageUrl={(node.result?.url || node.meta?.imageUrl) as string}
                width={visualSize.width}
                height={previewHeight}
                onEnterFullscreen={(trigger) => {
                  panoramaFullscreenRef.current = trigger
                }}
                onScreenshot={handlePanoramaScreenshot}
              />
            </React.Suspense>
          ) : (
            <PanoramaUploadFallback onChange={handlePanoramaFileChange} />
          )
        ) : node.result?.url ? (
          node.result.type === 'model3d' ? (
            <React.Suspense fallback={<Scene3DEditorLoading />}>
              <Model3DViewer url={node.result.url} />
            </React.Suspense>
          ) : node.result.type === 'video' ? (
            <DeferredNodeVideo
              className={cn('w-full h-full min-h-0 object-contain pointer-events-auto', 'bg-nomi-ink-05 select-none')}
              src={buildVideoPlaybackUrl(node.result.url)}
              priority={mediaPreviewPriority}
              crossOrigin="use-credentials"
              controls
              muted
              playsInline
              preload="metadata"
              draggable={false}
              onLoadedMetadata={(event) => {
                updateMediaDimensions(
                  event.currentTarget.videoWidth,
                  event.currentTarget.videoHeight,
                  event.currentTarget.duration,
                )
              }}
              onError={(event) => {
                void diagnoseVideoPlaybackFailure(node.result?.url || '', event.currentTarget.error).then(
                  logVideoPlaybackFailure,
                )
              }}
            />
          ) : (
            <DeferredNodeImage
              className={cn(
                'w-full h-full min-h-0 object-contain pointer-events-none',
                'select-none',
                isRemoveBackgroundPending && 'blur-sm scale-[1.02] transition-[filter,opacity]',
                isRemoveBackgroundPending && '[animation:_remove-bg-pulse_1.5s_ease-in-out_infinite]',
              )}
              src={node.result.url}
              priority={mediaPreviewPriority}
              alt=""
              onLoad={(event) => {
                updateMediaDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
              }}
            />
          )
        ) : isRemoveBackgroundPending ? (
          <RemoveBackgroundPendingPlaceholder title={node.title} progress={node.progress?.percent} />
        ) : (
          <PendingGenerationPlaceholder
            selected={selected}
            needsFirstFrame={needsFirstFrame}
            waitingUpstream={hasFrameSourceEdge}
            shotIndex={shotIndex}
            title={node.title}
            prompt={node.prompt}
          />
        )}
        {imageEditing.editGrid !== null &&
        (node.kind === 'image' || isAssetKind) &&
        node.result?.type === 'image' &&
        node.result.url ? (
          <ImageCropGridOverlay
            imageUrl={node.result.url}
            gridSize={imageEditing.editGrid}
            onConfirm={(result) => {
              void imageEditing.handleEditConfirm(result)
            }}
            onCancel={() => imageEditing.cancelEdit()}
          />
        ) : null}
        {isRemoveBackgroundPending && hasResult ? (
          <RemoveBackgroundPendingOverlay message={node.progress?.message} progress={node.progress?.percent} />
        ) : null}
      </div>
      {showImageResultStack ? (
        <ImageResultStackControls
          node={node}
          readOnly={readOnly}
          selected={selected && !isMultiSelectActive}
          visualWidth={visualSize.width}
          visualHeight={visualSize.height}
          onOpenChange={handleImageStackOpenChange}
        />
      ) : null}

      {imageStackOpen && showImageResultStack ? (
        <span
          className={cn(
            'pointer-events-none absolute right-2 top-2 z-[9] inline-flex h-7 items-center gap-1 rounded-full px-2',
            'border-0 bg-nomi-ink text-micro font-medium text-nomi-paper shadow-nomi-sm',
          )}
        >
          <IconCheck size={13} stroke={2.2} />
          主图
        </span>
      ) : null}

      {showTimelineNotch ? (
        <TimelineNotchDragHandle
          onAddAtPlayhead={handleAddToTimelineAtPlayhead}
          onDragStart={handleTimelineDragStart}
        />
      ) : null}

      {isGenerating && !isRemoveBackgroundPending ? <GeneratingOverlay /> : null}
      {showSideTimelineDrag ? (
        <SideTimelineDragHandle onAddAtPlayhead={handleAddToTimelineAtPlayhead} onDragStart={handleTimelineDragStart} />
      ) : null}

      {/* composer：生成类节点 + **单选**时浮出。多选(框选)一律不挂——否则每个选中节点都弹自己的
          大 composer 层叠糊成一片(用户反馈 bug，根因收口此唯一挂载入口)。批量生成走选中浮条。 */}
      {selected &&
      !isMultiSelectActive &&
      !readOnly &&
      !imageStackOpen &&
      node.kind !== 'panorama' &&
      node.kind !== 'scene3d' &&
      node.kind !== 'whiteboard' &&
      !isAssetKind ? (
        <React.Suspense fallback={null}>
          <NodeGenerationComposer node={node} visualSize={visualSize} />
        </React.Suspense>
      ) : null}
      {selected && !readOnly
        ? RESIZE_DIRECTIONS.map((direction) => (
            <WorkbenchButton
              key={direction}
              className={cn(
                'generation-canvas-v2-node__resize-zone',
                `generation-canvas-v2-node__resize-zone--${direction}`,
                'absolute z-[6] p-0 border-0 bg-transparent',
                'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
                (direction === 'n' || direction === 's') && 'left-[10px] w-[calc(100%-20px)] h-[10px] cursor-ns-resize',
                direction === 'n' && 'top-[-5px]',
                direction === 's' && 'bottom-[-5px]',
                (direction === 'e' || direction === 'w') && 'top-[10px] w-[10px] h-[calc(100%-20px)] cursor-ew-resize',
                direction === 'e' && 'right-[-5px]',
                direction === 'w' && 'left-[-5px]',
                (direction === 'ne' || direction === 'nw' || direction === 'se' || direction === 'sw') && 'w-4 h-4',
                (direction === 'ne' || direction === 'sw') && 'cursor-nesw-resize',
                (direction === 'nw' || direction === 'se') && 'cursor-nwse-resize',
                direction === 'ne' && 'top-[-8px] right-[-8px]',
                direction === 'nw' && 'top-[-8px] left-[-8px]',
                direction === 'se' && 'right-[-8px] bottom-[-8px]',
                direction === 'sw' && 'bottom-[-8px] left-[-8px]',
              )}
              aria-label={`从${direction}方向调整节点尺寸`}
              title="调整节点尺寸"
              onPointerDown={handleResizePointerDown(direction)}
            />
          ))
        : null}
    </article>
  )
}

// v0.7.1 perf: memo wrap — node 引用稳定时跳过 rerender。
// 父级 GenerationCanvas 须保证 node 是 zustand store 里同一引用（zustand immer 默认就是）。
const BaseGenerationNode = React.memo(
  BaseGenerationNodeImpl,
  (prev, next) =>
    prev.node === next.node &&
    prev.selected === next.selected &&
    prev.readOnly === next.readOnly &&
    prev.focusFlash === next.focusFlash &&
    prev.appear === next.appear,
)
BaseGenerationNode.displayName = 'BaseGenerationNode'
export default BaseGenerationNode
