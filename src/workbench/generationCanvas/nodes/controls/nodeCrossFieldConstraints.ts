import { remainingReferenceCapacity, type ReferenceCounts } from '../../../../../electron/shared/videoCapabilities/crossFieldConstraints'
import type { ArchetypeMode } from '../../../../../electron/shared/modelArchetypes'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../../model/generationCanvasTypes'
import { resolveReferenceSlots } from '../../runner/referenceSlots'

/**
 * 这张卡每种参考槽此刻放了几件（上传的、连线的、还没出结果的连线都算）。画布上「参考数 → 约束」只从这里数：
 * 合计余量、参数面板按槽收窄选项（`when: { slotEmpty }`）、存值回落，三处同一个数。
 */
export function nodeReferenceCounts(
  node: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
): ReferenceCounts {
  const counts: ReferenceCounts = {}
  for (const slot of resolveReferenceSlots(node, nodes, edges)) counts[slot.slotKind] = (counts[slot.slotKind] ?? 0) + slot.fills.length
  return counts
}

/** Includes uploaded assets, connected assets and pending edges in the same budget. */
export function nodeReferenceCapacity(
  mode: ArchetypeMode,
  node: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
): number {
  return remainingReferenceCapacity(mode, nodeReferenceCounts(node, nodes, edges))
}
