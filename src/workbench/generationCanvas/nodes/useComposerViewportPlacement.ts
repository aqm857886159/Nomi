import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { CANVAS_DRAGGING_ATTRIBUTE } from '../components/canvasDraggingFlag'
import { resolveAnchoredPlacement } from './anchoredPlacement'

export const NODE_FLOATING_TOOLBAR_SELECTOR = '[data-node-floating-toolbar="true"]'
const VIEWPORT_MARGIN = 12
const TOOLBAR_CLEARANCE_GAP = 18
const COMPOSER_MAX_WIDTH = 880
const COMPOSER_MIN_WIDTH = 360

export function toolbarClearanceInCanvasUnits(screenHeight: number, zoom: number, gap: number): number {
  return screenHeight > 0 ? screenHeight / (zoom || 1) + gap : 0
}

/**
 * One placement owner for every composer: all measurements are screen pixels.
 *
 * 位置只跟着**这个节点**走：视口内 clamp + below/above 翻转，别的什么都不看
 * （几何本体在 `anchoredPlacement.ts`）。以前这里挂着一套「全场障碍 ResizeObserver +
 * workspace 子树 MutationObserver」，任何无关元素动一下都会重排浮框，那就是用户报的漂移
 * （2026-09-10 反馈 #10）。
 *
 * 要观测的因此**正好是那两个入参**：节点自己的屏幕矩形，和舞台的屏幕矩形。
 * 观测方式见下面 `recompute` 后面那段——`ResizeObserver` 一个人办不到。
 */
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
  const [placement, setPlacement] = React.useState({ left: 0, top: visualSize.height + gap, maxWidth: COMPOSER_MAX_WIDTH, maxHeight: preferredMaxHeight, referenceMaxHeight: preferredMaxHeight, flipUp: false })

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return

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
      Object.assign(card.style, { maxWidth: `${COMPOSER_MAX_WIDTH}px`, minWidth: `${COMPOSER_MIN_WIDTH}px`, maxHeight: `${preferredMaxHeight}px`, minHeight: `${minUsableHeight}px` })
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
      const result = resolveAnchoredPlacement({
        stage: { left: stageRect.left + VIEWPORT_MARGIN, right: stageRect.right - VIEWPORT_MARGIN, top: stageRect.top + VIEWPORT_MARGIN, bottom: stageRect.bottom - VIEWPORT_MARGIN },
        anchor: nodeRect,
        width: Math.min(COMPOSER_MAX_WIDTH, naturalSize.width),
        height: Math.min(preferredMaxHeight, naturalSize.height),
        gap: gap * canvasZoom,
        aboveClearance: toolbarClearanceInCanvasUnits(toolbar?.getBoundingClientRect().height ?? 0, canvasZoom, TOOLBAR_CLEARANCE_GAP) * canvasZoom,
      })
      const next = { left: (result.left - nodeRect.left) / canvasZoom, top: (result.top - nodeRect.top) / canvasZoom, maxWidth: result.width, maxHeight: result.height, referenceMaxHeight: Math.max(0, result.height - fixedHeight), flipUp: result.side === 'above' }
      setPlacement(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next)
    }

    recompute()
    // 卡片内容变高变宽 → 自然尺寸变了，要重算。这条只有 ResizeObserver 办得到。
    const resizeObserver = new ResizeObserver(recompute)
    resizeObserver.observe(anchor)

    // 另外两个入参（节点矩形、舞台矩形）**不能**只靠 ResizeObserver：
    //  · RO 报的是 border-box 的布局尺寸，看不见 transform——节点入场是一段 scale 动画，
    //    动画期间量到的节点矩形比最终小 11%，照它算出来的位置会永久偏掉（实测偏 22.7px，
    //    见 tests/ux/node-composer-placement.walk.mjs 的探针记录）；
    //  · RO 也看不见「尺寸没变、位置变了」——外壳面板开合会把整个 stage 平移走。
    // 生态里的标准答案就是每帧比对矩形（Floating UI `autoUpdate` 的 animationFrame 策略）。
    // 代价被两件事夹住：每帧只读两个 rect，值没变一个字都不写；画布拖动期间直接跳过——
    // 那时浮框本来就 invisible（见 NodeGenerationComposer 的 data-dragging 注释），
    // 而拖动是全仓最吃帧的动作，不该为一个看不见的浮框付 layout 读。
    const signatureOf = (rect: DOMRect) => `${rect.left},${rect.top},${rect.right},${rect.bottom}`
    let lastSignature = `${signatureOf(nodeEl.getBoundingClientRect())}|${signatureOf(stage.getBoundingClientRect())}`
    let frame = window.requestAnimationFrame(function watch() {
      frame = window.requestAnimationFrame(watch)
      if (stage.getAttribute(CANVAS_DRAGGING_ATTRIBUTE) === 'true') return
      const signature = `${signatureOf(nodeEl.getBoundingClientRect())}|${signatureOf(stage.getBoundingClientRect())}`
      if (signature === lastSignature) return
      lastSignature = signature
      recompute()
    })
    return () => { window.cancelAnimationFrame(frame); resizeObserver.disconnect() }
  }, [canvasOffset, canvasZoom, gap, minUsableHeight, node.id, node.position?.x, node.position?.y, node.result?.url, preferredMaxHeight, visualSize.height, visualSize.width])

  return { anchorRef, canvasZoom, ...placement }
}
