import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'

export type GenerationFlowConnectionAffordance = 'dot' | 'magnetic'

/** Preserve the connection affordance that the legacy renderer exposed. */
export function resolveGenerationFlowConnectionAffordance(
  node: GenerationCanvasNode,
  primarySelection: boolean,
  pendingConnectionSourceId: string,
): GenerationFlowConnectionAffordance {
  if (!primarySelection || pendingConnectionSourceId === node.id || node.kind === 'panorama') return 'dot'
  return node.kind === 'image' || node.kind === 'asset' || isImageLikeGenerationNodeKind(node.kind)
    ? 'magnetic'
    : 'dot'
}
