import type { Viewport } from '@xyflow/react'

type PanDelta = { x: number; y: number }

export function createPanZoomTakeoverReconciler({
  requestFrame,
  cancelFrame,
  readViewport,
  writeViewport,
}: {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frameId: number) => void
  readViewport: () => Viewport
  writeViewport: (viewport: Viewport) => void
}) {
  let frameId: number | null = null
  let pendingViewport: Viewport | null = null

  const applyPending = (): Viewport | null => {
    const next = pendingViewport
    pendingViewport = null
    if (next) writeViewport(next)
    return next
  }

  const flush = (): Viewport | null => {
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    return applyPending()
  }

  return {
    queueDelta(delta: PanDelta): void {
      const current = pendingViewport ?? readViewport()
      pendingViewport = {
        x: current.x + delta.x,
        y: current.y + delta.y,
        zoom: current.zoom,
      }
      if (frameId !== null) return
      frameId = requestFrame(() => {
        frameId = null
        applyPending()
      })
    },
    flush,
    cancel(): void {
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
      pendingViewport = null
    },
  }
}
