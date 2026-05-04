import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type GenerationRunQueueItem = {
  id: string
  nodeId: string
  status: 'queued' | 'running' | 'success' | 'error'
  error?: string
}

export function createRunQueue(nodes: GenerationCanvasNode[]): GenerationRunQueueItem[] {
  return nodes.map((node) => ({
    id: `run-${node.id}`,
    nodeId: node.id,
    status: 'queued',
  }))
}

