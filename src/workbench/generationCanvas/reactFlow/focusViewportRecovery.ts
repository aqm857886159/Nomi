import { CANVAS_MIN_ZOOM } from '../model/canvasFitBounds'
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

export type FocusViewRect = { left: number; top: number; width: number; height: number }
export type FocusObstacle = { left: number; top: number; right: number; bottom: number }
/** 选中后浮在节点正下方的生成框占地：屏幕高（最坏值）与离节点底边的间距（画布单位）；节点没有生成框时为 null。 */
export type FocusComposerFootprint = { gap: number; height: number }

/** 对焦是为了读 / 点，不是为了放大：缩放不超过 100%（小节点也不会被放大成一堵墙）。 */
export const CANVAS_FOCUS_MAX_ZOOM = 1
export const CANVAS_FOCUS_PADDING = 16

/**
 * 舞台里扣掉浮在上面的东西（浮动 Agent 面板、迷你画面窗、缩放条、工具条……）后，最大的那块空地。
 * 障碍逐个切：每个障碍把当前空地从左 / 右 / 上 / 下切出四个候选，留面积最大的。完全切没了就当它不存在。
 */
export function resolveFreeViewRect(
  stage: { width: number; height: number },
  obstacles: readonly FocusObstacle[],
): FocusViewRect {
  let free: FocusViewRect = { left: 0, top: 0, width: stage.width, height: stage.height }
  const ordered = [...obstacles]
    .filter((o) => [o.left, o.top, o.right, o.bottom].every(Number.isFinite))
    .sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))
  for (const o of ordered) {
    const right = free.left + free.width
    const bottom = free.top + free.height
    if (o.right <= free.left || o.left >= right || o.bottom <= free.top || o.top >= bottom) continue
    const candidates: FocusViewRect[] = [
      { left: free.left, top: free.top, width: o.left - free.left, height: free.height },
      { left: o.right, top: free.top, width: right - o.right, height: free.height },
      { left: free.left, top: free.top, width: free.width, height: o.top - free.top },
      { left: free.left, top: o.bottom, width: free.width, height: bottom - o.bottom },
    ].filter((c) => c.width > 0 && c.height > 0)
    if (!candidates.length) continue
    free = candidates.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best))
  }
  return free
}

/**
 * 对焦的唯一算式：把「节点 + 选中后浮在它下面的生成框」当成一整块，框进扣掉浮层后的可见区。
 * 缩放 = 整块装得下的最大值，封顶 100%（下限 CANVAS_MIN_ZOOM）；整块在可见区里居中。
 * 即使缩到下限还装不下，也让生成框那一端贴着可见区底边——主操作（↑）可见优先于节点完整。
 */
export function resolveCanvasFocusViewport(input: {
  node: { x: number; y: number; width: number; height: number }
  composer: FocusComposerFootprint | null
  view: FocusViewRect
}): CanvasFocusViewport {
  const { node, composer, view } = input
  const composerHeight = composer?.height ?? 0
  const gap = composer?.gap ?? 0
  const usableWidth = Math.max(1, view.width - CANVAS_FOCUS_PADDING * 2)
  const usableHeight = Math.max(1, view.height - CANVAS_FOCUS_PADDING * 2)
  const fitHeight = (usableHeight - composerHeight) / (node.height + gap)
  const fitWidth = usableWidth / node.width
  const zoom = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_FOCUS_MAX_ZOOM, fitHeight, fitWidth))
  const blockHeight = (node.height + gap) * zoom + composerHeight
  const blockTop = blockHeight > view.height - CANVAS_FOCUS_PADDING * 2
    ? view.top + view.height - CANVAS_FOCUS_PADDING - blockHeight
    : view.top + (view.height - blockHeight) / 2
  return {
    zoom,
    x: view.left + view.width / 2 - (node.x + node.width / 2) * zoom,
    y: blockTop - node.y * zoom,
  }
}
