import { canFitReferenceEdge, resolveReferenceSlots } from '../runner/referenceSlots'
import type { ArchetypeReferenceSlotKind } from '../../../../electron/shared/modelArchetypes'
import { applyArchetypeModeSwitch, currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from './generationCanvasTypes'
import { acceptsParameterReferenceSource, nextParameterReferenceKey, readParameterReferenceSlots } from './parameterReferenceSlots'
import { archetypeForNode, isTextPromptEdge, resolveModeForReferenceDemand, selectConnectionEdgeMode, validateReferenceEdge, type EdgeSkipReason } from '../agent/referenceEdgeCapability'

/** Manual, group and explicit-slot connections share declaration-based capacity and media validation. */
export function resolveCanvasReferenceConnection(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  requestedMode?: GenerationCanvasEdgeMode,
  requestedKey?: string,
): { ok: true; mode: GenerationCanvasEdgeMode; targetParamKey?: string } | { ok: false; reason: EdgeSkipReason } {
  const slots = readParameterReferenceSlots(target.meta)
  if (slots.length) {
    if (!requestedKey && isTextPromptEdge(source, target, requestedMode)) return { ok: true, mode: 'reference' }
    const key = requestedKey ?? nextParameterReferenceKey(target, nodes, edges, source.id, requestedMode)
    const slot = slots.find((candidate) => candidate.key === key)
    if (!slot || !acceptsParameterReferenceSource(slot, source, requestedMode)) return { ok: false, reason: 'unsupported_reference' }
    return { ok: true, mode: requestedMode ?? slot.group, targetParamKey: slot.key }
  }
  if (requestedKey) return { ok: false, reason: 'unsupported_reference' }
  const mode = requestedMode ?? selectConnectionEdgeMode(source, target, edges.filter((edge) => edge.target === target.id))
  const verdict = validateReferenceEdge(source, target, mode)
  if (!verdict.ok) return verdict
  const existing = edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.mode === mode)
  if (!existing && !isTextPromptEdge(source, target, mode) && !canFitReferenceEdge(source, target, nodes, edges, mode)) return { ok: false, reason: 'unsupported_reference' }
  return { ok: true, mode }
}

export type MentionMediaKind = 'image' | 'video' | 'audio'

/** @ 能落的槽：每种媒体只有一种「参考」槽。chip 编号（mentionCandidates.currentReferenceMedia）按同一张表读。 */
export const MENTION_SLOT_BY_MEDIA: Record<MentionMediaKind, ArchetypeReferenceSlotKind> = {
  image: 'image_ref',
  video: 'video_ref',
  audio: 'audio_ref',
}

export type MentionReferencePlan =
  | { ok: true; switchToModeId: string | null; edgeMode: 'reference' | 'character_ref' }
  | { ok: false; reason: 'unsupported' | 'blocked_by_frame_edges' }
  | { ok: false; reason: 'full'; max: number }

/**
 * 在提示词里 @ 一个素材，它该落在哪——@ 的唯一规则（2026-09-25 用户：「用 @ 的时候应该是参考图模式，不是首尾帧的逻辑」）。
 *
 * @ 的意思是「参考这个」（「以 @图片1 的人物走向 @图片2」），所以只落参考槽，**永远不建首帧 / 尾帧边**。
 * 673e6c5f4（2026-08-28，给 @ 加视频 / 音频时）把 @ 接到了拖线的 selectConnectionEdgeMode 上，
 * 于是图生视频里第 1、2 张 @ 成了首帧 / 尾帧边，@ 视频进了「待抽帧」的首帧槽、编号为空、chip 不出、边还留着。
 * 拖线（把手连线）的首尾帧规则不走这里、不变。
 *
 * - 当前生成方式有对应参考槽 → 不切；
 * - 没有 → 用 resolveModeForReferenceDemand 找一个有的切过去；节点已经连着首帧 / 尾帧边时不切
 *   （一切换那些边的含义就变了），交给用户自己切；
 * - 放满了 → 明说上限，调用方不建边、不写上传。
 * 没有档案的节点（无模式可言）→ 落「参考」边，交给建边那一层的通用校验。
 */
export function resolveMentionReference(
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  mediaKind: MentionMediaKind,
): MentionReferencePlan {
  const slotKind = MENTION_SLOT_BY_MEDIA[mediaKind]
  const archetype = archetypeForNode(target)
  if (!archetype) return { ok: true, switchToModeId: null, edgeMode: 'reference' }
  const meta = (target.meta || {}) as Record<string, unknown>
  let switchToModeId: string | null = null
  if (!currentArchetypeMode(archetype, meta).slots.some((slot) => slot.kind === slotKind)) {
    switchToModeId = resolveModeForReferenceDemand(archetype, meta, [{ slots: [slotKind], asset: mediaKind }])
    if (!switchToModeId) return { ok: false, reason: 'unsupported' }
    if (edges.some((edge) => edge.target === target.id && (edge.mode === 'first_frame' || edge.mode === 'last_frame'))) {
      return { ok: false, reason: 'blocked_by_frame_edges' }
    }
  }
  const effectiveTarget = switchToModeId
    ? { ...target, meta: applyArchetypeModeSwitch(meta, archetype, switchToModeId) }
    : target
  const slot = resolveReferenceSlots(effectiveTarget, nodes as GenerationCanvasNode[], edges as GenerationCanvasEdge[])
    .find((candidate) => candidate.slotKind === slotKind)
  if (!slot) return { ok: false, reason: 'unsupported' }
  if (slot.max !== undefined && slot.fills.length >= slot.max) return { ok: false, reason: 'full', max: slot.max }
  const characterIndexed = mediaKind === 'image'
    && currentArchetypeMode(archetype, (effectiveTarget.meta || {}) as Record<string, unknown>).slots
      .some((candidate) => candidate.kind === 'image_ref' && Boolean(candidate.characterIndexed))
  return { ok: true, switchToModeId, edgeMode: characterIndexed ? 'character_ref' : 'reference' }
}
