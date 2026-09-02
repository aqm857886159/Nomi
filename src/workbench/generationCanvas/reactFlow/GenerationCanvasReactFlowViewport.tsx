import React from 'react'
import {
  ReactFlow,
  ViewportPortal,
  type OnConnect,
  type OnConnectEnd,
  type OnConnectStart,
  type OnEdgesDelete,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
  useReactFlow,
} from '@xyflow/react'
import { CanvasSelectionToolbar } from '../components/CanvasSelectionToolbar'
import { CanvasGroupProjectionLayer } from '../components/CanvasGroupProjectionLayer'
import type { CanvasGroupBox } from '../components/GroupFrame'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { getSelectedBounds } from '../components/generationCanvasGeometry'
import type { useCanvasProductionActions } from '../components/useCanvasProductionActions'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { canvasViewportFromFlow } from './generationCanvasReactFlowAdapter'
import { edgeTypes, nodeTypes } from './GenerationCanvasReactFlowNodes'
import { resolveSelectionToolbarPlacement } from './selectionToolbarPlacement'
import { CANVAS_DRAGGING_OWNER, setCanvasDragging } from '../components/canvasDraggingFlag'
import { syncCanvasNodeProjection } from './canvasNodeProjectionSync'

type GenerationCanvasReactFlowViewportProps = {
  flowNodes: GenerationFlowNode[]
  flowEdges: GenerationFlowEdge[]
  viewport: Viewport
  stageSize: { width: number; height: number }
  readOnly: boolean
  onNodesChange: OnNodesChange<GenerationFlowNode>
  onNodeDragStart: OnNodeDrag<GenerationFlowNode>
  onNodeDragStop: OnNodeDrag<GenerationFlowNode>
  onEdgeClick: (event: React.MouseEvent, edge: GenerationFlowEdge) => void
  onEdgesDelete: OnEdgesDelete<GenerationFlowEdge>
  onNodeContextMenu: (event: React.MouseEvent, node: GenerationFlowNode) => void
  onPaneContextMenu: (event: MouseEvent | React.MouseEvent) => void
  onPaneClick: () => void
  onConnect: OnConnect
  onConnectStart: OnConnectStart
  onConnectEnd: OnConnectEnd
  canvasPointerStartRef: React.MutableRefObject<{ x: number; y: number } | null>
  canvasPanMovedRef: React.MutableRefObject<boolean>
  hostRef: React.RefObject<HTMLDivElement>
  setLiveViewport: React.Dispatch<React.SetStateAction<Viewport>>
  activeCategoryId: string
  rememberCategoryViewport: (categoryId: string, viewport: { zoom: number; offset: { x: number; y: number } }) => void
  groupBoxes: readonly CanvasGroupBox[]
  collapsedGroupCards: readonly CollapsedGroupCardProjection[]
  onGroupFramePointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string, options?: { selectMembers?: boolean }) => void
  pendingConnection: boolean
  pendingConnectionSourceId: string
  pendingConnectionSourceKind: 'node' | 'group'
  pendingConnectionSide: ConnectionAnchorSide
  onConnectToGroup: (groupId: string) => void
  onStartGroupConnection: (event: React.PointerEvent<HTMLElement>, groupId: string, side: ConnectionAnchorSide) => void
  onSetGroupCollapsed: (groupId: string, collapsed: boolean) => void
  selectedBounds: ReturnType<typeof getSelectedBounds>
  selectedNodeIds: readonly string[]
  selectedGroupIds: readonly string[]
  production: ReturnType<typeof useCanvasProductionActions>
  contactSheetCount: number
  onGroupSelectedNodes: () => void
  onUngroupSelectedNodes: () => void
  onBuildContactSheet: () => void
  onSaveWorkflow: () => void
  onClearSelection: () => void
  isNodeDragging: boolean
}

function CanvasNodeProjectionSync({
  flowNodes,
  isNodeDragging,
}: {
  flowNodes: readonly GenerationFlowNode[]
  isNodeDragging: boolean
}): null {
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const previousProjectionRef = React.useRef<readonly GenerationFlowNode[] | null>(null)
  React.useEffect(() => {
    syncCanvasNodeProjection(flow, flowNodes, previousProjectionRef, isNodeDragging)
  }, [flow, flowNodes, isNodeDragging])
  return null
}

export function GenerationCanvasReactFlowViewport({
  flowNodes,
  flowEdges,
  viewport,
  stageSize,
  readOnly,
  onNodesChange,
  onNodeDragStart,
  onNodeDragStop,
  onEdgeClick,
  onEdgesDelete,
  onNodeContextMenu,
  onPaneContextMenu,
  onPaneClick,
  onConnect,
  onConnectStart,
  onConnectEnd,
  canvasPointerStartRef,
  canvasPanMovedRef,
  hostRef,
  setLiveViewport,
  activeCategoryId,
  rememberCategoryViewport,
  groupBoxes,
  collapsedGroupCards,
  onGroupFramePointerDown,
  pendingConnection,
  pendingConnectionSourceId,
  pendingConnectionSourceKind,
  pendingConnectionSide,
  onConnectToGroup,
  onStartGroupConnection,
  onSetGroupCollapsed,
  selectedBounds,
  selectedNodeIds,
  selectedGroupIds,
  production,
  contactSheetCount,
  onGroupSelectedNodes,
  onUngroupSelectedNodes,
  onBuildContactSheet,
  onSaveWorkflow,
  onClearSelection,
  isNodeDragging,
}: GenerationCanvasReactFlowViewportProps): JSX.Element {
  const selectionToolbarPlacement = selectedBounds
    ? resolveSelectionToolbarPlacement(selectedBounds, viewport, stageSize)
    : null
  return (
    <ReactFlow
      defaultNodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={viewport}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable={!readOnly}
      elevateNodesOnSelect={false}
      panOnDrag={[0, 1]}
      autoPanOnConnect={false}
      connectOnClick={false}
      selectionKeyCode="Shift"
      multiSelectionKeyCode="Shift"
      noPanClassName="generation-canvas-react-flow__no-pan"
      onlyRenderVisibleElements
      deleteKeyCode={null}
      fitView={false}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onEdgeClick={onEdgeClick}
      onEdgesDelete={onEdgesDelete}
      onNodeContextMenu={onNodeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      onPaneClick={onPaneClick}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onMoveStart={() => {
        if (!canvasPointerStartRef.current) canvasPanMovedRef.current = false
      }}
      onMove={() => {
        if (!canvasPanMovedRef.current) return
        setCanvasDragging(hostRef.current, true, CANVAS_DRAGGING_OWNER.reactFlowViewport)
      }}
      onMoveEnd={(_event, nextViewport) => {
        if (canvasPanMovedRef.current) {
          setCanvasDragging(hostRef.current, false, CANVAS_DRAGGING_OWNER.reactFlowViewport)
        }
        canvasPanMovedRef.current = false
        setLiveViewport(nextViewport)
        rememberCategoryViewport(activeCategoryId, canvasViewportFromFlow(nextViewport))
      }}
      proOptions={{ hideAttribution: true }}
    >
      <CanvasNodeProjectionSync flowNodes={flowNodes} isNodeDragging={isNodeDragging} />
      <ViewportPortal>
        <CanvasGroupProjectionLayer
          boxes={groupBoxes}
          cards={collapsedGroupCards}
          readOnly={readOnly}
          onPointerDown={onGroupFramePointerDown}
          pendingConnection={pendingConnection}
          pendingConnectionSourceId={pendingConnectionSourceId}
          pendingConnectionSourceKind={pendingConnectionSourceKind}
          pendingConnectionSide={pendingConnectionSide}
          onConnectToGroup={onConnectToGroup}
          onStartGroupConnection={onStartGroupConnection}
          onSetCollapsed={onSetGroupCollapsed}
        />
      </ViewportPortal>
      {selectionToolbarPlacement && selectedNodeIds.length > 1 && !readOnly ? (
        <CanvasSelectionToolbar
          selectedCount={selectedNodeIds.length}
          selectedGroupCount={selectedGroupIds.length}
          transform={selectionToolbarPlacement.transform}
          maxWidth={selectionToolbarPlacement.maxWidth}
          eligibleCount={production.eligibleIds.length}
          executionGroups={production.executionGroups}
          concurrency={production.concurrency}
          contactSheetCount={contactSheetCount}
          onConcurrencyChange={production.setConcurrency}
          onGenerate={production.generate}
          onApplyModel={production.applyModel}
          onGroupSelectedNodes={onGroupSelectedNodes}
          onUngroupSelectedNodes={onUngroupSelectedNodes}
          onBuildContactSheet={onBuildContactSheet}
          onSaveWorkflow={onSaveWorkflow}
          onClearSelection={onClearSelection}
        />
      ) : null}
    </ReactFlow>
  )
}
