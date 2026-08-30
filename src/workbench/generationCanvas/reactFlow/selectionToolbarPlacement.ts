import type { Viewport } from '@xyflow/react'

const VIEWPORT_GUTTER = 8
const TOOLBAR_GAP = 16
const TOOLBAR_MAX_WIDTH = 760
const TOOLBAR_ESTIMATED_HEIGHT = 52

type SelectionBounds = {
  minX: number
  minY: number
  width: number
  height: number
}

type StageSize = { width: number; height: number }

export type SelectionToolbarPlacement = {
  maxWidth: number
  placement: 'above' | 'below'
  transform: string
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolveSelectionToolbarPlacement(
  bounds: SelectionBounds,
  viewport: Viewport,
  stage: StageSize,
): SelectionToolbarPlacement {
  const maxWidth = Math.max(0, Math.min(TOOLBAR_MAX_WIDTH, stage.width - VIEWPORT_GUTTER * 2))
  const rawX = (bounds.minX + bounds.width / 2) * viewport.zoom + viewport.x
  const minX = VIEWPORT_GUTTER + maxWidth / 2
  const maxX = stage.width - VIEWPORT_GUTTER - maxWidth / 2
  const x = maxX >= minX ? clamp(rawX, minX, maxX) : stage.width / 2

  const boundsTop = bounds.minY * viewport.zoom + viewport.y
  const boundsBottom = (bounds.minY + bounds.height) * viewport.zoom + viewport.y
  const spaceAbove = boundsTop - TOOLBAR_GAP - VIEWPORT_GUTTER
  const spaceBelow = stage.height - boundsBottom - TOOLBAR_GAP - VIEWPORT_GUTTER
  const placement = spaceAbove >= TOOLBAR_ESTIMATED_HEIGHT || spaceAbove >= spaceBelow ? 'above' : 'below'
  const y = placement === 'above'
    ? clamp(boundsTop - TOOLBAR_GAP, VIEWPORT_GUTTER + TOOLBAR_ESTIMATED_HEIGHT, stage.height - VIEWPORT_GUTTER)
    : clamp(boundsBottom + TOOLBAR_GAP, VIEWPORT_GUTTER, stage.height - VIEWPORT_GUTTER - TOOLBAR_ESTIMATED_HEIGHT)
  const translateY = placement === 'above' ? '-100%' : '0'

  return {
    maxWidth,
    placement,
    transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, ${translateY})`,
    x,
    y,
  }
}
