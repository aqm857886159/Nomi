/**
 * 「拖进 = 入组，拖出 = 退组」——这一档要修的那条 bug 的实现处。
 *
 * 实拍里的现状（tests/ux/shots/group-frame-now/README.md 的 e、e2）：把成员拖到框外松手，
 * 框会**追着长大把它重新包住**，成员没退组，拖动过程中也没有任何提示。用户的动作是
 * 「把这张图移出这一组」，画布的回应是「我把这一组变大了」——两件相反的事。
 *
 * 修法两半，缺一不可：
 *  · **拖动中就给反馈**（进框亮 accent、计数写成 `2 → 3`；出框变虚线、`3 → 2`）——
 *    松手之前用户就知道会发生什么，不必先试一次再撤销；
 *  · **松手才生效**：走既有的 `moveNodeToGroup` / `removeNodeFromGroup`，
 *    组入参补边/撤边、undo 一层这些语义原样复用（model/groupInputLinks），不另写一套。
 *
 * 判定归 `canvasPointerGestureModel`（中心点 + 三态真值表），本文件只负责
 * 「拖的是谁、当下算出什么、松手时提交」。
 *
 * 节点矩形**不在这里算**：由调用方注入 `getNodeRect`，它读的是 React Flow 内核测量过的
 * `positionAbsolute` + `measured`（见 reactFlow/canvasMeasuredNodeRect.ts 的头注释）。
 * 2026-09-07 R29 §6.1 之前这里自己 `state.nodes.find` + 声明尺寸算一份，判定线与用户
 * 看到的边会分叉；顺带每帧对每个拖动节点做一次线性扫，画布性能战役刚压下去的那条路。
 */
import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  frameContainsNodeCenter,
  resolveCanvasFrameMembership,
  type CanvasFrameMembershipChange,
} from './canvasPointerGestureModel'
import type { CanvasFrameInteraction, CanvasGroupBox } from './GroupFrame'

/** 「这个节点此刻在屏幕上占的那个矩形」——内核测量值，量不到返回 null。 */
export type CanvasNodeRectProbe = (nodeId: string) => { x: number; y: number; width: number; height: number } | null

type MembershipPlan = {
  groupId: string
  change: Exclude<CanvasFrameMembershipChange, 'none'>
  nodeIds: string[]
  nextCount: number
}

type UseCanvasFrameMembershipArgs = {
  readOnly: boolean
  frameBoxes: readonly CanvasGroupBox[]
  getNodeRect: CanvasNodeRectProbe
}

export type CanvasFrameMembershipDrag = {
  membershipPreview: CanvasFrameInteraction['membershipPreview']
  /** React Flow 的 onNodeDrag：逐帧算「松手会发生什么」，只写本地预览状态、不碰 store。 */
  handleNodeDrag: (draggedNodes: readonly { id: string }[]) => void
  /** 拖动结束：把预览里的那件事真的做掉。必须在位置写回之后调用。 */
  commitMembership: () => void
  cancelPreview: () => void
}

/**
 * 一次拖动可能同时动好几个节点。归属变更按**目标框**归并：一个节点只属一个框，
 * 所以最多只有一个框需要亮起来——挑变更数最多的那个当预览主角，计数把这一批一起算进去。
 */
export function planCanvasFrameMembership(
  draggedNodeIds: readonly string[],
  frameBoxes: readonly CanvasGroupBox[],
  getNodeRect: CanvasNodeRectProbe,
): MembershipPlan | null {
  const joinsByGroup = new Map<string, string[]>()
  const leavesByGroup = new Map<string, string[]>()

  for (const nodeId of draggedNodeIds) {
    // 矩形取内核测量值：位置是拖动中的实时绝对坐标，尺寸是真渲染出来的宽高。
    // 还没量到（刚挂载/被剔除）就跳过——宁可这一帧不判，也不拿声明尺寸凑一个假的。
    const rect = getNodeRect(nodeId)
    if (!rect) continue
    for (const box of frameBoxes) {
      const change = resolveCanvasFrameMembership({
        inside: frameContainsNodeCenter({ x: box.left, y: box.top, w: box.width, h: box.height }, rect),
        isMember: box.group.nodeIds.includes(nodeId),
      })
      if (change === 'join') joinsByGroup.set(box.group.id, [...(joinsByGroup.get(box.group.id) ?? []), nodeId])
      else if (change === 'leave') leavesByGroup.set(box.group.id, [...(leavesByGroup.get(box.group.id) ?? []), nodeId])
    }
  }

  const candidates: MembershipPlan[] = []
  for (const box of frameBoxes) {
    const joins = joinsByGroup.get(box.group.id) ?? []
    const leaves = leavesByGroup.get(box.group.id) ?? []
    if (joins.length) {
      candidates.push({ groupId: box.group.id, change: 'join', nodeIds: joins, nextCount: box.memberCount + joins.length })
    } else if (leaves.length) {
      candidates.push({
        groupId: box.group.id,
        change: 'leave',
        nodeIds: leaves,
        nextCount: Math.max(0, box.memberCount - leaves.length),
      })
    }
  }
  if (!candidates.length) return null
  // 「进」优先于「出」：一次拖动最多改投一个框，而改投的用户意图是「进到新的那个」，
  // 旧框的退出是它的副作用（moveNodeToGroup 自己会把人从旧组抢走）。
  const joined = candidates.find((candidate) => candidate.change === 'join')
  return joined ?? candidates[0]
}

export function useCanvasFrameMembership({
  readOnly,
  frameBoxes,
  getNodeRect,
}: UseCanvasFrameMembershipArgs): CanvasFrameMembershipDrag {
  const [membershipPreview, setMembershipPreview] = React.useState<CanvasFrameInteraction['membershipPreview']>(null)
  const planRef = React.useRef<MembershipPlan | null>(null)
  const frameBoxesRef = React.useRef(frameBoxes)
  frameBoxesRef.current = frameBoxes
  const getNodeRectRef = React.useRef(getNodeRect)
  getNodeRectRef.current = getNodeRect

  const handleNodeDrag = React.useCallback((
    draggedNodes: readonly { id: string }[],
  ) => {
    if (readOnly) return
    const plan = planCanvasFrameMembership(
      draggedNodes.map((dragged) => dragged.id),
      frameBoxesRef.current,
      getNodeRectRef.current,
    )
    planRef.current = plan
    setMembershipPreview((current) => {
      if (!plan) return current === null ? current : null
      if (current && current.groupId === plan.groupId && current.change === plan.change && current.nextCount === plan.nextCount) {
        return current
      }
      return { groupId: plan.groupId, change: plan.change, nextCount: plan.nextCount }
    })
  }, [readOnly])

  const cancelPreview = React.useCallback(() => {
    planRef.current = null
    setMembershipPreview(null)
  }, [])

  const commitMembership = React.useCallback(() => {
    const plan = planRef.current
    planRef.current = null
    setMembershipPreview(null)
    if (readOnly || !plan) return
    const state = useGenerationCanvasStore.getState()
    for (const nodeId of plan.nodeIds) {
      if (plan.change === 'join') state.moveNodeToGroup(nodeId, plan.groupId)
      else state.removeNodeFromGroup(nodeId)
    }
  }, [readOnly])

  return { membershipPreview, handleNodeDrag, commitMembership, cancelPreview }
}
