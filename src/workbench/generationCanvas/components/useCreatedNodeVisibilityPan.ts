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

type Viewport = { zoom: number; offset: Offset }
export type CreatedNodeRevealRecord = { id: string; before: Viewport }

const RESTORE_TOLERANCE_PX = 2

/**
 * 露出过的那张卡被撤销/删除后，视口该不该回到露出前的位置？
 * 只在「视口还停在最近一次自动让位的落点上」时回去：用户手动平移/缩放不经过自动让位入口，
 * 所以视口一旦偏离那个落点，就说明用户此后自己动过画布，别抢。
 * （露出之后 composer 还会再让位一次，所以比较对象是「最近一次自动落点」而不是露出自己的落点。）
 */
export function shouldRestoreAfterReveal(
  record: CreatedNodeRevealRecord | null,
  currentIds: ReadonlySet<string>,
  live: Viewport,
  lastAutoTarget: Viewport | null,
): boolean {
  if (!record || currentIds.has(record.id) || !lastAutoTarget) return false
  return (
    Math.abs(live.offset.x - lastAutoTarget.offset.x) <= RESTORE_TOLERANCE_PX
    && Math.abs(live.offset.y - lastAutoTarget.offset.y) <= RESTORE_TOLERANCE_PX
    && Math.abs(live.zoom - lastAutoTarget.zoom) < 1e-3
  )
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
  /** 视口「正在去的目标」（没有动画在跑就是当前视口）：增量从它出发算，才不会抹掉同时在飞的 composer 让位。 */
  readViewportTarget: () => { zoom: number; offset: Offset }
  /** 最近一次自动让位登记的目标；用于判断撤销时用户有没有自己动过画布。 */
  readLastAutoTarget: () => { zoom: number; offset: Offset } | null
  stageRef: React.RefObject<HTMLDivElement | null>
}): void {
  const { nodes, animateViewportTo, readViewportTarget, readLastAutoTarget, stageRef } = input
  const knownIdsRef = React.useRef<ReadonlySet<string> | null>(null)
  // 待执行的露出：跨渲染保活。建卡后 store 会在几十毫秒内再改一次 nodes（量到尺寸后回写 size、
  // 选中态等），如果把定时器挂在 effect 的 cleanup 上，那一次重渲染就把露出取消了——
  // 视口纹丝不动，新卡照样卡在常驻 Agent 面板底下（2026-09-05 真机探针：video 卡 x 越界 200+px，视口 x 恒 0）。
  const pendingRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // 最近一次露出的「出发点 / 落点」：那张卡被撤销时，视口若还停在落点上就回到出发点（撤销应对称）。
  const lastRevealRef = React.useRef<CreatedNodeRevealRecord | null>(null)

  React.useEffect(() => {
    const currentIds = new Set(nodes.map((node) => node.id))
    const known = knownIdsRef.current
    knownIdsRef.current = currentIds
    if (!known) return // 首帧只登记，不动视口（首屏归 useAutoFitOnLoad）
    const lastReveal = lastRevealRef.current
    if (lastReveal && !currentIds.has(lastReveal.id)) {
      lastRevealRef.current = null
      if (shouldRestoreAfterReveal(lastReveal, currentIds, readViewportTarget(), readLastAutoTarget())) {
        animateViewportTo(lastReveal.before.zoom, lastReveal.before.offset, 200)
      }
    }
    const added = nodes.filter((node) => !known.has(node.id))
    if (added.length !== 1) return
    const created = added[0]
    if (pendingRef.current !== null) clearTimeout(pendingRef.current)
    // 等 React Flow 把新卡量好一帧再算几何，否则读到的是上一帧的 offset。
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const target = readViewportTarget()
      const delta = revealPanDelta(created, target.zoom, target.offset, rect.width, rect.height)
      if (!delta) return
      lastRevealRef.current = { id: created.id, before: { zoom: target.zoom || 1, offset: { ...target.offset } } }
      animateViewportTo(target.zoom || 1, { x: target.offset.x + delta.x, y: target.offset.y + delta.y }, 200)
    }, 60)
  }, [nodes, animateViewportTo, readViewportTarget, readLastAutoTarget, stageRef])

  // 只有卸载才作废待执行的露出；nodes 的后续变化不许取消它。
  React.useEffect(
    () => () => {
      if (pendingRef.current !== null) clearTimeout(pendingRef.current)
      pendingRef.current = null
    },
    [],
  )
}
