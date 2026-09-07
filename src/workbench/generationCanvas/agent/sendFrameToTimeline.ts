/**
 * 「整框进时间轴」——⋯ 菜单里那一项的实现。
 *
 * 它是个**薄适配器**，只做两件事：把框里的成员交给纯规划器排好序（`model/frameTimelinePlan`），
 * 再把结果交给采纳桥落轴（`adoption/adoptStoryboardBatch`）。中间不自己写轴——
 * 桥已经把「全算完才写」（不留半落的轴）和「一层撤销栈」（不是 N 次 Cmd+Z）处理掉了，
 * 这里再写一遍就是第二条写轴路径（P1 并行版）。
 *
 * 与分镜那条路的差别只在**顺序的真相**：分镜按 `shotIndex` 镜号（剧本时序），
 * 框按**摆放位置**（阅读序）——因为框里的东西没有镜号，用户是把它们摆成一段戏的。
 */
import { adoptStoryboardBatch, timelineEndFrame } from '../../adoption/adoptStoryboardBatch'
import type { BatchAdoptionResult } from '../../adoption/adoptStoryboardBatch'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { planFrameTimelineUnits, type FrameTimelineMember } from '../model/frameTimelinePlan'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'

export type SendFrameToTimelineResult =
  | { ok: false; reason: 'frame_not_found' | 'nothing_to_place' }
  | { ok: true; placed: number; skipped: number; outcome: BatchAdoptionResult }

/** 框里的成员 + 各自占的地方（排序要位置，所以在这里一次取全）。 */
export function readFrameTimelineMembers(groupId: string): FrameTimelineMember[] | null {
  const state = useGenerationCanvasStore.getState()
  const group = state.groups.find((candidate) => candidate.id === groupId)
  if (!group) return null
  return group.nodeIds.flatMap((nodeId) => {
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const size = resolveNodeVisualSize(node)
    return [{ node, rect: { x: node.position.x, y: node.position.y, width: size.width, height: size.height } }]
  })
}

/** 框里有没有一段能进时间轴的画面——菜单据此禁用那一项并说明原因（§1.6 C1）。 */
export function frameHasTimelineUnits(groupId: string): boolean {
  const members = readFrameTimelineMembers(groupId)
  return Boolean(members && planFrameTimelineUnits(members).units.length > 0)
}

export async function sendFrameToTimeline(groupId: string): Promise<SendFrameToTimelineResult> {
  const members = readFrameTimelineMembers(groupId)
  if (!members) return { ok: false, reason: 'frame_not_found' }
  const { units, skipped } = planFrameTimelineUnits(members)
  if (!units.length) return { ok: false, reason: 'nothing_to_place' }
  // 追加语义（与 Agent 的 arrange 一致）：整框排到轴的末尾，不覆盖用户已经排好的东西。
  const outcome = await adoptStoryboardBatch({
    units,
    skipped,
    startFrame: timelineEndFrame(useWorkbenchStore.getState().timeline),
    readNodes: () => useGenerationCanvasStore.getState().nodes,
  })
  const placed = outcome.status === 'applied' && !outcome.replayed ? outcome.proposal.placedCount : 0
  const skippedCount = outcome.status === 'nothing_to_adopt' ? outcome.skipped.length : skipped.length
  return { ok: true, placed, skipped: skippedCount, outcome }
}
