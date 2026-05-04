import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'

export function exportGenerationGraph(nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[]) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
  }
}

