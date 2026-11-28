import NodeGenerationComposer from './LazyNodeGenerationComposer'
import { notify } from '../../../ui/notificationPolicy'
import React, { type JSX } from 'react'
import { useWhiteboardSession } from './whiteboard/whiteboardSession'
import { resolveNodeRenderKind, isCardRenderKind, nodeHasGenerationComposer } from './resolveRenderKind'
import ShotMountBadges from './render/ShotMountBadges'
import { nodeHasVersionCards } from './versionCards/nodeVersionEntries'
import { useLabelCoveredByVersionGrid } from './versionCards/versionGridCoverage'
import { NodeHoverTimelineHandle } from './NodeFloatingToolbar'
import { useNodeDragResize } from './useNodeDragResize'
import { useShotIdentity, useMountedCards } from '../hooks/useNodeRelationships'
import { NodeResizeHandles } from './render/CardCommon'
import { cn } from '../../../utils/cn'
import { NodeVideoSessionProvider } from './NodeVideoSession'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { NodeGenerationStatus } from './NodeGenerationStatus'
import { sampleRowOwnsProgress } from '../model/sampleFacts'
import { NodeBelowRowSpace } from './nodeOutsideRows'
import { ProductionShotOverlays } from './ProductionShotOverlays'
import { useHasNodeAttachedPanel } from './nodeAttachedPanel'
import { TechnicalReviewBadge } from './TechnicalReviewBadge'
import { DerivedReadyBadge } from '../quickActions/DerivedReadyBadge'
import { isDerivedPromptReady } from '../quickActions/deriveFromNode'
import { NodeSampleRow } from './sampleRow/NodeSampleRow'
import { getNodeResizeBounds, resolveNodeVisualSize } from './nodeSizing'
import { NodeDerivedCopyBadge } from './NodeDerivedCopyBadge'
import { NodeLabelRow } from './NodeLabelRow'
import { NodeLayerSplitStatus } from './NodeLayerSplitStatus'
import { NodeShotLabel } from '../../generation/list/CanvasListLinks'
import { NodeInlineImageTitle } from './NodeImagePreviewActions'
import { hasEmptyCardLabel } from './render/emptyCardLabel'
import { useNodeVideoPreviewIntent } from './useNodeVideoPreviewIntent'
import { NodeStageSurface } from './NodeStageSurface'

export type BaseGenerationNodeProps = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly?: boolean
  focusFlash?: boolean
  appear?: boolean
}

function BaseGenerationNodeImpl({
  node,
  selected,
  readOnly = false,
  focusFlash = false,
  appear = false,
}: BaseGenerationNodeProps): JSX.Element {
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    notify({ identity: `BaseGenerationNodeImpl:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id])
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const isMultiSelectActive = useGenerationCanvasStore((state) => selected && state.selectedNodeIds.length > 1)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const showVersionCards = React.useMemo(() => nodeHasVersionCards(node), [node])
  const sizeBounds = getNodeResizeBounds(node)
  const videoPreview = useNodeVideoPreviewIntent(node.result?.type === 'video')

  const status = node.status || 'idle'
  const renderKind = resolveNodeRenderKind(node)
  const isCardKind = isCardRenderKind(renderKind)
  const isTextKind = node.kind === 'text'
  const hasResult = Boolean(node.result?.url)
  const mediaPreviewPriority = selected || focusFlash
  const visualSize = resolveNodeVisualSize(node)
  const {
    preview,
    flowManagedDrag: flowManagedLayout,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleResizePointerDown,
  } = useNodeDragResize({
    reportFeedback,
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
  const { x, y } = preview?.position ?? node.position
  const shotIdentity = useShotIdentity(node.id)
  const mountedCards = useMountedCards(node.id)
  const whiteboardOpen = useWhiteboardSession((state) => state.nodeId === node.id) && !readOnly
  const versionGridOpen = showVersionCards && Boolean(node.resultStackOpen)
  const attachedPanelOpen = useHasNodeAttachedPanel(node.id)
  const composerWanted = selected && !isMultiSelectActive && !readOnly && !versionGridOpen && !attachedPanelOpen && nodeHasGenerationComposer(node.kind)
  const composerMounted = React.useDeferredValue(composerWanted)
  const [belowRowSpace, setBelowRowSpace] = React.useState(0)
  const labelCovered = useLabelCoveredByVersionGrid(
    node.id,
    { x: node.position.x, y: node.position.y, width: visualSize.width, height: visualSize.height },
    !selected && !node.resultStackOpen,
  )

  return (
    <article
      className={cn(
        'generation-canvas-v2-node',
        flowManagedLayout ? 'relative' : 'absolute',
        'p-0 border-0 rounded-none bg-transparent shadow-none',
        'cursor-grab select-none touch-none overflow-visible',
        'data-[selected=true]:z-[5]',
        'block isolate group/node [&_[data-generation-message]]:min-w-0 [&_[data-generation-message]]:[overflow-wrap:anywhere]',
        labelCovered && '[&_[data-node-label-row]]:invisible',
      )}
      data-label-covered={labelCovered ? 'true' : undefined}
      data-node-id={node.id}
      data-kind={node.kind}
      data-selected={selected ? 'true' : 'false'}
      data-focus-flash={focusFlash ? 'true' : 'false'}
      data-appear={appear ? 'true' : undefined}
      data-status={status}
      style={{
        transform: flowManagedLayout ? undefined : `translate(${x}px, ${y}px)`,
        ...(preview?.size ?? visualSize),
        gridTemplateRows: `${visualSize.height}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={videoPreview.onPointerEnter}
      onPointerLeave={videoPreview.onPointerLeave}
    >
      {feedback ? <p role="status" className="absolute inset-x-0 bottom-0 z-[15] m-0 bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      <NodeLabelRow>
        <NodeShotLabel node={node} shotRole={shotIdentity.shotRole}>
          {(!isCardKind && !isTextKind) || hasEmptyCardLabel({ isCardKind, isTextKind, hasResult, contentJson: node.contentJson })
            ? <NodeInlineImageTitle nodeId={node.id} value={node.title || ''} readOnly={readOnly} />
            : null}
        </NodeShotLabel>
        {!isCardKind ? <ShotMountBadges cards={mountedCards} /> : null}
        <TechnicalReviewBadge meta={node.meta} />
        <DerivedReadyBadge node={node} />
        {!whiteboardOpen ? <NodeLayerSplitStatus node={node} /> : null}
        {node.derivedFrom ? <NodeDerivedCopyBadge derivedFrom={node.derivedFrom} /> : null}
      </NodeLabelRow>
      <div data-node-inline-status className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+40px)] z-[4] flex h-7 items-center [&_[data-generation-message]]:truncate [&_[data-generation-status]]:bg-nomi-paper/90">
        {sampleRowOwnsProgress(node) ? null : <NodeGenerationStatus node={node} summaryInCard />}
      </div>

      <NodeStageSurface
        host="canvas"
        node={node}
        selected={selected}
        isMultiSelectActive={isMultiSelectActive}
        readOnly={readOnly}
        mediaPreviewPriority={mediaPreviewPriority}
        visualSize={visualSize}
        videoPreviewRequested={videoPreview.requested}
        derivedReady={isDerivedPromptReady(node)}
        onFeedback={reportFeedback}
      />
      {!isCardKind && !isTextKind ? (
        <NodeSampleRow node={node} onFeedback={reportFeedback} readOnly={readOnly} onSpace={composerWanted ? setBelowRowSpace : undefined} />
      ) : null}

      {!readOnly ? <NodeHoverTimelineHandle nodeId={node.id} readOnly={readOnly} /> : null}
      <ProductionShotOverlays reportFeedback={reportFeedback} node={node} selected={selected && !isMultiSelectActive} />
      {composerWanted && composerMounted ? (
        <NodeBelowRowSpace.Provider value={belowRowSpace}>
          <NodeGenerationComposer onFeedback={reportFeedback} node={node} visualSize={visualSize} readOnly={readOnly} />
        </NodeBelowRowSpace.Provider>
      ) : null}
      {selected && !readOnly && !flowManagedLayout ? (
        <NodeResizeHandles onResizePointerDown={handleResizePointerDown} />
      ) : null}
    </article>
  )
}

const BaseGenerationNode = React.memo(
  (props: BaseGenerationNodeProps) => props.node.result?.type === 'video'
    ? <NodeVideoSessionProvider key={`${props.node.id}:${props.node.result?.url}`} node={props.node} writable={!props.readOnly}><BaseGenerationNodeImpl {...props} /></NodeVideoSessionProvider>
    : <BaseGenerationNodeImpl {...props} />,
  (prev, next) =>
    prev.node === next.node &&
    prev.selected === next.selected &&
    prev.readOnly === next.readOnly &&
    prev.focusFlash === next.focusFlash &&
    prev.appear === next.appear,
)
BaseGenerationNode.displayName = 'BaseGenerationNode'
export default BaseGenerationNode
