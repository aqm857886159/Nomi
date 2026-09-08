import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type GenerationFlowConnectionAffordance = 'magnetic' | 'hidden'

/** Connection discovery belongs to the outer hot zone, never to selection. */
export function resolveGenerationFlowConnectionAffordance(
  node: GenerationCanvasNode,
): GenerationFlowConnectionAffordance {
  return node.kind === 'panorama' || node.meta?.collapsedGroupProxy === true ? 'hidden' : 'magnetic'
}
