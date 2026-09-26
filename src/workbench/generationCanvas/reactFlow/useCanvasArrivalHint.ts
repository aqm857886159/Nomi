import React from 'react'
import { getViewportForBounds } from '@xyflow/react'
import { useWorkbenchStore } from '../../workbenchStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getUndoJournalGeneration } from '../events/canvasUndoJournal'
import { arrivalBounds, nextUnseenArrivals, resolveArrivalHint, type ArrivalHint } from '../components/canvasArrivalModel'
import { CANVAS_MIN_ZOOM } from '../model/canvasFitBounds'

type FlowViewport = { x: number; y: number; zoom: number }

/**
 * 画布边缘提示的宿主状态（纯逻辑在 components/canvasArrivalModel.ts）。
 *
 * 基线：「打开的是哪一张画布」用撤销日志的 generation 判（`getUndoJournalGeneration`：只在打开 / 切换 /
 * 清空画布时变）。它一变就重新登记全部节点当基线——打开项目时恢复出来的几十张卡不是「新到的」。
 *
 * 点提示 = 用户要它动：先切到那个分类（若不在），再用定位动画把那一批框进屏里；缩放不放大（只在装不下时缩小）。
 * 这是这个画布上仅有的几条「程序移动视口」之一，且只由这一次点击触发。
 */
export function useCanvasArrivalHint(input: {
  ready: boolean
  allNodes: readonly GenerationCanvasNode[]
  activeCategoryId: string
  liveViewport: FlowViewport
  stageSize: { width: number; height: number }
  animateViewportTo: (zoom: number, offset: { x: number; y: number }, duration?: number) => void
}): { hint: ArrivalHint | null; goToArrivals: () => void } {
  const { ready, allNodes, activeCategoryId, liveViewport, stageSize, animateViewportTo } = input
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const baselineRef = React.useRef<{ generation: number; ids: Set<string> } | null>(null)
  const [unseen, setUnseen] = React.useState<string[]>([])
  const unseenRef = React.useRef(unseen)
  unseenRef.current = unseen
  const visible = React.useMemo(() => (
    stageSize.width > 0 && stageSize.height > 0 && liveViewport.zoom > 0
      ? { x: -liveViewport.x / liveViewport.zoom, y: -liveViewport.y / liveViewport.zoom, width: stageSize.width / liveViewport.zoom, height: stageSize.height / liveViewport.zoom }
      : null
  ), [liveViewport.x, liveViewport.y, liveViewport.zoom, stageSize.height, stageSize.width])

  React.useEffect(() => {
    if (!ready) {
      baselineRef.current = null
      setUnseen((previous) => (previous.length ? [] : previous))
      return
    }
    const generation = getUndoJournalGeneration()
    const baseline = baselineRef.current && baselineRef.current.generation === generation ? baselineRef.current.ids : null
    const next = nextUnseenArrivals({ previousIds: baseline, unseen: baseline ? unseenRef.current : [], nodes: allNodes, activeCategoryId, visible })
    baselineRef.current = { generation, ids: new Set(allNodes.map((node) => node.id)) }
    setUnseen((previous) => (previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next))
  }, [activeCategoryId, allNodes, ready, visible])

  const hint = React.useMemo(
    () => resolveArrivalHint({ unseen, nodes: allNodes, activeCategoryId, visible }),
    [activeCategoryId, allNodes, unseen, visible],
  )

  // 点提示时若要先切分类：等切过去（那个分类记住的视口已由画布同步写好）再动画过去。
  const pendingGoRef = React.useRef<{ categoryId: string; nodeIds: string[] } | null>(null)
  const animateToArrivals = React.useCallback((nodeIds: readonly string[]) => {
    const bounds = arrivalBounds(nodeIds, allNodes)
    if (!bounds || !(stageSize.width > 0 && stageSize.height > 0)) return
    const maxZoom = Math.max(CANVAS_MIN_ZOOM, liveViewport.zoom || 1)
    const next = getViewportForBounds(bounds, stageSize.width, stageSize.height, CANVAS_MIN_ZOOM, maxZoom, 0.2)
    if (![next.x, next.y, next.zoom].every(Number.isFinite)) return
    animateViewportTo(next.zoom, { x: next.x, y: next.y }, 220)
  }, [allNodes, animateViewportTo, liveViewport.zoom, stageSize.height, stageSize.width])

  React.useEffect(() => {
    const pending = pendingGoRef.current
    if (!pending || pending.categoryId !== activeCategoryId) return
    pendingGoRef.current = null
    animateToArrivals(pending.nodeIds)
  }, [activeCategoryId, animateToArrivals])

  const goToArrivals = React.useCallback(() => {
    if (!hint) return
    if (hint.categoryId !== activeCategoryId) {
      pendingGoRef.current = { categoryId: hint.categoryId, nodeIds: hint.nodeIds }
      setActiveCategoryId(hint.categoryId)
      return
    }
    animateToArrivals(hint.nodeIds)
  }, [activeCategoryId, animateToArrivals, hint, setActiveCategoryId])

  return { hint, goToArrivals }
}
