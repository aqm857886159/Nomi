import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { generateImage } from './imageActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { generateVideo } from './videoActions'

export type GenerationNodeExecutorContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

export type GenerationNodeExecutor = (
  node: GenerationCanvasNode,
  context?: GenerationNodeExecutorContext,
) => Promise<GenerationNodeResult>

export const generationNodeExecutor: GenerationNodeExecutor = async (node, context) => {
  if (node.kind === 'image') {
    const references = resolveGenerationReferences(node, context)
    return generateImage(node, { references })
  }
  if (node.kind === 'video') {
    const references = resolveGenerationReferences(node, context)
    return generateVideo(node, { references })
  }
  throw new Error(`${node.kind} generation is not implemented yet`)
}

export const placeholderGenerationNodeExecutor = generationNodeExecutor
