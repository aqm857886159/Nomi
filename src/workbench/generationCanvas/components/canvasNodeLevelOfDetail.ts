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

/**
 * 订阅原语（2026-09-25 画布跟手）：节点外壳只订这两个布尔，跨过门槛才重渲。
 * 之前每张卡订节点总数 + `useViewport()`，新建 / 删除一个节点、平移缩放的每一帧，全部卡片都重渲。
 */
export function isLargeCanvas(nodeCount: number): boolean {
  return nodeCount > LIGHTWEIGHT_NODE_RENDER_THRESHOLD
}

export function isZoomedOutForLightweight(zoom: number): boolean {
  return zoom < LIGHTWEIGHT_NODE_ZOOM_THRESHOLD
}

export function shouldUseLightweightNodeRendering(largeCanvas: boolean, zoomedOut: boolean): boolean {
  return largeCanvas && zoomedOut
}

export function shouldUseLightweightNodeRenderingForSelection(input: {
  largeCanvas: boolean
  zoomedOut: boolean
  selected: boolean
  primarySelection: boolean
}): boolean {
  return shouldUseLightweightNodeRendering(input.largeCanvas, input.zoomedOut)
    || (input.largeCanvas && input.selected && !input.primarySelection)
}

export function retainLargeCanvasLightweightRendering(input: {
  retained: boolean
  largeCanvas: boolean
  selected: boolean
  primarySelection: boolean
}): boolean {
  if (!input.largeCanvas || input.primarySelection) return false
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
