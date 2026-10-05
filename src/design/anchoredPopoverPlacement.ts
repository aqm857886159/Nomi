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

type Placement = { top: number; left: number }

export function resolveAnchoredPopoverPlacement(
  anchor: DOMRect,
  size: { width: number; height: number },
  align: AnchoredPopoverAlign,
  gap: number,
  viewport: { width: number; height: number },
  side: AnchoredPopoverSide = 'bottom',
): Placement {
  // 先放偏好的那一边；放不下就翻到另一边；两边都放不下就夹进视口（宁可盖住锚点，也不许被切）。
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.height
  const fitsBelow = below + size.height <= viewport.height - MARGIN
  const fitsAbove = above >= MARGIN
  let top = side === 'top'
    ? (fitsAbove || !fitsBelow ? Math.max(MARGIN, above) : below)
    : (fitsBelow ? below : Math.max(MARGIN, above))
  top = Math.min(top, Math.max(MARGIN, viewport.height - MARGIN - size.height))

  let left = align === 'center'
    ? anchor.left + anchor.width / 2 - size.width / 2
    : align === 'end'
      ? anchor.right - size.width
      : anchor.left
  if (left + size.width > viewport.width - MARGIN) left = viewport.width - MARGIN - size.width
  left = Math.max(MARGIN, left)
  return { top, left }
}
