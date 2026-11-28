import type { CapabilitySlot, TimelineAdoptedSource } from '../../../electron/shared/contracts/telemetry'
import { getDesktopBridge } from '../../desktop/bridge'
import { buildGenerationNodeTimelineClip } from '../timeline/buildGenerationNodeTimelineClip'
import { findAppendFrame } from '../timeline/timelineMath'
import { getTrackTypeForClipType, type TimelineClip } from '../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { buildClipFromGenerationNode } from '../generationCanvas/model/buildClipFromGenerationNode'
import { applyAdoption } from './adoptionApply'
import { destinationOf, proposalKeyForNode, timelineRevisionOf } from './adoptionProposalKey'
import {
  findLandedProposalForSlot,
  lookupAdoptionProposal,
  proposalIsLanded,
  registerAdoptionProposal,
} from './adoptionProposalRegistry'
import { createWorkbenchAdoptionPorts } from './adoptionStorePorts'
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

export function capabilityOfAdoptedNode(
  node: Pick<GenerationCanvasNode, 'result' | 'meta'> | undefined,
  clipType: TimelineClip['type'],
): CapabilitySlot {
  const rawKind = String(
    (node?.result as { taskKind?: unknown } | undefined)?.taskKind
    ?? node?.meta?.taskKind
    ?? node?.result?.provenance?.params?.taskKind
    ?? '',
  )
  if (rawKind === 'image_edit') return 'image-edit'
  if (clipType === 'video') return 'video'
  if (clipType === 'audio') return 'audio'
  return 'image'
}

export function trackTimelineAdopted(capability: CapabilitySlot, source: TimelineAdoptedSource): void {
  try {
    void getDesktopBridge()?.telemetry?.track({
      eventName: 'timeline.adopted',
      props: { capability, source },
    })
  } catch {
    /* ignore */
  }
}

type AdoptGenerationNodePlacement =
  | { kind: 'append' }
  | { kind: 'frame'; startFrame: number }

type AdoptGenerationNodeOptions = {
  placement?: AdoptGenerationNodePlacement
  ports?: AdoptionApplyPorts
  source?: Extract<TimelineAdoptedSource, 'canvas' | 'agent'>
}

let appendChain: Promise<void> = Promise.resolve()

async function runAdoptGenerationNode(
  node: GenerationCanvasNode,
  ports: AdoptionApplyPorts,
  placement: AdoptGenerationNodePlacement,
  source: Extract<TimelineAdoptedSource, 'canvas' | 'agent'>,
): Promise<AdoptionOutcome> {
  const result = node.result
  if (!result || !result.url) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'no_result' }] }
  }

  const timeline = ports.readTimeline()
  // 先按 0 帧确定 clip 类型，再据类型定轨、据轨定落点——
  // 落点依赖轨道，轨道依赖 clip 类型，顺序不能反。
  const probe = buildClipFromGenerationNode(node, { fps: timeline.fps, startFrame: 0 })
  if (!probe) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'clip_unavailable' }] }
  }
  const trackType = getTrackTypeForClipType(probe.type)
  const initialTrack = timeline.tracks.find((candidate) => candidate.type === trackType)
  const initialStartFrame = placement.kind === 'append'
    ? (initialTrack ? findAppendFrame(initialTrack) : 0)
    : Math.max(0, Math.floor(placement.startFrame))

  const probedClip = await buildGenerationNodeTimelineClip(node, { fps: timeline.fps, startFrame: initialStartFrame })
  if (!probedClip) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'clip_unavailable' }] }
  }

  const live = ports.readTimeline()
  const liveTrack = live.tracks.find((candidate) => candidate.type === trackType)
  const startFrame = placement.kind === 'append'
    ? (liveTrack ? findAppendFrame(liveTrack) : 0)
    : initialStartFrame
  const rebased = startFrame === initialStartFrame
    ? probedClip
    : buildClipFromGenerationNode(node, { fps: live.fps, startFrame })
  if (!rebased) {
    return { status: 'nothing_to_adopt', skipped: [{ nodeId: node.id, reason: 'clip_unavailable' }] }
  }
  const clip = startFrame === initialStartFrame
    ? probedClip
    : {
        ...rebased,
        frameCount: probedClip.frameCount,
        endFrame: startFrame + probedClip.frameCount,
        offsetStartFrame: probedClip.offsetStartFrame,
        offsetEndFrame: probedClip.offsetEndFrame,
        ...(probedClip.sourceAspectRatio ? { sourceAspectRatio: probedClip.sourceAspectRatio } : {}),
      }

  const destination = destinationOf(
    placement.kind === 'append'
      ? { kind: 'append', trackType, startFrame }
      : { kind: 'frame', trackType, startFrame },
  )
  // 键在**构建之后**才算：baseRevision 要读的是「真正准备写的那一刻」的轴。
  const key = proposalKeyForNode(node, result, live, destination)

  // 贴尾连点两下的幂等：贴尾的落点会**随轴变长而变**，所以两次点击的 destination 天然不同，
  // 光靠全等键匹配不到。判据是「上一次采纳的成果原样还在、且轴自那以后没被动过」
  // （proposalIsLanded 比对 appliedRevision）——成立就是同一个意图的重放，不再落第二份。
  // 反过来，轴一旦被编辑过（用户又想要一份），它就不再 landed，于是正常落第二份，
  // 而不是把人堵在「时间轴已变化」的死胡同里。
  if (placement.kind === 'append') {
    const landedReplay = findLandedProposalForSlot(key, live)
    if (landedReplay) return { status: 'applied', proposal: landedReplay, replayed: true }
  }

  const lookup = lookupAdoptionProposal(key, live)
  if (lookup.kind === 'replay') return { status: 'applied', proposal: lookup.proposal, replayed: true }
  if (lookup.kind === 'stale') {
    // 自己上一次 apply 造成的 revision 变化仍是幂等重放；外部编辑则诚实报 stale。
    if (proposalIsLanded(lookup.proposal, live)) {
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
      placementKind: placement.kind,
      clipIds: applied.clipIds,
      placedCount: 1,
      appliedRevision: timelineRevisionOf(applied.timeline),
    })
    trackTimelineAdopted(capabilityOfAdoptedNode(node, clip.type), source)
    return { status: 'applied', proposal, replayed: false }
  }
  const status = applied.recovered ? 'failed' : 'needs_recovery'
  const proposal = registerAdoptionProposal(key, status, { placementKind: placement.kind, placedCount: 0 })
  return applied.recovered
    ? { status: 'failed', proposal, error: applied.error }
    : { status: 'needs_recovery', proposal, error: applied.error }
}

export async function adoptGenerationNode(
  node: GenerationCanvasNode,
  options: AdoptGenerationNodeOptions = {},
): Promise<AdoptionOutcome> {
  const ports = options.ports || createWorkbenchAdoptionPorts()
  const placement = options.placement || { kind: 'append' }
  const source = options.source || 'canvas'
  if (placement.kind !== 'append') {
    return runAdoptGenerationNode(node, ports, placement, source)
  }
  const task = appendChain.then(() => runAdoptGenerationNode(node, ports, placement, source))
  appendChain = task.then(() => undefined, () => undefined)
  return task
}
