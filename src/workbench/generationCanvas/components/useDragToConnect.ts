// 拖拽连线：连线进行中跟踪指针、画预览线、抬起时命中目标节点即连边（从 GenerationCanvas 抽出，R9/R12）。
// pointermove 高频 → rAF 节流，预览线每帧最多更新一次（避免大图连线掉帧，B3）。
import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { completeNodeConnection } from '../nodes/completeNodeConnection'

type Offset = { x: number; y: number }

type UseDragToConnectArgs = {
  readOnly: boolean
  pendingConnectionSourceId: string
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  nodesRef: React.MutableRefObject<GenerationCanvasNode[]>
  cancelConnection: () => void
}

export function useDragToConnect({
  readOnly,
  pendingConnectionSourceId,
  stageRef,
  offsetRef,
  zoomRef,
  nodesRef,
  cancelConnection,
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
      if (!stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const canvasX = (event.clientX - rect.left - offsetRef.current.x) / zoomRef.current
      const canvasY = (event.clientY - rect.top - offsetRef.current.y) / zoomRef.current
      const targetNode = nodesRef.current.find((n) => {
        const w = n.size?.width || 300
        const h = n.size?.height || 220
        return canvasX >= n.position.x && canvasX <= n.position.x + w &&
          canvasY >= n.position.y && canvasY <= n.position.y + h
      })
      if (targetNode && targetNode.id !== pendingConnectionSourceId) {
        completeNodeConnection(targetNode.id)
      } else {
        cancelConnection()
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
  }, [pendingConnectionSourceId, cancelConnection, readOnly, nodesRef, offsetRef, stageRef, zoomRef])

  return { pendingCursorPos }
}
