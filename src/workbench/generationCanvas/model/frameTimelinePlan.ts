/**
 * 「整框进时间轴」的**排片规划**（纯函数：同输入必同输出，不碰 store / DOM）。
 *
 * 与分镜那条路（`agent/storyboardTimelinePlan.ts` 按 `shotIndex` 镜序）**故意不同**：
 * 框里的东西没有镜号——用户是把它们**摆**成一段戏的，所以顺序的真相就是**摆放位置**，
 * 按人读画布的方式来：**从左到右、从上到下**（阅读序）。
 *
 * 只收**视频 / 剪辑**节点。图和文字不进——它们在框里的角色是参考与说明，
 * 不是这一段片子的画面；把它们也排进去会让用户每次都要在轴上删掉一堆。
 *
 * 落轴本身不归这里：本模块只回答「排哪些、什么顺序」，怎么写轴归采纳桥
 * （`adoption/adoptStoryboardBatch`，整批一次落定、一层撤销栈）。
 */
import type { GenerationCanvasNode } from './generationCanvasTypes'
import { getGenerationNodeExecutionKind } from './generationNodeKinds'

export type FrameTimelineMember = {
  node: GenerationCanvasNode
  rect: { x: number; y: number; width: number; height: number }
}

export type FrameTimelineUnit = {
  nodeId: string
  /** 采纳桥要一个排序键；这里给的是阅读序的名次（0,1,2…），不是镜号。 */
  shotIndex: number
  role: 'video'
}

export type FrameTimelinePlan = {
  units: FrameTimelineUnit[]
  skipped: Array<{ nodeId: string; reason: FrameTimelineSkipReason }>
}

export type FrameTimelineSkipReason = 'not_moving_image' | 'no_result'

/** 「这东西是一段画面吗」——视频执行种类，或剪辑节点（剪辑没有 executionKind，是合成产物）。 */
export function isFrameTimelineEligibleKind(node: GenerationCanvasNode): boolean {
  return node.kind === 'clip' || getGenerationNodeExecutionKind(node.kind) === 'video'
}

function hasUsableResult(node: GenerationCanvasNode): boolean {
  return typeof node.result?.url === 'string' && node.result.url.trim().length > 0
}

/**
 * 行带宽度：按成员高度的**中位数的一半**派生。
 *
 * 不写死一个像素数的理由很实在——同一个框里可能全是 132 高的剪辑条，也可能全是 400 高的视频卡；
 * 一个固定阈值在前者会把两行并成一行，在后者会把一行拆成两行。中位数的一半意味着
 * 「上下错开超过半张卡才算换行」，对两种尺寸都说得通。
 */
export function frameRowTolerance(members: readonly FrameTimelineMember[]): number {
  if (!members.length) return 0
  const heights = members.map((member) => member.rect.height).filter((height) => Number.isFinite(height) && height > 0).sort((a, b) => a - b)
  if (!heights.length) return 0
  const middle = Math.floor(heights.length / 2)
  const median = heights.length % 2 === 0 ? (heights[middle - 1] + heights[middle]) / 2 : heights[middle]
  return median / 2
}

/**
 * 阅读序：先按顶边分行（同一行 = 顶边差在行带内），行内按左边缘从左到右。
 * 行与行之间按该行最小顶边排。同坐标的并列项用 nodeId 兜底，保证同输入必同输出。
 */
export function orderFrameMembersForReading(members: readonly FrameTimelineMember[]): FrameTimelineMember[] {
  const tolerance = frameRowTolerance(members)
  const byTop = [...members].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.node.id.localeCompare(b.node.id))
  const rows: FrameTimelineMember[][] = []
  for (const member of byTop) {
    const currentRow = rows[rows.length - 1]
    const rowTop = currentRow?.[0]?.rect.y
    if (currentRow && typeof rowTop === 'number' && member.rect.y - rowTop <= tolerance) currentRow.push(member)
    else rows.push([member])
  }
  return rows.flatMap((row) =>
    [...row].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.node.id.localeCompare(b.node.id)),
  )
}

export function planFrameTimelineUnits(members: readonly FrameTimelineMember[]): FrameTimelinePlan {
  const units: FrameTimelineUnit[] = []
  const skipped: FrameTimelinePlan['skipped'] = []
  for (const member of orderFrameMembersForReading(members)) {
    if (!isFrameTimelineEligibleKind(member.node)) {
      skipped.push({ nodeId: member.node.id, reason: 'not_moving_image' })
      continue
    }
    if (!hasUsableResult(member.node)) {
      skipped.push({ nodeId: member.node.id, reason: 'no_result' })
      continue
    }
    units.push({ nodeId: member.node.id, shotIndex: units.length, role: 'video' })
  }
  return { units, skipped }
}
