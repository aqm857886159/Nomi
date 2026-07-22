// 拖拽连线：连线进行中跟踪指针、画预览线、抬起时命中目标节点即连边（从 GenerationCanvas 抽出，R9/R12）。
// pointermove 高频 → rAF 节流，预览线每帧最多更新一次（避免大图连线掉帧，B3）。
import React from 'react'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'

type Offset = { x: number; y: number }

function findConnectionTargetNodeId(clientX: number, clientY: number, sourceNodeId: string): string | null {
  const hitStack = document.elementsFromPoint(clientX, clientY)
  let sourceHit = false
  for (const hit of hitStack) {
    const nodeId = hit.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId
    if (!nodeId) continue
    if (nodeId !== sourceNodeId) return nodeId
    sourceHit = true
  }
  return sourceHit ? sourceNodeId : null
}

type UseDragToConnectArgs = {
  readOnly: boolean
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  cancelConnection: () => void
  onDropOnEmpty?: (input: {
    sourceNodeId: string
    sourceSide: ConnectionAnchorSide
    stagePoint: Offset
    canvasPoint: Offset
    clientPoint: Offset
  }) => void
}

export function useDragToConnect({
  readOnly,
  pendingConnectionSourceId,
  pendingConnectionSourceSide,
  stageRef,
  offsetRef,
  zoomRef,
  cancelConnection,
  onDropOnEmpty,
}: UseDragToConnectArgs): { pendingCursorPos: Offset | null } {
  const [pendingCursorPos, setPendingCursorPos] = React.useState<Offset | null>(null)

  React.useEffect(() => {
    if (readOnly) return undefined
    if (!pendingConnectionSourceId) {
      setPendingCursorPos(null)
      return undefined
    }
    let frame: number | null = null
    let pending: Offset | null = null
    const handleMove = (event: PointerEvent) => {
      if (!stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const o = offsetRef.current
      const z = zoomRef.current
      pending = { x: (event.clientX - rect.left - o.x) / z, y: (event.clientY - rect.top - o.y) / z }
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (pending) setPendingCursorPos(pending)
      })
    }
    const handleUp = (event: PointerEvent) => {
      // 命中用**真实渲染的节点 DOM**（松手处完整元素栈），不再用名义尺寸算 AABB——
      // 节点真实渲染高（resolvePreviewHeight：生成后按图比例、卡片类固定高）常比名义尺寸高，
      // 旧 AABB 命中盒比可见卡矮 → 松手落在卡片可见下半区时 find 落空、静默取消（「线连不上」R1）。
      // elementsFromPoint 会穿过节点上的浮层/工具条/透明交互层，找到下方第一张非源节点卡；
      // 用户只要把线拉到可落节点的任意可见区域即可，不必精确命中连接点。
      const targetId = findConnectionTargetNodeId(event.clientX, event.clientY, pendingConnectionSourceId)
      if (targetId === pendingConnectionSourceId) {
        cancelConnection()
      } else if (targetId) {
        completeNodeConnection(targetId)
      } else {
        if (!stageRef.current || !onDropOnEmpty) {
          cancelConnection()
        } else {
          const rect = stageRef.current.getBoundingClientRect()
          const o = offsetRef.current
          const z = zoomRef.current
          const stagePoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }
          onDropOnEmpty({
            sourceNodeId: pendingConnectionSourceId,
            sourceSide: pendingConnectionSourceSide,
            stagePoint,
            canvasPoint: { x: (stagePoint.x - o.x) / z, y: (stagePoint.y - o.y) / z },
            clientPoint: { x: event.clientX, y: event.clientY },
          })
        }
      }
      setPendingCursorPos(null)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [pendingConnectionSourceId, pendingConnectionSourceSide, cancelConnection, onDropOnEmpty, readOnly, offsetRef, stageRef, zoomRef])

  return { pendingCursorPos }
}
