import type { GenerationNodeResult } from '../model/generationCanvasTypes'

export const LIGHTWEIGHT_NODE_RENDER_THRESHOLD = 80
export const LIGHTWEIGHT_NODE_ZOOM_THRESHOLD = 0.55

export type LightweightNodePreview = {
  kind: 'image' | 'video'
  src: string
}

export function resolveLightweightNodePreview(input: {
  result?: Pick<GenerationNodeResult, 'type' | 'url' | 'thumbnailUrl'>
}): LightweightNodePreview | null {
  const result = input.result
  if (!result) return null
  const thumbnailUrl = typeof result.thumbnailUrl === 'string' ? result.thumbnailUrl.trim() : ''
  const url = typeof result.url === 'string' ? result.url.trim() : ''
  if (result.type === 'image') {
    const src = thumbnailUrl || url
    return src ? { kind: 'image', src } : null
  }
  if (result.type === 'video') {
    if (thumbnailUrl) return { kind: 'image', src: thumbnailUrl }
    return url ? { kind: 'video', src: url } : null
  }
  return null
}

export function shouldUseLightweightNodeRendering(nodeCount: number, zoom: number): boolean {
  return nodeCount > LIGHTWEIGHT_NODE_RENDER_THRESHOLD && zoom < LIGHTWEIGHT_NODE_ZOOM_THRESHOLD
}

export function shouldUseLightweightNodeRenderingForSelection(input: {
  nodeCount: number
  zoom: number
  selected: boolean
  primarySelection: boolean
}): boolean {
  return shouldUseLightweightNodeRendering(input.nodeCount, input.zoom)
    || (input.nodeCount > LIGHTWEIGHT_NODE_RENDER_THRESHOLD && input.selected && !input.primarySelection)
}

export function retainLargeCanvasLightweightRendering(input: {
  retained: boolean
  nodeCount: number
  selected: boolean
  primarySelection: boolean
}): boolean {
  if (input.nodeCount <= LIGHTWEIGHT_NODE_RENDER_THRESHOLD || input.primarySelection) return false
  return input.retained || input.selected
}

export function shouldRenderFullNodeContent(input: {
  lightweightMode: boolean
  selected: boolean
  focusFlash: boolean
}): boolean {
  if (!input.lightweightMode) return true
  return input.selected || input.focusFlash
}
