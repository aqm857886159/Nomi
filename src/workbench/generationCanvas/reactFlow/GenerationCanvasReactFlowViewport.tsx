import { CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM } from '../model/canvasFitBounds'
import { CanvasBatchConnectionLine } from './CanvasBatchConnectionLine'
import React from 'react'
import {
  ReactFlow,
  SelectionMode,
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
import { useCanvasGestureScheme } from '../../../utils/canvasGesturePreference'
import { canvasWheelGestureProps } from './canvasViewportGestureProps'
import { CanvasSelectionToolbar } from '../components/CanvasSelectionToolbar'
import { CanvasGroupProjectionLayer } from '../components/CanvasGroupProjectionLayer'
import type { CanvasGroupBox } from '../components/GroupFrame'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import type { CanvasFrameInteraction } from '../components/GroupFrame'
import type { CanvasFrameRect } from '../model/canvasFrameBounds'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { getSelectedBounds } from '../components/generationCanvasGeometry'
import type { useCanvasProductionActions } from '../components/useCanvasProductionActions'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { canvasViewportFromFlow, isFiniteFlowViewport } from './generationCanvasReactFlowAdapter'
import { edgeTypes, nodeTypes } from './GenerationCanvasReactFlowNodes'
import { expandSelectionBoundsToOwningFrame, resolveSelectionToolbarPlacement } from './selectionToolbarPlacement'
import { useCanvasBottomDockRects } from './useCanvasBottomDockRects'
import { CANVAS_DRAGGING_OWNER, beginCanvasDragging, type CanvasDragLease } from '../components/canvasDraggingFlag'
import { syncCanvasNodeProjection } from './canvasNodeProjectionSync'

type GenerationCanvasReactFlowViewportProps = {
  flowNodes: GenerationFlowNode[]
  flowEdges: GenerationFlowEdge[]
  viewport: Viewport
  stageSize: { width: number; height: number }
  readOnly: boolean
  onNodesChange: OnNodesChange<GenerationFlowNode>
  onNodeDragStart: OnNodeDrag<GenerationFlowNode>
  onNodeDrag: OnNodeDrag<GenerationFlowNode>
  onNodeDragStop: OnNodeDrag<GenerationFlowNode>
  onSelectionEnd: () => void
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
  healViewport: (broken: Viewport) => void
  /** 我们自己的视口动画此刻是否在逐帧直写（useReactFlowViewportAnimation）。 */
  isViewportAnimating: () => boolean
  cancelViewportAnimation: () => void
  groupBoxes: readonly CanvasGroupBox[]
  frame?: CanvasFrameInteraction
  frameDrawPreview?: CanvasFrameRect | null
  /** 框工具就绪：这次拖动归画框，声明式地把平移与节点拖动让给它（R29 §6.2）。 */
  frameToolArmed?: boolean
  collapsedGroupCards: readonly CollapsedGroupCardProjection[]
  onGroupFramePointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string, options?: { selectMembers?: boolean }) => void
  pendingConnection: boolean
  pendingConnectionSourceKind: 'node' | 'group'
  pendingConnectionSide: ConnectionAnchorSide
  onConnectToGroup: (groupId: string) => void
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
  onNodeDrag,
  onNodeDragStop,
  onSelectionEnd,
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
  healViewport,
  isViewportAnimating,
  cancelViewportAnimation,
  groupBoxes,
  frame,
  frameDrawPreview,
  frameToolArmed = false,
  collapsedGroupCards,
  onGroupFramePointerDown,
  pendingConnection,
  pendingConnectionSourceKind,
  pendingConnectionSide,
  onConnectToGroup,
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
  // 这次视口手势**属于哪个分类**（在 moveStart 那一刻钉住）。
  //
  // 2026-09-21：这里原来是一个 `viewportCancelledRef`，被中断时置 true，然后让 `onMoveEnd`
  // **整段 return**——连 NaN 守卫和 `rememberCategoryViewport` 一起跳过。于是「屏幕上的视口」
  // 和「记住的视口」分家：中断不会把画布移回去，但没人把它记下来，下一次视口同步 effect
  // 一跑就跳回中断前的位置（同一个病在 useGenerationCanvasReactFlowPointer 的 finishPan 里也犯过一次）。
  // 它真正要防的其实只有一件事：**别把这次手势的视口记到另一个分类头上**。
  // 那就记住分类本身，而不是整段不记。moveStart 缺席（例如 fitView 的过渡）时回落到当前分类。
  const viewportGestureCategoryRef = React.useRef<string | null>(null)
  const viewportLeaseRef = React.useRef<CanvasDragLease | null>(null)
  React.useEffect(() => () => {
    viewportLeaseRef.current?.release()
    viewportLeaseRef.current = null
    canvasPanMovedRef.current = false
  }, [activeCategoryId, canvasPanMovedRef, readOnly])
  // 「画布手势」设置（#832）订阅式读：设置页改完，这块画布当场换语义，不用重开。
  // 翻译成内核开关的那一步住在 canvasViewportGestureProps（真值表仍归 resolveWheelIntent）。
  const wheelGestures = canvasWheelGestureProps(useCanvasGestureScheme())
  // 底部那一排常驻控件此刻占了哪几块——浮条不许排到它们身上（现量，不写常数）。
  const bottomDockRects = useCanvasBottomDockRects(hostRef, Boolean(selectedBounds) && selectedNodeIds.length > 1)
  // 浮条让开的是「你选中的那个东西」的上沿：选中的卡全在一个框里时，那就是框的上沿
  // ——框的名字/计数写在那条标签带上，浮条压上去等于把你刚抓住的东西的身份牌盖掉。
  const selectionToolbarPlacement = selectedBounds
    ? resolveSelectionToolbarPlacement(
        expandSelectionBoundsToOwningFrame(
          selectedBounds,
          groupBoxes.map((box) => ({ top: box.top, nodeIds: box.group.nodeIds })),
          selectedNodeIds,
        ),
        viewport,
        stageSize,
        bottomDockRects,
      )
    : null
  return (
    <ReactFlow
      defaultNodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={viewport}
      minZoom={CANVAS_MIN_ZOOM}
      maxZoom={CANVAS_MAX_ZOOM}
      // 框工具就绪期间把这两颗开关关掉，内核**知道**这次拖动不归它——而不是我们在
      // capture 阶段偷它的 pointerdown（R29 §6.2：偷法在框架改事件绑定阶段时会静默失效）。
      // 空格 / 中键 / 右键平移不走 panOnDrag，由 useGenerationCanvasReactFlowPointer 的
      // 辅助平移接管，所以就绪期间画布并没有被这颗工具锁死。
      nodesDraggable={!readOnly && !frameToolArmed}
      nodesConnectable={!readOnly}
      elementsSelectable={!readOnly}
      elevateNodesOnSelect={false}
      panOnDrag={frameToolArmed ? false : [0, 1]}
      autoPanOnConnect={false}
      connectOnClick={false}
      selectionKeyCode="Shift"
      multiSelectionKeyCode="Shift"
      // 扫到就算选中（2026-06-14 §B2 拍板的 AABB 相交语义）。内核默认是 Full＝必须整张卡
      // 落进框里，用户得把框拉得比卡还大——迁移时漏传这颗，走查还被改写去迁就它。
      selectionMode={SelectionMode.Partial}
      // 旧画布没有「双击空白」这个手势；内核默认 true，误触就突然放大一档。
      zoomOnDoubleClick={false}
      // 滚轮语义二选一（#832）。⌘/Ctrl+滚轮、捏合、Shift+滚轮横向平移都由内核自己兜，
      // 见 canvasViewportGestureProps 的头注释（带 @xyflow/system 的 file:line）。
      zoomOnScroll={wheelGestures.zoomOnScroll}
      panOnScroll={wheelGestures.panOnScroll}
      panOnScrollMode={wheelGestures.panOnScrollMode}
      panOnScrollSpeed={wheelGestures.panOnScrollSpeed}
      noPanClassName="generation-canvas-react-flow__no-pan"
      onlyRenderVisibleElements
      deleteKeyCode={null}
      fitView={false}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onSelectionEnd={onSelectionEnd}
      onEdgeClick={onEdgeClick}
      onEdgesDelete={onEdgesDelete}
      onNodeContextMenu={onNodeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      onPaneClick={onPaneClick}
      connectionLineComponent={CanvasBatchConnectionLine}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onMoveStart={(event) => {
        // 用户自己开始拖 / 滚 / 捏（有来源事件）时，一段还在飞的定位动画必须立刻让位——否则它下一帧把视口盖回去，
        // 手感是「画布在跟我抢」。我们自己逐帧直写的那几帧没有来源事件，不走这里。
        if (event) cancelViewportAnimation()
        viewportGestureCategoryRef.current = activeCategoryId
        if (!canvasPointerStartRef.current) canvasPanMovedRef.current = false
      }}
      onMove={() => {
        if (!canvasPanMovedRef.current) return
        viewportLeaseRef.current ??= beginCanvasDragging(hostRef.current, CANVAS_DRAGGING_OWNER.reactFlowViewport, { onCancel: () => {
          viewportLeaseRef.current = null
          canvasPanMovedRef.current = false
        } })
      }}
      onMoveEnd={(event, nextViewport) => {
        // 无条件释放这张租约（`release()` 幂等，没升起时是空操作）。不许按 `canvasPanMovedRef` 判断要不要释放：
        // React Flow 在 panOnScroll 下把这次回调推迟 150ms，这期间画布内任何一次按下都会把那个布尔重置成 false，
        // 于是这里跳过释放、`data-dragging` 卡死（2026-09-22，见 docs/fixes/2026-09-22-canvas-dragging-flag-outlives-gesture.root-cause.json）。
        // 真漏掉的那一次由 canvasDraggingFlag 的手势兜底闸收（标志的寿命上限 = 这一次指针手势）。
        viewportLeaseRef.current?.release()
        viewportLeaseRef.current = null
        canvasPanMovedRef.current = false
        if (!isFiniteFlowViewport(nextViewport)) {
          // React Flow 自己的 d3 过渡撞上 0×0 的 extent 缓存会吐出 NaN 视口（见 GenerationCanvasReactFlow
          // 的 animateViewportTo 头注释）。NaN 一旦被记进分类视口，同步 effect 会把它写回去，画布永久空白。
          // 这里不记、不信，交给外层用最后一份好视口把 React Flow 拉回来。
          healViewport(nextViewport)
          return
        }
        // 我们自己的动画逐帧直写（duration=0），React Flow 每一帧都报一次「移动结束」。中间帧不写 store、不重渲整张画布，
        // 走完时由 useReactFlowViewportAnimation 的 onAnimationSettled 记一次（2026-09-25：以前这里每帧写 workbenchStore，
        // 连带所有订了缩放的节点浮层每帧重算）。
        if (!event && isViewportAnimating()) return
        setLiveViewport(nextViewport)
        // 记到**这次手势开始时那个分类**头上：被中断、或收尾正好落在切分类之后，都不许写到别人账上。
        rememberCategoryViewport(viewportGestureCategoryRef.current ?? activeCategoryId, canvasViewportFromFlow(nextViewport))
        viewportGestureCategoryRef.current = null
      }}
      proOptions={{ hideAttribution: true }}
    >
      <CanvasNodeProjectionSync flowNodes={flowNodes} isNodeDragging={isNodeDragging} />
      <ViewportPortal>
        <CanvasGroupProjectionLayer
          boxes={groupBoxes}
          frame={frame}
          drawPreview={frameDrawPreview}
          cards={collapsedGroupCards}
          readOnly={readOnly}
          onPointerDown={onGroupFramePointerDown}
          pendingConnection={pendingConnection}
          pendingConnectionSourceKind={pendingConnectionSourceKind}
          pendingConnectionSide={pendingConnectionSide}
          onConnectToGroup={onConnectToGroup}
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
