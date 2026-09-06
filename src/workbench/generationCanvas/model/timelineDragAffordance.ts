import type { GenerationCanvasNode } from './generationCanvasTypes'


export function canDragGenerationNodeToTimeline(
  node: GenerationCanvasNode,
  options: { readOnly?: boolean } = {},
): boolean {
  if (options.readOnly) return false
  if (node.kind === 'panorama') return false
  if (node.status === 'error') return false
  return typeof node.result?.url === 'string' && node.result.url.trim().length > 0
}
