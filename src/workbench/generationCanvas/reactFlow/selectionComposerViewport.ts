import { collectCanvasOverlayRects } from '../../generation/workspaceBottomDocks'
import { CANVAS_MIN_ZOOM, type CanvasFitRect, unionCanvasFitBounds } from '../model/canvasFitBounds'
import { composerCanvasPlacement, composerInitialFootprint } from '../nodes/composerCanvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { CANVAS_FOCUS_MAX_ZOOM, CANVAS_FOCUS_PADDING, resolveFreeViewRect, type FocusViewRect } from './focusViewportRecovery'

type Viewport = { x: number; y: number; zoom: number }
type Editor = { node: CanvasFitRect; composer: { width: number; height: number; initialHeight?: number; gap: number } }

export function editingView(host: HTMLElement): FocusViewRect {
  const stage = host.getBoundingClientRect()
  return resolveFreeViewRect(stage, collectCanvasOverlayRects(host, stage))
}

export function selectedEditor(host: HTMLElement, node: GenerationCanvasNode | undefined, zoom: number): Editor | null {
  if (!node) return null
  const footprint = composerInitialFootprint(node.kind)
  if (!footprint) return null
  const size = resolveNodeVisualSize(node)
  const anchor = host.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"] [data-composer-host="canvas"]`)
  const measured = anchor?.getBoundingClientRect()
  const placement = composerCanvasPlacement(size, zoom, node.kind === 'text' ? 'match-node' : 'standard')
  return { node: { ...node.position, ...size }, composer: {
    width: measured?.width || placement.width, height: measured?.height || footprint.height, initialHeight: footprint.height, gap: footprint.gap,
  } }
}

/** Fit the union at one scale. The editor contributes fixed screen pixels, even when the nodes shrink. */
export function fitEditingBounds(bounds: CanvasFitRect, view: FocusViewRect, editor: Editor | null, maxZoom = CANVAS_FOCUS_MAX_ZOOM) {
  const width = Math.max(1, view.width - 2 * CANVAS_FOCUS_PADDING)
  const height = Math.max(1, view.height - 2 * CANVAS_FOCUS_PADDING)
  let zoom = Math.min(maxZoom, width / bounds.width, height / bounds.height)
  let content = bounds
  if (editor) {
    const { node, composer } = editor
    // Reference chips and model controls can still be mounting on the first measurement.
    const editorHeight = Math.max(composer.initialHeight ?? 0, composer.height)
    const center = node.x + node.width / 2
    const top = node.y + node.height + composer.gap
    const span = Math.max(center - bounds.x, bounds.x + bounds.width - center)
    zoom = Math.min(zoom, (width - composer.width / 2) / span, (height - editorHeight) / (top - bounds.y))
    zoom = Math.max(CANVAS_MIN_ZOOM, zoom)
    content = unionCanvasFitBounds([bounds, {
      x: center - composer.width / (2 * zoom), y: top, width: composer.width / zoom, height: editorHeight / zoom,
    }])!
  }
  zoom = Math.max(CANVAS_MIN_ZOOM, zoom)
  return {
    zoom, x: view.left + (view.width - content.width * zoom) / 2 - content.x * zoom,
    y: view.top + (view.height - content.height * zoom) / 2 - content.y * zoom,
  }
}

export function composerSelectionPan(rect: FocusViewRect, view: FocusViewRect) {
  const dx = rect.left < view.left ? view.left - rect.left : Math.min(0, view.left + view.width - rect.left - rect.width)
  const dy = Math.min(0, view.top + view.height - rect.top - rect.height)
  return dx || dy ? { x: dx, y: dy } : null
}

/** A derived card gets one reveal of the complete editing surface. Other selections only translate. */
export function revealEditor(viewport: Viewport, view: FocusViewRect, editor: Editor, derived: boolean, count: number, dragging: boolean): Viewport | null {
  if (count !== 1 || dragging || !view.width || !view.height) return null
  const { node, composer } = editor
  const { zoom } = viewport
  const cardTop = viewport.y + node.y * zoom
  const rect = {
    left: viewport.x + (node.x + node.width / 2) * zoom - composer.width / 2,
    top: cardTop + (node.height + composer.gap) * zoom,
    width: composer.width, height: composer.height,
  }
  const delta = composerSelectionPan(rect, view)
  if (derived && (delta || cardTop < view.top)) {
    const blockHeight = (node.height + composer.gap) * zoom + Math.max(composer.height, composer.initialHeight ?? 0)
    if (blockHeight > view.height || node.width * zoom > view.width) return fitEditingBounds(node, view, editor, zoom)
    return {
      zoom, x: view.left + view.width / 2 - (node.x + node.width / 2) * zoom,
      y: view.top + (view.height - blockHeight) / 2 - node.y * zoom,
    }
  }
  return delta && { zoom, x: viewport.x + delta.x, y: viewport.y + delta.y }
}
