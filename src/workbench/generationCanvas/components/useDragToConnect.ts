// 拖拽连线：连线进行中跟踪指针、画预览线、抬起时命中目标节点即连边（从 GenerationCanvas 抽出，R9/R12）。
// pointermove 高频 → rAF 节流，预览线每帧最多更新一次（避免大图连线掉帧，B3）。
import React from 'react'
import { completeNodeConnection } from '../nodes/completeNodeConnection'

type Offset = { x: number; y: number }

type UseDragToConnectArgs = {
  readOnly: boolean
  pendingConnectionSourceId: string
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  cancelConnection: () => void
}

export function useDragToConnect({
  readOnly,
  pendingConnectionSourceId,
  stageRef,
  offsetRef,
  zoomRef,
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
      // 命中用**真实渲染的节点 DOM**（松手处指针下的元素），不再用名义尺寸算 AABB——
      // 节点真实渲染高（resolvePreviewHeight：生成后按图比例、卡片类固定高）常比名义尺寸高，
      // 旧 AABB 命中盒比可见卡矮 → 松手落在卡片可见下半区时 find 落空、静默取消（「线连不上」R1）。
      // 用 elementFromPoint 命中即所见即所得；连线预览线 pointer-events:none 不挡。
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const targetId = (hit?.closest('[data-node-id]') as HTMLElement | null)?.dataset.nodeId
      if (targetId && targetId !== pendingConnectionSourceId) {
        completeNodeConnection(targetId)
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
  }, [pendingConnectionSourceId, cancelConnection, readOnly, offsetRef, stageRef, zoomRef])

  return { pendingCursorPos }
}
