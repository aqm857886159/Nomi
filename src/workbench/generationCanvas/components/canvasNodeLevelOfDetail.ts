export const LIGHTWEIGHT_NODE_RENDER_THRESHOLD = 80
export const LIGHTWEIGHT_NODE_ZOOM_THRESHOLD = 0.55

export function shouldUseLightweightNodeRendering(nodeCount: number, zoom: number): boolean {
  return nodeCount > LIGHTWEIGHT_NODE_RENDER_THRESHOLD && zoom < LIGHTWEIGHT_NODE_ZOOM_THRESHOLD
}

export function shouldRenderFullNodeContent(input: {
  lightweightMode: boolean
  selected: boolean
  focusFlash: boolean
}): boolean {
  if (!input.lightweightMode) return true
  return input.selected || input.focusFlash
}
