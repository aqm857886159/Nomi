import { buildGenerationNodeTimelineClip } from '../timeline/buildGenerationNodeTimelineClip'
import { findAppendFrame } from '../timeline/timelineMath'
import { getTrackTypeForClipType } from '../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { applyAdoption } from './adoptionApply'
import { destinationOf, proposalKeyForNode, timelineRevisionOf } from './adoptionProposalKey'
import { lookupAdoptionProposal, proposalIsLanded, registerAdoptionProposal } from './adoptionProposalRegistry'
import { workbenchAdoptionPorts } from './adoptionStorePorts'
import type { AdoptionApplyPorts, AdoptionOutcome } from './adoptionTypes'

/**
 * 单产物采纳（合同 §5 的 `Artifact → EditProposal → Apply/Undo`）。
 *
 * 收敛掉的旧路径（见 docs/plan/2026-08-25-p5-e1-adoption-bridge.md §3）：
 *  · 节点「加入时间轴」点击贴尾（原 addNodeToTimelineEnd.ts 直写）
 *  · 节点拖拽自选位置（原 useNodeDragResize.ts 直写）
 * 两条现在都到这儿汇流——**用户看到的按钮和拖拽手感一个字没改**，
 * 变的是它们背后从「直接写轴」变成「提案 → 查四道闸 → 原子写 → 回执带撤销」。
 */

export type AdoptGenerationNodePlacement =
  | { kind: 'append' }
  | { kind: 'frame'; startFrame: number }

export type AdoptGenerationNodeOptions = {
  placement?: AdoptGenerationNodePlacement
  ports?: AdoptionApplyPorts
}

export async function adoptGenerationNode(
  node: GenerationCanvasNode,
  options: AdoptGenerationNodeOptions = {},
): Promise<AdoptionOutcome> {
  const ports = options.ports || workbenchAdoptionPorts
  const placement = options.placement || { kind: 'append' }
  const result = node.result
  if (!result || !result.url) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'no_result' }] }
  }

  const timeline = ports.readTimeline()
  // 先按 0 帧构建（拿 clip 的类型/时长），再据类型定轨、据轨定落点——
  // 落点依赖轨道，轨道依赖 clip 类型，顺序不能反。
  const probe = await buildGenerationNodeTimelineClip(node, { fps: timeline.fps, startFrame: 0 })
  if (!probe) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'clip_unavailable' }] }
  }
  const trackType = getTrackTypeForClipType(probe.type)
  const track = timeline.tracks.find((candidate) => candidate.type === trackType)
  const startFrame = placement.kind === 'append'
    ? (track ? findAppendFrame(track) : 0)
    : Math.max(0, Math.floor(placement.startFrame))

  const clip = await buildGenerationNodeTimelineClip(node, { fps: timeline.fps, startFrame })
  if (!clip) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'clip_unavailable' }] }
  }

  const destination = destinationOf(
    placement.kind === 'append'
      ? { kind: 'append', trackType }
      : { kind: 'frame', trackType, startFrame },
  )
  // 键在**构建之后**才算：baseRevision 要读的是「真正准备写的那一刻」的轴。
  const key = proposalKeyForNode(node, result, ports.readTimeline(), destination)

  const lookup = lookupAdoptionProposal(key)
  if (lookup.kind === 'replay') return { status: 'applied', proposal: lookup.proposal, replayed: true }
  if (lookup.kind === 'stale') {
    // 自己上一次 apply 造成的 revision 变化仍是幂等重放；外部编辑则诚实报 stale。
    if (proposalIsLanded(lookup.proposal, ports.readTimeline())) {
      return { status: 'applied', proposal: lookup.proposal, replayed: true }
    }
    return { status: 'stale', proposal: lookup.proposal }
  }
  if (lookup.kind === 'needs_attention') {
    return { status: 'needs_attention', proposal: lookup.proposal, reason: 'artifact_version_changed' }
  }

  const applied = applyAdoption(ports, [{ clip, trackType, startFrame }])
  if (applied.ok) {
    const proposal = registerAdoptionProposal(key, 'applied', {
      clipIds: applied.clipIds,
      placedCount: 1,
      appliedRevision: timelineRevisionOf(applied.timeline),
    })
    return { status: 'applied', proposal, replayed: false }
  }
  const status = applied.recovered ? 'failed' : 'needs_recovery'
  const proposal = registerAdoptionProposal(key, status, { placedCount: 0 })
  return applied.recovered
    ? { status: 'failed', proposal, error: applied.error }
    : { status: 'needs_recovery', proposal, error: applied.error }
}
