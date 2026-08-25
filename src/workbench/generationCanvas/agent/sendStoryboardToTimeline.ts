import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { planStoryboardTimeline, type StoryboardTimelineUnitRole } from './storyboardTimelinePlan'
import { adoptStoryboardBatch, timelineEndFrame } from '../../adoption/adoptStoryboardBatch'
import type { BatchAdoptionResult } from '../../adoption/adoptStoryboardBatch'

// 纯规划辅助函数保持原模块导出，旧单测与调用方继续复用同一份实现；写轴本身已汇流到桥。
export { partitionUnitsByTimelinePresence, storyboardCaptionText } from '../../adoption/adoptStoryboardBatch'

/**
 * 「整批按分镜顺序排进时间轴」的两个入口（手动「发送选中」/ Agent `arrange`）。
 *
 * P5 E1 起这里**不再自己逐个写轴**——原 `placeUnitsSequentially`（算一个写一个）
 * 已删除，改由采纳桥 `adoption/adoptStoryboardBatch` 整批一次落定：
 *  · 第 N 个算失败不再留「半落的轴」（全算完才写）；
 *  · 12 个镜头 = **一层**撤销栈（原来 12 层，用户要按 12 次 Cmd+Z）。
 * 排序仍来自纯规划器 `planStoryboardTimeline`（shotIndex 镜序），本文件只管
 * 「排哪些、从哪帧起」这层意图，落轴机制归桥。
 */

export type SendStoryboardToTimelineResult = {
  ok: boolean
  total: number
  /** 本次真正排进去的单位数。 */
  placed: number
  /** 兼容既有 Agent/面板回执字段；只由采纳桥的落点明细派生。 */
  sent: Array<{ nodeId: string; clipId: string; trackType: string; startFrame: number; role?: StoryboardTimelineUnitRole }>
  skipped: Array<{ nodeId: string; reason: string }>
  /** 采纳结果原样透传，调用方据此给回执（幂等/stale/换版都在里面）。 */
  outcome: BatchAdoptionResult
}

export type { StoryboardTimelineUnitRole }

function toResult(outcome: BatchAdoptionResult, total: number): SendStoryboardToTimelineResult {
  if (outcome.status === 'nothing_to_adopt') {
    return { ok: false, total, placed: 0, sent: [], skipped: outcome.skipped, outcome }
  }
  const placed = outcome.status === 'applied' && !outcome.replayed ? outcome.proposal.placedCount : 0
  const sent = outcome.status === 'applied' && !outcome.replayed ? (outcome.placedItems || []) : []
  // 幂等重放也是成功的采纳（只是这次没有再次写轴）；`sent` 保持空，避免
  // 调用方把原片段误当成新落点，但 `ok` 不能把一次合法重放报成失败。
  return { ok: true, total, placed, sent, skipped: outcome.proposal.skipped, outcome }
}

/**
 * 手动「发送到时间轴」（工具栏按钮，作用于选中子集）：按 `shotIndex` 镜序把选中节点
 * 铺到时间轴（从播放头开始）。排序与 Agent 路径共享同一份真相（shotIndex）。
 */
export async function sendStoryboardToTimeline(
  nodeIds: readonly string[],
): Promise<SendStoryboardToTimelineResult> {
  const canvasState = useGenerationCanvasStore.getState()
  const { units, skipped } = planStoryboardTimeline(canvasState.nodes, canvasState.edges, nodeIds)
  const startFrame = Math.max(0, Math.floor(useWorkbenchStore.getState().timeline.playheadFrame ?? 0))
  const outcome = await adoptStoryboardBatch({
    units,
    skipped,
    startFrame,
    readNodes: () => useGenerationCanvasStore.getState().nodes,
  })
  return toResult(outcome, units.length)
}

export type ArrangeStoryboardToTimelineOptions = {
  /** 排片范围：省略 = 整条故事板（所有镜头节点）；给定 = 仅这些节点。 */
  nodeIds?: readonly string[]
}

/**
 * Agent 入口 arrange_storyboard_to_timeline：把整条（或指定子集）故事板按剧本镜序
 * **追加**到时间轴末尾（用户拍板：追加语义，非破坏现有 clip）。视频优先、缺视频走
 * 关键帧占位、未生成跳过并回报——排序/选片全在纯函数里，LLM 只负责触发。
 */
export async function arrangeStoryboardToTimeline(
  options: ArrangeStoryboardToTimelineOptions = {},
): Promise<SendStoryboardToTimelineResult> {
  const canvasState = useGenerationCanvasStore.getState()
  const { units, skipped } = planStoryboardTimeline(canvasState.nodes, canvasState.edges, options.nodeIds)
  const startFrame = timelineEndFrame(useWorkbenchStore.getState().timeline)
  const outcome = await adoptStoryboardBatch({
    units,
    skipped,
    startFrame,
    readNodes: () => useGenerationCanvasStore.getState().nodes,
  })
  return toResult(outcome, units.length)
}
