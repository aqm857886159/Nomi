/**
 * `AnchoredPopover` 的**全部几何**。抽成不含 React 的一文件，理由有两条：
 *   · 这一族的失败长得不像失败——浮层放歪了不抛错、不消失，只被裁掉一角或顶出视口，
 *     DOM 断言全绿而人看不见。所以几何必须是一个能被逐例钉死的纯函数
 *     （见 anchoredPopoverPlacement.test.ts）。
 *   · 组件文件同时导出组件与非组件会破坏 Fast Refresh（react-refresh 那条 lint 警告说的就是它）。
 */

export type AnchoredPopoverAlign = 'start' | 'center' | 'end'

const MARGIN = 8

type Placement = { top: number; left: number }

export function resolveAnchoredPopoverPlacement(
  anchor: DOMRect,
  size: { width: number; height: number },
  align: AnchoredPopoverAlign,
  gap: number,
  viewport: { width: number; height: number },
): Placement {
  // 下方放不下就往上翻；上方也放不下就顶到视口上边（宁可盖住锚点，也不许被切）。
  let top = anchor.bottom + gap
  if (top + size.height > viewport.height - MARGIN) {
    top = Math.max(MARGIN, anchor.top - gap - size.height)
  }
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
