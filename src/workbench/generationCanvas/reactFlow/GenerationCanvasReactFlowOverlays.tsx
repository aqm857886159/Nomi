import React from 'react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { CanvasBatchGenerateDock } from '../components/CanvasBatchGenerateDock'
import { CanvasEmptyState } from '../components/CanvasEmptyState'
import { CanvasNavigationStack } from '../components/CanvasNavigationStack'
import NodeContextMenu, { type NodeContextMenuAction } from '../components/NodeContextMenu'
import FrameContextMenu, { type FrameContextMenuAction } from '../components/FrameContextMenu'
import type { CanvasFrameMenuState } from '../components/useCanvasFrameActions'
import { NodeAddMenu } from '../components/CanvasToolbar'
import { SelectionPromptSaveController } from '../components/SelectionPromptSaveController'
import { hasClipboardContent } from '../store/canvasClipboard'
import type { CanvasContextNodeMenu } from '../components/useCanvasContextNodeMenu'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import type { useCanvasProductionActions } from '../components/useCanvasProductionActions'

const BatchPlanOverlay = lazyWithChunkBoundary('批量生成面板', () =>
  import('../components/BatchPlanOverlay').then((module) => ({ default: module.BatchPlanOverlay })),
)

type GenerationCanvasReactFlowOverlaysProps = {
  readOnly: boolean
  activeCategoryId: string
  nodes: GenerationCanvasNode[]
  allNodes: GenerationCanvasNode[]
  selectedNodeIds: readonly string[]
  selectedSet: Set<string>
  screenshotOverlay: React.ReactNode
  contextNodeMenu: CanvasContextNodeMenu | null
  connectionCreateMenu: {
    stageX: number
    stageY: number
  } | null
  onCreateEmpty: () => void
  onNodeContextAction: (action: NodeContextMenuAction) => void
  onAddContextNode: (kind: GenerationNodeKind) => void
  onImportContextFiles: (files: File[]) => void
  onAddConnectedNode: (kind: GenerationNodeKind) => void
  batchDock: { visible: boolean; dismiss: () => void }
  production: ReturnType<typeof useCanvasProductionActions>
  timelineCollapsed: boolean
  hasBatchPlanPreview: boolean
  zoom: number
  zoomPercent: number
  offset: { x: number; y: number }
  stageSize: { width: number; height: number }
  minimapVisible: boolean
  onToggleMinimap: () => void
  onJumpToCanvasPoint: (point: { x: number; y: number }) => void
  onFitView: () => void
  onResetView: () => void
  onTidy: () => void
  onZoomTo: (nextZoom: number) => void
  frameMenu: CanvasFrameMenuState | null
  onFrameMenuAction: (action: FrameContextMenuAction) => void
  frameToolArmed: boolean
  onToggleFrameTool: () => void
}

export function GenerationCanvasReactFlowOverlays({
  readOnly,
  activeCategoryId,
  nodes,
  allNodes,
  selectedNodeIds,
  selectedSet,
  screenshotOverlay,
  contextNodeMenu,
  connectionCreateMenu,
  onCreateEmpty,
  onNodeContextAction,
  onAddContextNode,
  onImportContextFiles,
  onAddConnectedNode,
  batchDock,
  production,
  timelineCollapsed,
  hasBatchPlanPreview,
  zoom,
  zoomPercent,
  offset,
  stageSize,
  minimapVisible,
  onToggleMinimap,
  onJumpToCanvasPoint,
  onFitView,
  onResetView,
  onTidy,
  onZoomTo,
  frameMenu,
  onFrameMenuAction,
  frameToolArmed,
  onToggleFrameTool,
}: GenerationCanvasReactFlowOverlaysProps): JSX.Element {
  return (
    <>
      {screenshotOverlay}
      {nodes.length === 0 ? <CanvasEmptyState activeCategoryId={activeCategoryId} onCreate={onCreateEmpty} /> : null}
      {contextNodeMenu && contextNodeMenu.target !== 'blank' ? (
        <NodeContextMenu
          className="generation-canvas-react-flow__node-context-menu generation-canvas-v2__node-context-menu z-[20]"
          style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
          canPaste={hasClipboardContent()}
          canGroup={selectedNodeIds.length >= 2}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAction={onNodeContextAction}
        />
      ) : contextNodeMenu ? (
        <NodeAddMenu
          className="generation-canvas-react-flow__context-node-menu generation-canvas-v2__context-node-menu z-[20]"
          style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAddNode={onAddContextNode}
          onImportFiles={onImportContextFiles}
        />
      ) : null}
      {frameMenu ? (
        <FrameContextMenu
          className="generation-canvas-react-flow__frame-menu generation-canvas-v2__frame-menu z-[20]"
          style={{ left: frameMenu.stageX, top: frameMenu.stageY }}
          frameName={frameMenu.frameName}
          canGenerate={frameMenu.canGenerate}
          canSendToTimeline={frameMenu.canSendToTimeline}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAction={onFrameMenuAction}
        />
      ) : null}
      {connectionCreateMenu ? (
        <NodeAddMenu
          className="generation-canvas-react-flow__connection-create-menu generation-canvas-v2__connection-create-menu z-[20] left-auto w-[132px]"
          style={{ left: connectionCreateMenu.stageX, top: connectionCreateMenu.stageY }}
          kinds={['image', 'video']}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAddNode={onAddConnectedNode}
        />
      ) : null}
      {batchDock.visible ? (
        <CanvasBatchGenerateDock
          {...production}
          timelineCollapsed={timelineCollapsed}
          onDismiss={batchDock.dismiss}
        />
      ) : null}
      <CanvasNavigationStack
        readOnly={readOnly}
        nodes={nodes}
        selectedIds={selectedSet}
        zoom={zoom}
        zoomPercent={zoomPercent}
        offset={offset}
        stageSize={stageSize}
        minimapVisible={minimapVisible}
        onToggleMinimap={onToggleMinimap}
        onJumpToCanvasPoint={onJumpToCanvasPoint}
        onFitView={onFitView}
        onResetView={onResetView}
        onTidy={onTidy}
        onZoomTo={onZoomTo}
        frameToolArmed={frameToolArmed}
        onToggleFrameTool={onToggleFrameTool}
        batchPlanOverlay={
          hasBatchPlanPreview ? (
            <React.Suspense fallback={null}>
              <BatchPlanOverlay />
            </React.Suspense>
          ) : null
        }
      />
      <SelectionPromptSaveController nodes={allNodes} disabled={readOnly} />
    </>
  )
}
