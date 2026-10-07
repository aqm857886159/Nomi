/**
 * `AnchoredPopover` 的**全部几何**。抽成不含 React 的一文件，理由有两条：
 *   · 这一族的失败长得不像失败——浮层放歪了不抛错、不消失，只被裁掉一角或顶出视口，
 *     DOM 断言全绿而人看不见。所以几何必须是一个能被逐例钉死的纯函数
 *     （见 anchoredPopoverPlacement.test.ts）。
 *   · 组件文件同时导出组件与非组件会破坏 Fast Refresh（react-refresh 那条 lint 警告说的就是它）。
 */

export type AnchoredPopoverAlign = 'start' | 'center' | 'end'

/** 先往哪边放。`top` 给节点浮条用：浮条在节点上方，往下开就压在这张图上。放不下才翻到另一边。 */
export type AnchoredPopoverSide = 'bottom' | 'top'

const MARGIN = 8

/** `maxHeight` 只在「两边都放不下」时给：浮层收到这一边剩下的高度、里面滚动。 */
type Placement = { top: number; left: number; maxHeight?: number }

/**
 * 不变量（2026-10-06 起）：**浮层永远不与锚点相交**。锚点 = 调用方说「不许盖住」的那块
 * （至少是触发钮；节点浮条的下拉还连同它所在的那一排，见 `ToolbarActionMenu`）。
 *
 * 先放偏好的那一边；放不下就翻到另一边；两边都放不下，就放在**剩得多的那一边**并收高度（`maxHeight`），
 * 里面滚动。旧版这里是「夹进视口，宁可盖住锚点」——那正是用户截图里「改图菜单压住宫格」的同一种形状：
 * 盖住触发钮，等于把用户刚点的东西和它旁边的按钮一起藏起来。
 *
 * `size.height` 要传**内容的自然高度**（`scrollHeight`），不是被收过的高度——否则收完一量「放得下了」，
 * 下一帧又放开，来回抖。
 */
export function resolveAnchoredPopoverPlacement(
  anchor: DOMRect,
  size: { width: number; height: number },
  align: AnchoredPopoverAlign,
  gap: number,
  viewport: { width: number; height: number },
  side: AnchoredPopoverSide = 'bottom',
): Placement {
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.height
  const roomBelow = viewport.height - MARGIN - below
  const roomAbove = anchor.top - gap - MARGIN
  const fitsBelow = size.height <= roomBelow
  const fitsAbove = size.height <= roomAbove
  let vertical: Pick<Placement, 'top' | 'maxHeight'>
  if (side === 'top' ? fitsAbove : (fitsAbove && !fitsBelow)) vertical = { top: above }
  else if (fitsBelow) vertical = { top: below }
  else if (roomAbove > roomBelow) vertical = { top: MARGIN, maxHeight: Math.max(0, roomAbove) }
  else vertical = { top: below, maxHeight: Math.max(0, roomBelow) }
  // 锚点自己已经滚出窗口（翻过的边也在窗口外）时没有「不压锚点」可言——把整块夹回窗口里，至少看得见（同旧版）。
  const shown = Math.min(size.height, vertical.maxHeight ?? size.height)
  vertical.top = Math.min(Math.max(MARGIN, vertical.top), Math.max(MARGIN, viewport.height - MARGIN - shown))

  let left = align === 'center'
    ? anchor.left + anchor.width / 2 - size.width / 2
    : align === 'end'
      ? anchor.right - size.width
      : anchor.left
  if (left + size.width > viewport.width - MARGIN) left = viewport.width - MARGIN - size.width
  left = Math.max(MARGIN, left)
  return { ...vertical, left }
}
