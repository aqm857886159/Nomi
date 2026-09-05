import React from 'react'
import { ENSURE_COMPOSER_VISIBLE_EVENT } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { ViewportAnimationSettlementOutcome } from './viewportAnimationSettlement'

export type EnsureComposerVisibleEventDetail = {
  /** 发请求的节点。节点已不在画布上的请求（撤销刚删掉它）没有意义，必须丢掉。 */
  nodeId?: unknown
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

const hasCanvasNode = (nodeId: string): boolean => useGenerationCanvasStore.getState().nodes.some((node) => node.id === nodeId)

/** 这条让位请求还该不该执行：deltaY 必须是有限非零数；带了 nodeId 的，节点必须还在画布上。 */
export function shouldHonourComposerPanRequest(
  detail: EnsureComposerVisibleEventDetail | undefined,
  hasNode: (nodeId: string) => boolean,
): detail is EnsureComposerVisibleEventDetail & { deltaY: number } {
  const rawDelta = detail?.deltaY
  if (typeof rawDelta !== 'number' || !Number.isFinite(rawDelta) || rawDelta === 0) return false
  if (typeof detail?.nodeId === 'string' && !hasNode(detail.nodeId)) return false
  return true
}

export function useComposerVisibilityPan(input: {
  animateViewportTo: (
    zoom: number,
    offset: Offset,
    duration?: number,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => void
  /** React Flow 此刻的真实视口（不是随渲染更新的 ref：撤销那一帧的直写还没渲染出来，ref 是旧的）。 */
  readLiveViewport: () => { zoom: number; offset: Offset }
  readViewportTarget: () => { zoom: number; offset: Offset }
  /** 节点是否仍在画布上；默认查画布 store。 */
  hasNode?: (nodeId: string) => boolean
}): void {
  const { animateViewportTo, readLiveViewport, readViewportTarget, hasNode = hasCanvasNode } = input
  React.useEffect(() => {
    const ensureVisible = (event: Event) => {
      const detail = (event as CustomEvent<EnsureComposerVisibleEventDetail>).detail
      if (!shouldHonourComposerPanRequest(detail, hasNode)) {
        // 节点已经没了（撤销刚删掉它）：不动视口，但要把请求闩放掉。
        if (detail?.onSettled && typeof detail.nodeId === 'string' && !hasNode(detail.nodeId)) detail.onSettled('cancelled')
        return
      }
      const target = composeComposerPanTarget({ current: readLiveViewport().offset, pending: readViewportTarget(), deltaY: detail.deltaY })
      animateViewportTo(target.zoom, target.offset, 160, detail.onSettled)
    }
    window.addEventListener(ENSURE_COMPOSER_VISIBLE_EVENT, ensureVisible)
    return () => window.removeEventListener(ENSURE_COMPOSER_VISIBLE_EVENT, ensureVisible)
  }, [animateViewportTo, hasNode, readLiveViewport, readViewportTarget])
}
