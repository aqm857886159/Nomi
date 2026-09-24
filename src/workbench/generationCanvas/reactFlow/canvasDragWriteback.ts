import type { TFunction } from 'i18next'
import type { MutableRefObject } from 'react'
import type { OnNodeDrag } from '@xyflow/react'
import { toast } from '../../../ui/toast'
import { useWorkbenchStore } from '../../workbenchStore'
import { clientXToFrame } from '../../timeline/timelineEdit'
import { adoptGenerationNode } from '../../adoption/adoptGenerationNode'
import { reportAdoptionOutcome } from '../../adoption/adoptionReceipt'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { findTimelineDropTarget } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { restoreCanvasDragKernelOwnership } from './canvasDragDraft'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'

type DragPosition = { x: number; y: number }

/** RF owns keyboard movement. Only its synchronous key dispatch may commit outside a drag. */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/**
 * 方向键挪节点的授权范围：按下方向键那一刻选中的那批节点。React Flow 的键盘移动晚于这次 keydown 的派发才落下
 * （2026-09-25 RC 验收：真实按键 400→400 三次不动），所以不能用「同步派发期间 / 一个微任务内」这种时间窗口认，
 * 要用「挪的是不是这批节点」认；键抬起即作废。
 */
export function keyboardMoveScope(event: { key: string }, selectedNodeIds: readonly string[]): ReadonlySet<string> | null {
  return ARROW_KEYS.has(event.key) && selectedNodeIds.length ? new Set(selectedNodeIds) : null
}

/** 这批位置变化是不是那次方向键挪的：节点全在授权范围里。 */
export function isKeyboardMoveBatch(positions: readonly { nodeId: string }[], scope: ReadonlySet<string> | null): boolean {
  return scope !== null && positions.length > 0 && positions.every((change) => scope.has(change.nodeId))
}

export function commitCanvasKeyboardPositions(
  positions: readonly { nodeId: string; position: DragPosition }[],
  canWrite: boolean,
): boolean {
  if (!canWrite) return false
  const state = useGenerationCanvasStore.getState()
  const moved = positions.filter(change => {
    const node = state.nodes.find(candidate => candidate.id === change.nodeId)
    return node && (node.position.x !== change.position.x || node.position.y !== change.position.y)
  })
  if (moved.length) {
    state.captureHistory()
    for (const change of moved) state.moveNode(change.nodeId, change.position, { persist: false, emit: false })
    emitCanvasGesture(moved.map(change => ({ type: 'canvas.node.moved', payload: { nodeId: change.nodeId, position: change.position } })))
    state.commitPersistedChange()
  }
  return true
}

/**
 * XYDrag 在 blur 取消之后还会再吐一批位置：它已经不拥有这些位置了，把内核拉回我们的投影。
 *
 * 两条收窄（2026-09-21）：
 *   ① 只在内核真的和 store **不一致**时才写——新节点刚落画布、React Flow 首次测量时也会发
 *      position change，那一批和 store 是一致的，写回去纯属白费一次 setNodes；
 *   ② 按**当前** store 取值，不用调用点闭包里的 `flowNodes` 快照（它可能已经过期，用过期快照
 *      整体覆盖内核节点表会让刚落的卡停在旧位置——golden 走查量到「第 2 镜没有可点中的位置」
 *      正是这个形状）。
 */
export function restoreDisownedKernelPositions(
  flowStore: { getState: () => { nodes: GenerationFlowNode[]; setNodes: (nodes: GenerationFlowNode[]) => void } },
  positions: readonly { nodeId: string; position: DragPosition }[],
): void {
  const authoritative = useGenerationCanvasStore.getState().nodes
  const disagreeing = positions.some(change => {
    const node = authoritative.find(candidate => candidate.id === change.nodeId)
    return node && (node.position.x !== change.position.x || node.position.y !== change.position.y)
  })
  if (!disagreeing) return
  const byId = new Map(authoritative.map(node => [node.id, node.position] as const))
  flowStore.getState().setNodes(flowStore.getState().nodes.map(node => {
    const position = byId.get(node.id)
    return position && (node.position.x !== position.x || node.position.y !== position.y) ? { ...node, position } : node
  }))
}

type CanvasDragWritebackContext = {
  event: Parameters<OnNodeDrag<GenerationFlowNode>>[0]
  draggedNode: Parameters<OnNodeDrag<GenerationFlowNode>>[1]
  draggedNodes: Parameters<OnNodeDrag<GenerationFlowNode>>[2]
  readOnly: boolean
  t: TFunction
  draggingRef: MutableRefObject<boolean>
  dragStartPositionsRef: MutableRefObject<Map<string, DragPosition>>
  dragDraftNodesRef: MutableRefObject<GenerationFlowNode[]>
  moveNode: ReturnType<typeof useGenerationCanvasStore.getState>['moveNode']
  commitPersistedChange: ReturnType<typeof useGenerationCanvasStore.getState>['commitPersistedChange']
}

export function commitCanvasNodeDragStop({
  event,
  draggedNode,
  draggedNodes,
  readOnly,
  t,
  draggingRef,
  dragStartPositionsRef,
  dragDraftNodesRef,
  moveNode,
  commitPersistedChange,
}: CanvasDragWritebackContext): void {
  const wasDragging = draggingRef.current
  draggingRef.current = false
  if (readOnly || !wasDragging) {
    dragStartPositionsRef.current.clear()
    dragDraftNodesRef.current = []
    return
  }
  const pointer = 'changedTouches' in event ? event.changedTouches[0] : event
  const timelineDropTarget = pointer ? findTimelineDropTarget(pointer.clientX, pointer.clientY) : null
  if (timelineDropTarget) {
    const liveNode = useGenerationCanvasStore.getState().nodes.find((node) => node.id === draggedNode.id)
    if (liveNode?.result?.url) {
      const timeline = useWorkbenchStore.getState().timeline
      const rect = timelineDropTarget.getBoundingClientRect()
      const startFrame = clientXToFrame(pointer.clientX, rect.left, timeline.scale)
      void adoptGenerationNode(liveNode, { placement: { kind: 'frame', startFrame } }).then((outcome) => {
        reportAdoptionOutcome(outcome, { revealTimeline: false })
      })
      commitPersistedChange()
      dragStartPositionsRef.current.clear()
      dragDraftNodesRef.current = []
      return
    }
    toast(t('generationCommon.node.generateBeforeTimeline'), 'info')
  }
  for (const flowNode of draggedNodes) {
    const originalPosition = dragStartPositionsRef.current.get(flowNode.id)
    if (!originalPosition) continue
    if (originalPosition.x === flowNode.position.x && originalPosition.y === flowNode.position.y) continue
    moveNode(flowNode.id, flowNode.position, { persist: false, emit: false })
  }
  const state = useGenerationCanvasStore.getState()
  const movedEvents = draggedNodes
    .map((flowNode) => state.nodes.find((node) => node.id === flowNode.id))
    .filter((node): node is GenerationCanvasNode => Boolean(node))
    .map((node) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: node.id, position: node.position } }))
  if (movedEvents.length) emitCanvasGesture(movedEvents)
  commitPersistedChange()
  dragStartPositionsRef.current.clear()
  dragDraftNodesRef.current = []
}

/**
 * 让 React Flow 的节点拖动真正结束。它（@xyflow/system 的 XYDrag → d3-drag）只在 window 收到 mouseup 时收尾，
 * 没有「按键已松」「原生拖放开始」「窗口失焦」时的中止；我们的租约发现手势已经结束时，从这里补发那一次松手，
 * 走它自己的 end 路径（onNodeDragStop → commitCanvasNodeDragStop / 已取消则空操作），不在内核外另记一份拖动状态。
 */
export function endKernelNodeDrag(at: { clientX: number; clientY: number } | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0, clientX: at?.clientX ?? 0, clientY: at?.clientY ?? 0 }))
}

/**
 * 取消一次节点拖动的**唯一**收尾：租约释放、草稿清空、框预览撤掉、内核位置还原。
 *
 * 它和 `commitCanvasNodeDragStop`（正常松手）是同一件事的两个结局，所以住同一个文件：
 * 2026-09-22 总合并之前它长在 `GenerationCanvasReactFlow.tsx` 的组件体里，那份文件因此越过 800 行门岗，
 * 而「拖动怎么收尾」本来就不该是那个壳的知识。
 */
export function cancelCanvasNodeDrag(input: {
  dragLeaseRef: { current: { release: () => void } | null }
  draggingRef: { current: boolean }
  dragStartPositionsRef: { current: Map<string, { x: number; y: number }> }
  dragDraftNodesRef: { current: unknown[] }
  duplicateDragIdsRef: { current: Map<string, string> }
  setNodeDragActive: (active: boolean) => void
  cancelFramePreview: () => void
  flowStore: Parameters<typeof restoreCanvasDragKernelOwnership>[0]
  /** 把内核的节点数组拨回应用侧那一份（拖动草稿作废）。由调用方给，本文件不认识 RF 的公开 store API。 */
  restoreFlowNodes: () => void
}): void {
  input.dragLeaseRef.current?.release()
  input.dragLeaseRef.current = null
  if (!input.draggingRef.current) return
  input.draggingRef.current = false
  input.setNodeDragActive(false)
  input.dragStartPositionsRef.current.clear()
  input.dragDraftNodesRef.current = []
  input.duplicateDragIdsRef.current.clear()
  input.cancelFramePreview()
  restoreCanvasDragKernelOwnership(input.flowStore)
  input.restoreFlowNodes()
}

/**
 * 正常松手那条收尾的**唯一**入口：租约释放 → 位置写回 → 框归属提交 → 内核归属还原。
 *
 * 顺序是判据的一部分：位置写回之后才提交框归属，先改成员再移动会让框在同一帧里既缩又长，
 * 看着像抖了一下。2026-09-22 总合并把它从 `GenerationCanvasReactFlow.tsx` 的组件体里搬过来——
 * 「拖动怎么收尾」和取消那一条住同一个家，那个壳也因此回到 800 行门岗之内。
 */
export function finishCanvasNodeDrag(input: Parameters<typeof commitCanvasNodeDragStop>[0] & {
  dragLeaseRef: { current: { release: () => void } | null }
  duplicateDragIdsRef: { current: Map<string, string> }
  setNodeDragActive: (active: boolean) => void
  commitFrameMembership: () => void
  flowStore: Parameters<typeof restoreCanvasDragKernelOwnership>[0]
}): void {
  input.dragLeaseRef.current?.release()
  input.dragLeaseRef.current = null
  // #5：解冻 minimap（在所有退出路径之前，含时间轴投放早退；draggingRef 由 writeback 清）。
  input.setNodeDragActive(false)
  commitCanvasNodeDragStop(input)
  withCanvasGestureContext({ source: 'user', txnId: crypto.randomUUID(), suppressUndoBarriers: true }, () => input.commitFrameMembership())
  input.duplicateDragIdsRef.current.clear()
  restoreCanvasDragKernelOwnership(input.flowStore)
}
