export const HOVER_ZOOM_MAX = 320
export const HOVER_ZOOM_DELAY_MS = 450

export function computeHoverZoomPosition(
  rect: { left: number; right: number; top: number },
  viewport: { width: number; height: number },
  size = HOVER_ZOOM_MAX,
): { left: number; top: number } {
  const left = viewport.width - rect.right > size + 24 ? rect.right + 8 : Math.max(8, rect.left - size - 8)
  const top = Math.max(8, Math.min(rect.top, viewport.height - size - 16))
  return { left, top }
}
