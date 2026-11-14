import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildCatalogTaskRequest,
  runCatalogGenerationTask,
  type CatalogTaskRunOptions,
  type GenerationNodeResults,
} from './catalogTaskActions'

export type GenerateImageOptions = CatalogTaskRunOptions

export const buildImageGenerationRequest = buildCatalogTaskRequest

export async function generateImage(
  node: GenerationCanvasNode,
  options: GenerateImageOptions,
): Promise<GenerationNodeResults> {
  return runCatalogGenerationTask(node, options)
}
