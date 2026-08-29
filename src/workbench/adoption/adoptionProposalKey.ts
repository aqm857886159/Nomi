import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { TimelineState } from '../timeline/timelineTypes'
import { timelineRevision } from '../timeline/kernel/timelineKernel'
import type { AdoptionProposalKey } from './adoptionTypes'

/**
 * 幂等键的**归一**层（纯函数，不碰 store）。
 * 合同键：(runId, contractHash, artifactId, artifactVersion, baseRevision, destination)。
 */

/** 稳定字符串摘要（FNV-1a 32bit，转 36 进制）。只用来做身份比较，不做安全用途。 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/**
 * 时间轴的内容 revision。
 *
 * **不用 `workbenchStore.persistRevision`**——它是整个文档的脏计数器；从轴的实际内容派生，
 * 撤回到同一个轴也能回到同一个 revision，不会制造假 stale。
 */
export function timelineRevisionOf(timeline: TimelineState): string {
  // Agent plans and adoption proposals must share one content revision. The
  // kernel hash covers source windows, framing, text, URLs and transitions;
  // keeping a second partial hash would let edits bypass stale detection.
  return timelineRevision(timeline)
}

/**
 * 生成契约摘要：同 prompt / 模型 / 参数 = 同 hash。
 * provenance 是 E11 起的完整记录；老产物没有 provenance 时退回 model/type。
 */
export function contractHashOfResult(result: GenerationNodeResult): string {
  const provenance = result.provenance
  if (!provenance) return stableHash(`legacy:${result.model || ''}:${result.type}`)
  return stableHash(
    [
      provenance.provider || '',
      provenance.modelKey || result.model || '',
      provenance.modelVersion || '',
      provenance.prompt || '',
      provenance.negativePrompt || '',
      provenance.seed === undefined ? '' : String(provenance.seed),
      provenance.params ? JSON.stringify(provenance.params) : '',
    ].join('\u0000'),
  )
}

/** run 身份：agent run 优先，手动生成没有 run → 'local'。 */
export function runIdOfNode(node: GenerationCanvasNode): string {
  return node.result?.provenance?.agentRunId || node.progress?.runId || 'local'
}

export type DestinationInput =
  | { kind: 'append'; trackType: string; startFrame: number }
  | { kind: 'frame'; trackType: string; startFrame: number }
  | { kind: 'batch' }

/**
 * 落点身份。同一个产物贴尾 vs 拖到第 120 帧是两次不同的采纳意图。
 *
 * **贴尾也要带上解析出来的真实 startFrame**（而不是笼统的 `@append`）。
 * 只写 `@append` 会把「同一个产物先后两次合法贴尾」压成同一个意图：
 * 用户第一次落完、轴又被编辑过，第二次点「加入时间轴」——他要的就是第二份——
 * 却因为身份撞车被判成前一次的 stale，收到「时间轴已变化，请重新加入」。
 * 而重点一次 baseRevision 又变了，仍然 stale：这是个**没有出路的死胡同**。
 * 带上真实帧号后，两次贴尾天然是两个落点（轴长了，尾巴就不在同一帧），
 * 各自是独立意图；真正的连点两下则落点相同 → 仍然正确地幂等重放。
 */
export function destinationOf(input: DestinationInput): string {
  if (input.kind === 'batch') return 'timeline:batch@append'
  const startFrame = Math.max(0, Math.floor(input.startFrame))
  if (input.kind === 'append') return `timeline:${input.trackType}@append:${startFrame}`
  return `timeline:${input.trackType}@${startFrame}`
}

/** 单产物采纳的键。 */
export function proposalKeyForNode(
  node: GenerationCanvasNode,
  result: GenerationNodeResult,
  timeline: TimelineState,
  destination: string,
): AdoptionProposalKey {
  return {
    runId: runIdOfNode(node),
    contractHash: contractHashOfResult(result),
    artifactId: result.id,
    artifactVersion: String(result.createdAt),
    baseRevision: timelineRevisionOf(timeline),
    destination,
  }
}

/** 批量采纳的键：整批按分镜顺序排进时间轴是一次采纳意图，不是 N 次。 */
export function proposalKeyForBatch(
  units: ReadonlyArray<{ nodeId: string; artifactId: string; artifactVersion: string; contractHash: string; runId: string }>,
  timeline: TimelineState,
): AdoptionProposalKey {
  const runIds = [...new Set(units.map((unit) => unit.runId))].sort()
  return {
    runId: runIds.length === 1 ? runIds[0] : stableHash(runIds.join(',')),
    contractHash: stableHash(units.map((unit) => unit.contractHash).join('|')),
    artifactId: stableHash(units.map((unit) => `${unit.nodeId}:${unit.artifactId}`).join('|')),
    artifactVersion: stableHash(units.map((unit) => unit.artifactVersion).join('|')),
    baseRevision: timelineRevisionOf(timeline),
    destination: destinationOf({ kind: 'batch' }),
  }
}

/** 键 → registry 主键。字段顺序固定，别改（改了等于所有在途提案失忆）。 */
export function proposalKeyId(key: AdoptionProposalKey): string {
  return [
    key.runId,
    key.contractHash,
    key.artifactId,
    key.artifactVersion,
    key.baseRevision,
    key.destination,
  ].join('\u0001')
}

/** 去掉 baseRevision 的其余五元组，用于判定同一意图的 stale。 */
export function proposalIdentityId(key: AdoptionProposalKey): string {
  return [key.runId, key.contractHash, key.artifactId, key.destination].join('\u0001')
}

/** 同一个产物槽位的身份。contractHash 不参与，以便产物换版先报 needs_attention。 */
export function proposalSlotId(key: AdoptionProposalKey): string {
  return [key.runId, key.artifactId, key.destination].join('\u0001')
}
