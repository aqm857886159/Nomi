import React from 'react'
import { resolveAnchoredPopoverPlacement } from '../../../design/anchoredPopoverPlacement'
import { shouldReduceMotion } from '../../../design/motion'
import { workspaceInputSurfaceIsActive } from '../../shortcutSurface'

export const PANEL_W = 320
const PANEL_GAP = 6

export type StaticParameterPanelInit = {
  left: number
  top: number
  maxHeight: number | undefined
  side: 'above' | 'below'
  /** 打开那一下先不可见地画一次、量出内容的本来高度，再定开向和限高（之后不再动）。 */
  measured: boolean
}

/**
 * 把一段滚进离它最近的可滚容器的可视区（最近对齐）：下沿在外就往下滚刚好够；段比可视区还高就让顶对齐。
 * 不用 `scrollIntoView`：它连 overflow-hidden 的祖先（画布卡、画布本身）一起滚。
 */
export function revealInScrollParent(el: HTMLElement): void {
  let scroller: HTMLElement | null = el.parentElement
  while (scroller) {
    const overflowY = getComputedStyle(scroller).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const box = el.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const viewTop = view.top + scroller.clientTop
  const viewBottom = viewTop + scroller.clientHeight
  if (box.bottom <= viewBottom + 0.5 && box.top >= viewTop - 0.5) return
  const delta =
    box.height > scroller.clientHeight
      ? box.top - viewTop
      : box.bottom > viewBottom
        ? box.bottom - viewBottom
        : box.top - viewTop
  const reduce = shouldReduceMotion()
  scroller.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}

/** 参数浮层的静止定位与点外 / Esc 收起控制（打开定位一次，绝不跟随）。 */
export function useStaticParameterPopover(): {
  panelOpen: boolean
  panelInit: StaticParameterPanelInit | null
  triggerRef: React.RefObject<HTMLButtonElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
  openPanel: () => void
  closePanel: () => void
} {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelInit, setPanelInit] = React.useState<StaticParameterPanelInit | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const openPanel = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
    const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
    setPanelInit({ left, top: 0, maxHeight: undefined, side: 'above', measured: false })
    setPanelOpen(true)
  }

  React.useLayoutEffect(() => {
    if (!panelOpen || !panelInit || panelInit.measured) return
    const trigger = triggerRef.current
    const scroller = panelRef.current?.firstElementChild as HTMLElement | null | undefined
    if (!trigger || !scroller) return
    const rect = trigger.getBoundingClientRect()
    const vh = window.innerHeight
    const work = trigger.closest('[data-shell-main]')?.getBoundingClientRect()
    const boundsTop = Math.max(0, work?.top ?? 0)
    const boundsBottom = Math.min(vh, work?.bottom ?? vh)
    const natural = scroller.scrollHeight + 2
    const placed = resolveAnchoredPopoverPlacement(
      rect,
      { width: PANEL_W, height: natural },
      'center',
      PANEL_GAP,
      { width: window.innerWidth, height: boundsBottom - boundsTop, top: boundsTop },
      'top',
    )
    const side: 'above' | 'below' = placed.top < rect.top ? 'above' : 'below'
    const room = side === 'above' ? rect.top - PANEL_GAP - boundsTop - 8 : boundsBottom - 8 - rect.bottom - PANEL_GAP
    setPanelInit({
      left: panelInit.left,
      top: side === 'above' ? vh - rect.top + PANEL_GAP : rect.bottom + PANEL_GAP,
      maxHeight: Math.max(0, room - 2),
      side,
      measured: true,
    })
  }, [panelOpen, panelInit])

  const closePanel = React.useCallback((): void => {
    setPanelOpen(false)
    setPanelInit(null)
  }, [])

  React.useEffect(() => {
    if (!panelOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!workspaceInputSurfaceIsActive(triggerRef.current)) return
      const target = event.target as Node
      if (!panelRef.current) return
      if (panelRef.current.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      closePanel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!workspaceInputSurfaceIsActive(triggerRef.current)) return
      if (event.key !== 'Escape') return
      if (
        event.target instanceof Element &&
        event.target.closest('[data-nomi-select-dropdown], [data-mantine-stop-propagation="true"]')
      ) {
        return
      }
      event.stopPropagation()
      closePanel()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [panelOpen, closePanel])

  return { panelOpen, panelInit, triggerRef, panelRef, openPanel, closePanel }
}
