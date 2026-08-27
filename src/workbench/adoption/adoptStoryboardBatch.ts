import { buildGenerationNodeTimelineClip } from '../timeline/buildGenerationNodeTimelineClip'
import { getTrackTypeForClipType } from '../timeline/timelineTypes'
import type { TimelineState, TimelineTextClip, TimelineTransition } from '../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { StoryboardTimelineUnit } from '../generationCanvas/agent/storyboardTimelinePlan'
import { applyAdoption } from './adoptionApply'
import { contractHashOfResult, proposalKeyForBatch, runIdOfNode, timelineRevisionOf } from './adoptionProposalKey'
import { lookupAdoptionProposal, proposalIsLanded, registerAdoptionProposal } from './adoptionProposalRegistry'
import { workbenchAdoptionPorts } from './adoptionStorePorts'
import type { AdoptionApplyPorts, AdoptionOutcome, AdoptionPlacement } from './adoptionTypes'

/**
 * 批量采纳：**整批按分镜顺序排进时间轴**（Master Plan §5.1 E1 的批量版）。
 *
 * 收敛掉的旧路径：`sendStoryboardToTimeline.ts` 的 `placeUnitsSequentially`——
 * 那是个「算一个写一个」的循环，两个后果：
 *  ① 第 N 个算失败时前 N-1 个已经落轴了（半落的轴，没人告诉用户）；
 *  ② 每个 clip 压一层撤销栈，12 个镜头要按 12 次 Cmd+Z。
 * 这里改成「全算完 → 一次写 → 一层栈」，两个问题一起消失。
 *
 * 排序仍由既有纯规划器 `planStoryboardTimeline` 负责（shotIndex 镜序），本模块不重排——
 * 采纳桥管的是「怎么落」，不是「谁先谁后」。
 */

export type AdoptStoryboardBatchOptions = {
  /** 已按镜序排好的单位（来自 planStoryboardTimeline）。 */
  units: readonly StoryboardTimelineUnit[]
  /** 规划阶段就跳过的单位（没生成画面等），原样透传进回执。 */
  skipped?: Array<{ nodeId: string; reason: string }>
  /** 起始帧。贴尾 = 全轴最右端；「发送选中」= 播放头。 */
  startFrame: number
  readNodes: () => readonly GenerationCanvasNode[]
  ports?: AdoptionApplyPorts
  /** Optional caller lifecycle guard, not a semantic revision/CAS protocol. */
  assertCanApply?: () => void
}

/** 全轴最右端帧（跨所有轨）。 */
export function timelineEndFrame(timeline: TimelineState): number {
  let end = 0
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.endFrame > end) end = clip.endFrame
    }
  }
  return end
}

/** 轴上已落 clip 的 sourceNodeId 集合。 */
export function timelineSourceNodeIds(timeline: TimelineState): Set<string> {
  const ids = new Set<string>()
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.sourceNodeId) ids.add(clip.sourceNodeId)
    }
  }
  return ids
}

/**
 * append 幂等：把已在轴上的单位（按 sourceNodeId）滤掉。
 * 选「跳过」而非「替换」——arrange 是「追加整条故事板到末尾」的语义（用户拍板），
 * 重复触发不该把已排好（可能用户已手动调过位/裁过）的 clip 再复制一份到末尾。
 */
export function partitionUnitsByTimelinePresence<T extends { nodeId: string }>(
  units: ReadonlyArray<T>,
  presentSourceNodeIds: ReadonlySet<string>,
): { kept: T[]; skipped: Array<{ nodeId: string; reason: string }> } {
  const kept: T[] = []
  const skipped: Array<{ nodeId: string; reason: string }> = []
  for (const unit of units) {
    if (presentSourceNodeIds.has(unit.nodeId)) skipped.push({ nodeId: unit.nodeId, reason: 'already_on_timeline' })
    else kept.push(unit)
  }
  return { kept, skipped }
}

/** Prefer an authored subtitle; dialogue is the honest fallback when no subtitle was supplied. */
export function storyboardCaptionText(node: { meta?: Record<string, unknown> }): string | undefined {
  const meta = node.meta || {}
  for (const key of ['subtitle', 'dialogue']) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function transitionFromNode(
  node: { meta?: Record<string, unknown> },
): Omit<TimelineTransition, 'fromClipId' | 'toClipId'> | undefined {
  const raw = node.meta?.transition
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const type = record.type
  if (!['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan'].includes(String(type))) return undefined
  const durationFrames = Number.isInteger(record.durationFrames) && Number(record.durationFrames) > 0
    ? Number(record.durationFrames)
    : undefined
  return { type: type as TimelineTransition['type'], ...(durationFrames ? { durationFrames } : {}) }
}

/** 每镜落点明细：供 Agent 向用户复述「镜 N 用视频 / 用关键帧占位、落在第几帧」。 */
export type BatchPlacedItem = {
  nodeId: string
  clipId: string
  trackType: string
  startFrame: number
  role?: StoryboardTimelineUnit['role']
}

export type BatchAdoptionResult = AdoptionOutcome & {
  /** 规划总数（含被跳过的），给回执文案用。 */
  total?: number
  /** 本次落点明细。幂等重放/stale 时为空数组（因为这次没落任何东西）。 */
  placedItems?: BatchPlacedItem[]
}

export async function adoptStoryboardBatch(options: AdoptStoryboardBatchOptions): Promise<BatchAdoptionResult> {
  options.assertCanApply?.()
  const ports = options.ports || workbenchAdoptionPorts
  const readNodes = options.readNodes
  const total = options.units.length
  const planSkipped = [...(options.skipped || [])]

  const timeline = ports.readTimeline()
  const nodesAtRequest = readNodes()
  // 先查整批身份，再按 sourceNodeId 去重。否则第二次点「一键拼片」时，旧实现会
  // 先看到所有镜头都已在轴上，直接返回 nothing_to_adopt，丢掉了原 Proposal。
  // 这里允许自身上一次 apply 造成的 revision 变化走 replay；真正的外部轴编辑仍 stale。
  const requestKeyUnits = options.units.flatMap((unit) => {
    const node = nodesAtRequest.find((candidate) => candidate.id === unit.nodeId)
    if (!node?.result?.url) return []
    return [{
      nodeId: unit.nodeId,
      artifactId: node.result.id,
      artifactVersion: String(node.result.createdAt),
      contractHash: contractHashOfResult(node.result),
      runId: runIdOfNode(node),
    }]
  })
  if (requestKeyUnits.length > 0) {
    const requestLookup = lookupAdoptionProposal(proposalKeyForBatch(requestKeyUnits, timeline))
    if (requestLookup.kind === 'replay') {
      return { status: 'applied', proposal: requestLookup.proposal, replayed: true, total }
    }
    if (requestLookup.kind === 'stale' && proposalIsLanded(requestLookup.proposal, timeline)) {
      return { status: 'applied', proposal: requestLookup.proposal, replayed: true, total }
    }
    if (requestLookup.kind === 'stale') return { status: 'stale', proposal: requestLookup.proposal, total }
    if (requestLookup.kind === 'needs_attention') {
      return { status: 'needs_attention', proposal: requestLookup.proposal, reason: 'artifact_version_changed', total }
    }
  }
  const { kept, skipped: alreadyPlaced } = partitionUnitsByTimelinePresence(
    options.units,
    timelineSourceNodeIds(timeline),
  )
  const skipped = [...planSkipped, ...alreadyPlaced]
  if (kept.length === 0) return { status: 'nothing_to_adopt', skipped, total }

  // ── 阶段 ①：全部算完（纯计算，不写轴）。cursor 在两轨间顺序累加 —— 时间上首尾相接、
  // 不重叠，导出时跨轨取当前帧活动 clip，成片连续。
  let cursor = Math.max(0, Math.floor(options.startFrame))
  const placements: AdoptionPlacement[] = []
  const textClips: TimelineTextClip[] = []
  const keyUnits: Array<{ nodeId: string; artifactId: string; artifactVersion: string; contractHash: string; runId: string }> = []
  const placedNodes: Array<{ nodeId: string; clipId: string }> = []
  const placedItems: BatchPlacedItem[] = []

  for (const unit of kept) {
    const node = nodesAtRequest.find((candidate) => candidate.id === unit.nodeId)
    if (!node || !node.result?.url) {
      skipped.push({ nodeId: unit.nodeId, reason: 'clip_unavailable' })
      continue
    }
    const clip = await buildGenerationNodeTimelineClip(node, { fps: timeline.fps, startFrame: cursor })
    options.assertCanApply?.()
    if (!clip) {
      skipped.push({ nodeId: unit.nodeId, reason: 'clip_unavailable' })
      continue
    }
    const trackType = getTrackTypeForClipType(clip.type)
    placements.push({ clip, trackType, startFrame: cursor })
    placedNodes.push({ nodeId: unit.nodeId, clipId: clip.id })
    placedItems.push({
      nodeId: unit.nodeId,
      clipId: clip.id,
      trackType,
      startFrame: cursor,
      ...(unit.role ? { role: unit.role } : {}),
    })
    keyUnits.push({
      nodeId: unit.nodeId,
      artifactId: node.result.id,
      artifactVersion: String(node.result.createdAt),
      contractHash: contractHashOfResult(node.result),
      runId: runIdOfNode(node),
    })
    const caption = storyboardCaptionText(node)
    if (caption) {
      textClips.push({
        id: `storyboard-caption-${unit.nodeId.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
        sourceNodeId: unit.nodeId,
        text: caption,
        style: 'caption',
        startFrame: clip.startFrame,
        endFrame: clip.endFrame,
      })
    }
    cursor = clip.startFrame + clip.frameCount
  }

  if (placements.length === 0) return { status: 'nothing_to_adopt', skipped, total }

  // Transitions are authored metadata, not a count of adjacent cuts. Only an explicit
  // transition on the preceding shot becomes a timeline entry; missing metadata remains a cut.
  const transitions: TimelineTransition[] = []
  if (placedNodes.length > 1) {
    const nodes = nodesAtRequest
    for (let index = 0; index < placedNodes.length - 1; index += 1) {
      const transition = transitionFromNode(nodes.find((node) => node.id === placedNodes[index].nodeId) || {})
      if (!transition) continue
      transitions.push({
        fromClipId: placedNodes[index].clipId,
        toClipId: placedNodes[index + 1].clipId,
        ...transition,
      })
    }
  }

  // ── 阶段 ②：查闸。键在算完之后才取 baseRevision —— 上面的 await 期间轴可能被别处动过。
  options.assertCanApply?.()
  const key = proposalKeyForBatch(keyUnits, ports.readTimeline())
  const lookup = lookupAdoptionProposal(key)
  if (lookup.kind === 'replay') return { status: 'applied', proposal: lookup.proposal, replayed: true, total }
  if (lookup.kind === 'stale') return { status: 'stale', proposal: lookup.proposal, total }
  if (lookup.kind === 'needs_attention') {
    return { status: 'needs_attention', proposal: lookup.proposal, reason: 'artifact_version_changed', total }
  }

  // ── 阶段 ③：一次写定，一层撤销栈。
  const applied = applyAdoption(ports, placements, { textClips, transitions })
  if (applied.ok) {
    const proposal = registerAdoptionProposal(key, 'applied', {
      placementKind: 'batch',
      clipIds: applied.clipIds,
      placedCount: placements.length,
      appliedRevision: timelineRevisionOf(applied.timeline),
      skipped,
    })
    return { status: 'applied', proposal, replayed: false, total, placedItems }
  }
  const status = applied.recovered ? 'failed' : 'needs_recovery'
  const proposal = registerAdoptionProposal(key, status, { placementKind: 'batch', placedCount: 0, skipped })
  return applied.recovered
    ? { status: 'failed', proposal, error: applied.error, total }
    : { status: 'needs_recovery', proposal, error: applied.error, total }
}
