import React from 'react'
import { ENSURE_COMPOSER_VISIBLE_EVENT } from '../nodes/nodeSizing'
import type { ViewportAnimationSettlementOutcome } from './viewportAnimationSettlement'

export type EnsureComposerVisibleEventDetail = {
  deltaY?: unknown
  onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void
}

type Offset = { x: number; y: number }

/**
 * composer 让位的目标 = 正在去的目标（x、zoom 照旧）+ 按**当前**几何量出来的纵向增量。
 * deltaY 是节点在当前位置量的（「还差多少才装得下」），所以 y 用当前 + delta；
 * x 与 zoom 取正在去的目标，别把同时在飞的横向露出（新建节点被 Agent 面板挡住）抹掉。
 */
export function composeComposerPanTarget(input: {
  current: Offset
  pending: { zoom: number; offset: Offset }
  deltaY: number
}): { zoom: number; offset: Offset } {
  return {
    zoom: input.pending.zoom,
    offset: { x: input.pending.offset.x, y: input.current.y + input.deltaY },
  }
}

export function useComposerVisibilityPan(input: {
  animateViewportTo: (
    zoom: number,
    offset: Offset,
    duration?: number,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => void
  offsetRef: React.MutableRefObject<Offset>
  readViewportTarget: () => { zoom: number; offset: Offset }
}): void {
  const { animateViewportTo, offsetRef, readViewportTarget } = input
  React.useEffect(() => {
    const ensureVisible = (event: Event) => {
      const detail = (event as CustomEvent<EnsureComposerVisibleEventDetail>).detail
      const rawDelta = detail?.deltaY
      if (typeof rawDelta !== 'number' || !Number.isFinite(rawDelta) || rawDelta === 0) return
      const target = composeComposerPanTarget({ current: offsetRef.current, pending: readViewportTarget(), deltaY: rawDelta })
      animateViewportTo(target.zoom, target.offset, 160, detail?.onSettled)
    }
    window.addEventListener(ENSURE_COMPOSER_VISIBLE_EVENT, ensureVisible)
    return () => window.removeEventListener(ENSURE_COMPOSER_VISIBLE_EVENT, ensureVisible)
  }, [animateViewportTo, offsetRef, readViewportTarget])
}
