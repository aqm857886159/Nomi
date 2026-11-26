import { collectCanvasOverlayRects } from '../../generation/workspaceBottomDocks'
import { CANVAS_MIN_ZOOM, type CanvasFitRect } from '../model/canvasFitBounds'
import { composerCanvasPlacement, composerInitialFootprint } from '../nodes/composerCanvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { CANVAS_FOCUS_MAX_ZOOM, CANVAS_FOCUS_PADDING, resolveFreeViewRect, type FocusViewRect } from './focusViewportRecovery'

type Viewport = { x: number; y: number; zoom: number }
type Editor = {
  node: CanvasFitRect
  composer: { width: number; height: number; initialHeight?: number; gap: number }
  above?: { label: number; toolbarGap: number; toolbarHeight: number }
}
// Initial layout of NodeLabelRow and FloatingToolbarShell, before the selected DOM mounts.
const initialAbove = { label: 34, toolbarGap: 40, toolbarHeight: 38 }

export function editingView(host: HTMLElement): FocusViewRect {
  const stage = host.getBoundingClientRect()
  return resolveFreeViewRect(stage, collectCanvasOverlayRects(host, stage))
}

export function selectedEditor(host: HTMLElement, node: GenerationCanvasNode | undefined, zoom: number): Editor | null {
  if (!node) return null
  const footprint = composerInitialFootprint(node.kind)
  if (!footprint) return null
  const size = resolveNodeVisualSize(node)
  const card = host.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`)
  const measured = card?.querySelector('[data-composer-host="canvas"]')?.getBoundingClientRect()
  const toolbar = card?.querySelector<HTMLElement>('[data-node-floating-toolbar]')
  const label = card?.querySelector<HTMLElement>('[data-node-label-row]')
  const placement = composerCanvasPlacement(size, zoom, node.kind === 'text' ? 'match-node' : 'standard')
  // offsetTop ignores the toolbar's clamp translation and inverse scale. Its bottom gap scales
  // with the card, whereas its visible height (including wrapping) stays in screen pixels.
  const above = {
    label: label ? -label.offsetTop : initialAbove.label,
    toolbarGap: toolbar ? Math.max(0, -toolbar.offsetTop - toolbar.offsetHeight) : initialAbove.toolbarGap,
    toolbarHeight: toolbar ? (toolbar.offsetTop < 0 ? toolbar.offsetHeight : 0) : initialAbove.toolbarHeight,
  }
  return { node: { ...node.position, ...size }, above, composer: {
    width: measured?.width || placement.width, height: measured?.height || footprint.height, initialHeight: footprint.height, gap: footprint.gap + belowRowSpace(card, size.height),
  } }
}

/** 节点下方那一行（样片行）占的画布高度（含缝）：读同一行的 DOM，offsetTop / offsetHeight 不受画布缩放影响。没有这一行 = 0。 */
function belowRowSpace(card: Element | null | undefined, nodeHeight: number): number {
  const row = card?.querySelector<HTMLElement>('[data-sample-row]')
  return row ? Math.max(0, row.offsetTop + row.offsetHeight - nodeHeight) : 0
}

/** Screen-pixel union at the proposed zoom, before viewport translation. */
function editingFootprint(bounds: CanvasFitRect, zoom: number, editor: Editor | null, mounting: boolean) {
  let left = bounds.x * zoom
  let right = (bounds.x + bounds.width) * zoom
  let top = bounds.y * zoom
  let bottom = (bounds.y + bounds.height) * zoom
  if (editor) {
    const { node, composer, above = initialAbove } = editor
    const center = (node.x + node.width / 2) * zoom
    left = Math.min(left, center - composer.width / 2)
    right = Math.max(right, center + composer.width / 2)
    top = Math.min((bounds.y - above.label) * zoom, (node.y - above.toolbarGap) * zoom - above.toolbarHeight)
    bottom = Math.max(bottom, (node.y + node.height + composer.gap) * zoom +
      Math.max(composer.height, mounting ? composer.initialHeight ?? 0 : 0))
  }
  return { left, top, width: right - left, height: bottom - top }
}

export function fitEditingBounds(bounds: CanvasFitRect, view: FocusViewRect, editor: Editor | null, maxZoom = CANVAS_FOCUS_MAX_ZOOM) {
  const width = Math.max(editor?.composer.width ?? 1, view.width - 2 * CANVAS_FOCUS_PADDING)
  const height = Math.max(1, view.height - 2 * CANVAS_FOCUS_PADDING)
  let zoom = maxZoom
  let content = editingFootprint(bounds, zoom, editor, true)
  if (content.width > width || content.height > height) {
    // Each span is monotone in zoom. Fit the union, including fixed-pixel controls at both ends.
    let low = CANVAS_MIN_ZOOM
    let high = maxZoom
    for (let step = 0; step < 24; step++) {
      const mid = (low + high) / 2
      const rect = editingFootprint(bounds, mid, editor, true)
      if (rect.width <= width && rect.height <= height) low = mid
      else high = mid
    }
    zoom = low
    content = editingFootprint(bounds, zoom, editor, true)
  }
  const spareHeight = view.height - content.height
  return {
    zoom, x: view.left + (view.width - content.width) / 2 - content.left,
    y: view.top + Math.min(spareHeight, spareHeight / 2) - content.top,
  }
}

export function composerSelectionPan(rect: FocusViewRect, view: FocusViewRect) {
  const dx = rect.left < view.left ? view.left - rect.left : Math.min(0, view.left + view.width - rect.left - rect.width)
  // Bottom first when the complete block is taller than the view.
  const bottom = view.top + view.height - rect.top - rect.height
  const dy = bottom < 0 ? bottom : Math.min(bottom, Math.max(0, view.top - rect.top))
  return dx || dy ? { x: dx, y: dy } : null
}

export function selectionRevealMode(
  id: string,
  previousNodes: readonly Pick<GenerationCanvasNode, 'id'>[],
  edges: readonly Pick<GenerationCanvasEdge, 'target'>[],
): 'pan' | 'fit' | null {
  if (previousNodes.some(node => node.id === id)) return 'pan'
  return edges.some(edge => edge.target === id) ? 'fit' : null
}

/** Opening and derivation may fit the complete editor. Ordinary selection preserves zoom. */
export function revealEditor(viewport: Viewport, view: FocusViewRect, editor: Editor, fit: boolean, count: number, dragging: boolean): Viewport | null {
  if (count !== 1 || dragging || !view.width || !view.height) return null
  const { zoom } = viewport
  const rect = editingFootprint(editor.node, zoom, editor, fit)
  // Keep a small top margin even on an otherwise fully visible remembered view.
  const visible = { ...view, top: view.top + 6, height: view.height - 6 }
  const translated = { ...rect, left: rect.left + viewport.x, top: rect.top + viewport.y }
  if (fit && (rect.height > visible.height || rect.width > visible.width)) return fitEditingBounds(editor.node, view, editor, zoom)
  if (rect.width > view.width) {
    translated.left = viewport.x + (editor.node.x + editor.node.width / 2) * zoom - editor.composer.width / 2
    translated.width = editor.composer.width
  }
  const delta = composerSelectionPan(translated, visible)
  if (!delta) return null
  if (fit) return fitEditingBounds(editor.node, view, editor, zoom)
  return { zoom, x: viewport.x + delta.x, y: viewport.y + delta.y }
}
