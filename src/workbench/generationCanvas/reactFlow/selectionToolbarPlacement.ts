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

/** 一个框在**画布坐标**里的上沿 + 它的成员名单——判「这批选中是不是某个框的」只需要这两样。 */
export type SelectionOwningFrame = { top: number; nodeIds: readonly string[] }

/**
 * 把「浮条要让开的那块地方」从**选中的卡**扩到**装着它们的那个框**。
 *
 * 起因（2026-09-07 真机走查）：点一下框 = 选中框里全部成员（既有行为），
 * 浮条随即出现在成员外接盒**上方 16px**。而框的上沿比成员外接盒还高出一条
 * 「留白 24 + 标签带 28」——框的名字、说明、计数、⋯ 菜单全写在那条带上。
 * 于是浮条不偏不倚正好盖住它：**你一碰这个框，它的名字就没了**。
 * 用户刚给这段戏起完名，手一搭上去名字就被一块「已选 3 个」压掉，
 * 而那正是他确认「我抓的是不是这一个」唯一的凭据。
 *
 * 修法不是把浮条挪远一点（那对没有框的选中是白白浪费一截距离），
 * 而是把判据说清楚：浮条让开的应该是「用户此刻选中的**那个东西**」的上沿——
 * 选中的卡全在一个框里时，那个东西就是框，框的上沿包含它的标签带。
 *
 * 只往上扩，不动左右：横向仍按卡片外接盒居中，没有框的选中一个像素都不变。
 */
export function expandSelectionBoundsToOwningFrame(
  bounds: SelectionBounds,
  frames: readonly SelectionOwningFrame[],
  selectedNodeIds: readonly string[],
): SelectionBounds {
  if (!selectedNodeIds.length) return bounds
  // 「这批选中全属于同一个框」才算：跨框或半框半散的选中没有一个可以让开的框上沿。
  const owner = frames.find((frame) => selectedNodeIds.every((nodeId) => frame.nodeIds.includes(nodeId)))
  if (!owner || !Number.isFinite(owner.top) || owner.top >= bounds.minY) return bounds
  return {
    minX: bounds.minX,
    minY: owner.top,
    width: bounds.width,
    height: bounds.height + (bounds.minY - owner.top),
  }
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
