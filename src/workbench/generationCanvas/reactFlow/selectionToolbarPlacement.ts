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

/**
 * 视口底部**已经被别人占住**的那一块（stage 坐标系，原点在 stage 左上）。
 *
 * 画布底部常驻着一排东西：左下的画布工具簇（缩略图 + 缩放条）、底部居中的批量生成停靠条、
 * 底部居中的「时间轴」胶囊、右下的时间轴迷你画面窗。它们全都**不随视口滚动**——
 * 用户看到的画布可用高度因此比 `stage.height` 矮一截。
 */
export type StageDockRect = { left: number; top: number; right: number; bottom: number }

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

/**
 * 浮条真正可以落到多低——**底部停靠区的上沿**，不是 stage 的下沿。
 *
 * 起因（2026-09-07 真机走查 `10-frame-moved.png`）：这个函数原来只拿 `stage.height` 当底，
 * 把「底部那一排常驻控件占着的地方」当成空地。于是选中一个几乎占满这一屏的框时，
 * 浮条被排到选区下方，正好压在底部居中的「时间轴」胶囊上——**「生成选中 N 个」被挡掉半截**，
 * 用户点下去要么点到时间轴、要么点了个看不全的按钮。
 *
 * 判据就是那条最朴素的：**浮条矩形不许和任何一块停靠区矩形相交**。
 * 只有横向真的压得上的那几块才算（左下的工具簇不该逼一个靠右的浮条往上跑），
 * 所以先按浮条这一次的横向跨度筛一遍，再取最高的那条上沿当底。
 *
 * 上下都塞不下时由下面的 clamp 收尾：`clamp` 的 min 大于 max 时返回 min，
 * 也就是把浮条贴到视口内侧的上边——宁可贴边，也不叠在别人身上。
 */
function resolveUsableBottom(
  stage: StageSize,
  docks: readonly StageDockRect[],
  toolbarLeft: number,
  toolbarRight: number,
): number {
  let bottom = stage.height
  for (const dock of docks) {
    if (![dock.left, dock.top, dock.right, dock.bottom].every((value) => Number.isFinite(value))) continue
    // 完全在这一屏之外的（例如时间轴展开后被顶出去的胶囊）不参与——它挡不住任何人。
    if (dock.bottom <= 0 || dock.top >= stage.height) continue
    // 横向压不上就撞不上：这正是「矩形相交」判据的另一半，少了它会为左下角的缩略图
    // 把一个靠右的浮条无端往上顶一大截。
    if (dock.right <= toolbarLeft || dock.left >= toolbarRight) continue
    bottom = Math.min(bottom, dock.top)
  }
  return Math.max(0, bottom)
}

export function resolveSelectionToolbarPlacement(
  bounds: SelectionBounds,
  viewport: Viewport,
  stage: StageSize,
  bottomDocks: readonly StageDockRect[] = [],
): SelectionToolbarPlacement {
  const maxWidth = Math.max(0, Math.min(TOOLBAR_MAX_WIDTH, stage.width - VIEWPORT_GUTTER * 2))
  const rawX = (bounds.minX + bounds.width / 2) * viewport.zoom + viewport.x
  const minX = VIEWPORT_GUTTER + maxWidth / 2
  const maxX = stage.width - VIEWPORT_GUTTER - maxWidth / 2
  const x = maxX >= minX ? clamp(rawX, minX, maxX) : stage.width / 2
  const usableBottom = resolveUsableBottom(stage, bottomDocks, x - maxWidth / 2, x + maxWidth / 2)

  const boundsTop = bounds.minY * viewport.zoom + viewport.y
  const boundsBottom = (bounds.minY + bounds.height) * viewport.zoom + viewport.y
  const spaceAbove = boundsTop - TOOLBAR_GAP - VIEWPORT_GUTTER
  const spaceBelow = usableBottom - boundsBottom - TOOLBAR_GAP - VIEWPORT_GUTTER
  const placement = spaceAbove >= TOOLBAR_ESTIMATED_HEIGHT || spaceAbove >= spaceBelow ? 'above' : 'below'
  const y = placement === 'above'
    ? clamp(boundsTop - TOOLBAR_GAP, VIEWPORT_GUTTER + TOOLBAR_ESTIMATED_HEIGHT, usableBottom - VIEWPORT_GUTTER)
    : clamp(boundsBottom + TOOLBAR_GAP, VIEWPORT_GUTTER, usableBottom - VIEWPORT_GUTTER - TOOLBAR_ESTIMATED_HEIGHT)
  const translateY = placement === 'above' ? '-100%' : '0'

  return {
    maxWidth,
    placement,
    transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, ${translateY})`,
    x,
    y,
  }
}
