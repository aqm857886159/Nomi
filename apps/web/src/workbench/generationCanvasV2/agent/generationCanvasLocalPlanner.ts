import type { GenerationCanvasToolAction } from './generationCanvasTools'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type PlanInput = {
  message: string
  selectedNodes: GenerationCanvasNode[]
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function planGenerationCanvasAction(input: PlanInput): GenerationCanvasToolAction | null {
  const message = cleanText(input.message)
  if (!message) return null
  return null
}
