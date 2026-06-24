import type { CanvasDimensions } from './canvas'
import { normalizePointerPoint, type PointerPoint } from './stroke'

type CanvasClientRect = {
  left: number
  top: number
  width: number
  height: number
}

export function getCanvasPointFromClient(
  clientX: number,
  clientY: number,
  rect: CanvasClientRect,
  dimensions: CanvasDimensions,
  pressure?: number
): PointerPoint {
  const relativeX = rect.width > 0 && Number.isFinite(clientX) ? (clientX - rect.left) / rect.width : 0
  const relativeY = rect.height > 0 && Number.isFinite(clientY) ? (clientY - rect.top) / rect.height : 0
  const x = clamp01(relativeX) * dimensions.width
  const y = clamp01(relativeY) * dimensions.height

  return normalizePointerPoint(x, y, pressure)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
