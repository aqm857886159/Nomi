import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type CanvasFocusViewport = {
  x: number
  y: number
  zoom: number
}

export type PendingCanvasFocus = {
  nodeId: string
  categoryId: string
  viewport: CanvasFocusViewport
}

export type PendingCanvasFocusDecision =
  | { type: 'wait' }
  | { type: 'focus'; node: GenerationCanvasNode }
  | { type: 'restore'; viewport: CanvasFocusViewport }

/** Resolve a focus request after the active category and virtualization settle. */
export function resolvePendingCanvasFocus(
  pending: PendingCanvasFocus | null,
  activeCategoryId: string,
  visibleNodes: readonly GenerationCanvasNode[],
  allNodes: readonly GenerationCanvasNode[],
): PendingCanvasFocusDecision {
  if (!pending || pending.categoryId !== activeCategoryId) return { type: 'wait' }
  const target = visibleNodes.find((node) => node.id === pending.nodeId)
  if (target) return { type: 'focus', node: target }
  if (!allNodes.some((node) => node.id === pending.nodeId)) return { type: 'restore', viewport: pending.viewport }
  return { type: 'wait' }
}
