import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { resolveComposerObstaclePlacement } from './composerObstaclePlacement'

export const NODE_FLOATING_TOOLBAR_SELECTOR = '[data-node-floating-toolbar="true"]'
const VIEWPORT_MARGIN = 12
const TOOLBAR_CLEARANCE_GAP = 18

export function toolbarClearanceInCanvasUnits(screenHeight: number, zoom: number, gap: number): number {
  return screenHeight > 0 ? screenHeight / (zoom || 1) + gap : 0
}

/** One placement owner for every composer: all measurements are screen pixels. */
export function useComposerViewportPlacement(input: {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
  gap: number
  preferredMaxHeight: number
  minUsableHeight: number
}) {
  const { node, visualSize, gap, preferredMaxHeight, minUsableHeight } = input
  const canvasZoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  const canvasOffset = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.offset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState({ left: 0, top: visualSize.height + gap, maxWidth: 880, maxHeight: preferredMaxHeight, referenceMaxHeight: preferredMaxHeight, flipUp: false })

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return
    const workspace = stage.closest('.workbench-generation__canvas') ?? stage
    const readObstacles = () => Array.from(workspace.querySelectorAll<HTMLElement>(
      'article[data-node-id], .workbench-generation__timeline-handle, [data-canvas-bottom-dock="true"], [data-node-result-stack], .generation-canvas-react-flow__handle-hit',
    )).filter(element => element !== nodeEl && element.getClientRects().length > 0)

    const recompute = () => {
      const stageRect = stage.getBoundingClientRect()
      const nodeRect = nodeEl.getBoundingClientRect()
      const card = anchor.querySelector<HTMLElement>('.generation-canvas-v2-node__composer-card')
      if (!card) return
      // Measure the current content unconstrained, then restore before paint. This lets both
      // a smaller model form and a newly freed region resize naturally after clipping.
      const references = card.querySelector<HTMLElement>('[data-node-composer-references]')
      const previousReferenceMaxHeight = references?.style.maxHeight ?? ''
      if (references) references.style.maxHeight = 'none'
      const previousStyle = { maxWidth: card.style.maxWidth, minWidth: card.style.minWidth, maxHeight: card.style.maxHeight, minHeight: card.style.minHeight }
      Object.assign(card.style, { maxWidth: '880px', minWidth: '360px', maxHeight: `${preferredMaxHeight}px`, minHeight: `${minUsableHeight}px` })
      const naturalSize = { width: card.offsetWidth, height: card.offsetHeight }
      // Prompt and actions own their minimums. Recommendations are optional;
      // only references may need an additional inner scrollport in a dense canvas.
      const children = Array.from(card.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
      const cardStyle = getComputedStyle(card)
      const pixels = (value: string) => Number.parseFloat(value) || 0
      const fixedHeight = pixels(cardStyle.paddingTop) + pixels(cardStyle.paddingBottom)
        + pixels(cardStyle.borderTopWidth) + pixels(cardStyle.borderBottomWidth)
        + pixels(cardStyle.rowGap) * Math.max(0, children.length - 1)
        + children.reduce((sum, child) => {
          if (child === references || child.hasAttribute('data-node-effect-chips')) return sum
          return sum + (child.hasAttribute('data-node-composer-prompt') ? pixels(getComputedStyle(child).minHeight) : child.offsetHeight)
        }, 0)
      Object.assign(card.style, previousStyle)
      if (references) references.style.maxHeight = previousReferenceMaxHeight
      const toolbar = nodeEl.querySelector<HTMLElement>(NODE_FLOATING_TOOLBAR_SELECTOR)
      const result = resolveComposerObstaclePlacement({
        stage: { left: stageRect.left + VIEWPORT_MARGIN, right: stageRect.right - VIEWPORT_MARGIN, top: stageRect.top + VIEWPORT_MARGIN, bottom: stageRect.bottom - VIEWPORT_MARGIN },
        node: nodeRect,
        obstacles: [...readObstacles(), ...(toolbar ? [toolbar] : [])].map(element => element.getBoundingClientRect()),
        width: Math.min(880, naturalSize.width),
        height: Math.min(preferredMaxHeight, naturalSize.height),
        gap: gap * canvasZoom,
        aboveClearance: toolbarClearanceInCanvasUnits(toolbar?.getBoundingClientRect().height ?? 0, canvasZoom, TOOLBAR_CLEARANCE_GAP) * canvasZoom,
      })
      const next = { left: (result.left - nodeRect.left) / canvasZoom, top: (result.top - nodeRect.top) / canvasZoom, maxWidth: result.width, maxHeight: result.height, referenceMaxHeight: Math.max(0, result.height - fixedHeight), flipUp: result.side === 'above' }
      setPlacement(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next)
    }
    const observed = new Set<Element>()
    const resizeObserver = new ResizeObserver(recompute)
    const syncObstacles = () => {
      const next = new Set<Element>([stage, anchor, nodeEl, ...readObstacles()])
      for (const element of observed) if (!next.has(element)) { resizeObserver.unobserve(element); observed.delete(element) }
      for (const element of next) if (!observed.has(element)) { resizeObserver.observe(element); observed.add(element) }
    }
    syncObstacles()
    recompute()
    const mutationObserver = new MutationObserver((records) => {
      const relevant = records.some(record => record.type === 'childList' || (record.target instanceof Element && record.target.matches('.react-flow__node, article[data-node-id], [data-node-result-stack]')))
      if (relevant) { syncObstacles(); recompute() }
    })
    mutationObserver.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    return () => { mutationObserver.disconnect(); resizeObserver.disconnect() }
  }, [canvasOffset, canvasZoom, gap, minUsableHeight, node.id, node.position?.x, node.position?.y, node.result?.url, preferredMaxHeight, visualSize.height, visualSize.width])

  return { anchorRef, canvasZoom, ...placement }
}
