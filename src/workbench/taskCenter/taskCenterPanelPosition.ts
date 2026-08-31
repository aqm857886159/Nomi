const PANEL_WIDTH = 380
const PANEL_GAP = 8
const VIEWPORT_PADDING = 12

export type TaskCenterPanelPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type AnchorRect = Pick<DOMRect, 'bottom' | 'right'>

export function resolveTaskCenterPanelPosition(
  anchor: AnchorRect,
  viewportWidth: number,
  viewportHeight: number,
  minimumTop = 0,
): TaskCenterPanelPosition {
  const width = Math.min(PANEL_WIDTH, Math.max(0, viewportWidth - VIEWPORT_PADDING * 2))
  const left = Math.max(VIEWPORT_PADDING, Math.min(anchor.right - width, viewportWidth - VIEWPORT_PADDING - width))
  const top = Math.min(Math.max(anchor.bottom + PANEL_GAP, minimumTop), viewportHeight - VIEWPORT_PADDING)
  return {
    left,
    top,
    width,
    maxHeight: Math.max(0, viewportHeight - top - VIEWPORT_PADDING),
  }
}
