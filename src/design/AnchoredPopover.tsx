import React from 'react'
import { createPortal } from 'react-dom'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

/**
 * 锚点浮层：Portal 到 body + fixed 贴锚点，**逃出祖先 overflow 的裁切**。全站唯一一套浮层定位机制。
 *
 * 为什么必须 Portal 而不是在原地写 absolute：只要浮层与它的定位祖先之间夹着一个
 * `overflow: hidden`（时间轴的轨道格、composer 卡、属性面板的分组…），浮层就会被裁成一条边。
 * 这一族最阴的地方在于**三样常用证据全都看不出来**：
 *   · DOM 里在（count>0、toBeVisible 都绿）；
 *   · getBoundingClientRect 照样报完整尺寸——**裁切不改 rect**；
 *   · Playwright 的 click 会先 scrollIntoViewIfNeeded 把那个容器滚一下再点，所以脚本点得动。
 * 唯独真人看不见、也点不到。2026-09-06 的转场选择器就是这么绿了一整轮走查
 * （49 个采样点只有 7 个命中，8 颗按钮里 7 颗 elementFromPoint 落到别的轨道上）。
 *
 * 判据别再用 rect，用 `tests/ux/_assert.mjs` 的 measureOverlayReach / expectOverlayReachable。
 *
 * P1：新增浮层一律用它，不要再各写各的 absolute，也不要引第三套定位库。
 */

const MARGIN = 8

export type AnchoredPopoverAlign = 'start' | 'center' | 'end'

export type AnchoredPopoverProps = {
  /** 贴谁。不给就贴「浮层原本在流里的那个位置」（组件会就地留一个 0 尺寸锚点）。 */
  anchorRef?: React.RefObject<HTMLElement | null>
  /** 相对锚点的横向对齐。 */
  align?: AnchoredPopoverAlign
  /** 锚点与浮层之间的缝。 */
  gap?: number
  /** 层级。默认走 overlayLayers 的 popover 档；调用方要压低（例如让位给更高的模态）才传。 */
  zIndex?: number
  /** 传了就接管「点外面 / Esc 关闭」。不传则由调用方自己管开合。 */
  onClose?: () => void
  children: React.ReactNode
}

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

export function AnchoredPopover({
  anchorRef,
  align = 'start',
  gap = 4,
  zIndex,
  onClose,
  children,
}: AnchoredPopoverProps): JSX.Element {
  const fallbackAnchorRef = React.useRef<HTMLSpanElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState<Placement | null>(null)

  const reposition = React.useCallback(() => {
    const anchor = anchorRef?.current ?? fallbackAnchorRef.current
    const pop = popRef.current
    if (!anchor || !anchor.isConnected) return
    setPlacement(resolveAnchoredPopoverPlacement(
      anchor.getBoundingClientRect(),
      { width: pop?.offsetWidth || 300, height: pop?.offsetHeight || 360 },
      align,
      gap,
      { width: window.innerWidth, height: window.innerHeight },
    ))
  }, [align, anchorRef, gap])

  // 两段式：先按估计尺寸放一次，渲染后按实测尺寸修正（修正前 visibility:hidden，不闪）。
  React.useLayoutEffect(reposition, [reposition])

  // 锚点会动：时间轴横向滚动、面板拖宽、窗口缩放。跟着重算，别让浮层停在原地指着空气。
  // 浮层自己也会变高（转场选择器换成「硬切」就少一行时长）——向上翻转时高度是位置的输入，
  // 不跟着重算就会把长高的那一截顶出视口，于是又变回「露不全」。
  React.useEffect(() => {
    const onMove = () => reposition()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onMove)
    if (observer && popRef.current) observer.observe(popRef.current)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      observer?.disconnect()
    }
  }, [reposition])

  React.useEffect(() => {
    if (!onClose) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node
      const anchor = anchorRef?.current ?? fallbackAnchorRef.current
      if (popRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [anchorRef, onClose])

  const layer = (
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: placement?.top ?? -9999,
        left: placement?.left ?? -9999,
        zIndex: zIndex ?? NOMI_OVERLAY_Z_INDEX.popover,
        visibility: placement ? 'visible' : 'hidden',
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )

  return (
    <>
      {/* 0 尺寸锚点：不给 anchorRef 时用它代表「浮层原本该待的位置」。 */}
      {anchorRef ? null : <span ref={fallbackAnchorRef} className="inline-block h-0 w-0 align-bottom" aria-hidden="true" />}
      {typeof document === 'undefined' ? layer : createPortal(layer, document.body)}
    </>
  )
}
