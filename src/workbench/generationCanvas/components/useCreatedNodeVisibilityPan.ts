import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getCanvasNodeVisualSize } from './generationCanvasGeometry'
import type { ViewportAnimationSettlementOutcome } from './viewportAnimationSettlement'

type Offset = { x: number; y: number }

/** 视口边缘留白：贴着边显示等于「半张卡」，用户仍会以为它没出来。 */
export const REVEAL_MARGIN_PX = 24

/**
 * 刚建出的节点要露出来需要的最小视口位移（画布屏幕坐标，加到 offset 上）。
 * 已经完整可见 → null（不打扰用户视口）。
 *
 * **为什么需要它**：`store.addNode` 的环形避让只保证「新卡不压住已有卡」——它按画布坐标找空位，
 * 压根不知道视口有多大。stage 一变窄（常驻 Agent 面板占掉右侧、小窗口、侧栏展开），被推开的落点
 * 就会落到可视区之外；React Flow 又开着 `onlyRenderVisibleElements`，那张卡连 DOM 都不进——
 * 用户看到的是「点了新建，什么都没发生」。视口归 React Flow 层管（store 不该知道视口），
 * 所以补偿放在这一层，且对所有建卡入口一次生效。
 *
 * 卡比视口还大时不硬塞：把它的左上角对齐到留白处，用户至少看得到它从哪儿开始。
 */
export function revealPanDelta(
  node: GenerationCanvasNode,
  zoom: number,
  offset: Offset,
  rectWidth: number,
  rectHeight: number,
  margin = REVEAL_MARGIN_PX,
): Offset | null {
  if (!(rectWidth > 0) || !(rectHeight > 0)) return null
  const z = zoom || 1
  const { width, height } = getCanvasNodeVisualSize(node)
  const left = node.position.x * z + offset.x
  const top = node.position.y * z + offset.y
  const right = (node.position.x + width) * z + offset.x
  const bottom = (node.position.y + height) * z + offset.y

  const axis = (near: number, far: number, extent: number): number => {
    // 比视口还长 → 只保证起点可见（对齐左/上留白），不来回抖。
    if (far - near > extent - margin * 2) return margin - near
    if (near < margin) return margin - near
    if (far > extent - margin) return extent - margin - far
    return 0
  }

  const dx = axis(left, right, rectWidth)
  const dy = axis(top, bottom, rectHeight)
  if (dx === 0 && dy === 0) return null
  return { x: dx, y: dy }
}

/**
 * 「新建即可见」不变量：交互式建出的那张卡，建完必须在视口里。
 *
 * 只认「单张新增」——项目加载、批量落节点、切分类都是多张一起进来，那些由
 * [[useAutoFitOnLoad]] / `canvasFitNonce` 负责，这里不抢视口（P1：不另造一套 fit）。
 */
export function useCreatedNodeVisibilityPan(input: {
  nodes: readonly GenerationCanvasNode[]
  animateViewportTo: (
    zoom: number,
    offset: Offset,
    duration?: number,
    onSettled?: (outcome: ViewportAnimationSettlementOutcome) => void,
  ) => void
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  stageRef: React.RefObject<HTMLDivElement | null>
}): void {
  const { nodes, animateViewportTo, offsetRef, zoomRef, stageRef } = input
  const knownIdsRef = React.useRef<ReadonlySet<string> | null>(null)

  React.useEffect(() => {
    const currentIds = new Set(nodes.map((node) => node.id))
    const known = knownIdsRef.current
    knownIdsRef.current = currentIds
    if (!known) return // 首帧只登记，不动视口（首屏归 useAutoFitOnLoad）
    const added = nodes.filter((node) => !known.has(node.id))
    if (added.length !== 1) return
    const created = added[0]
    // 等 React Flow 把新卡量好一帧再算几何，否则读到的是上一帧的 offset。
    const tid = setTimeout(() => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const delta = revealPanDelta(created, zoomRef.current, offsetRef.current, rect.width, rect.height)
      if (!delta) return
      const offset = offsetRef.current
      animateViewportTo(zoomRef.current || 1, { x: offset.x + delta.x, y: offset.y + delta.y }, 200)
    }, 60)
    return () => clearTimeout(tid)
  }, [nodes, animateViewportTo, offsetRef, zoomRef, stageRef])
}
