import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildCatalogTaskRequest,
  runCatalogGenerationTask,
  type CatalogTaskRunOptions,
  type GenerationNodeResults,
} from './catalogTaskActions'

export type GenerateVideoOptions = CatalogTaskRunOptions

export const buildVideoGenerationRequest = buildCatalogTaskRequest

export async function generateVideo(
  node: GenerationCanvasNode,
  options: GenerateVideoOptions,
): Promise<GenerationNodeResults> {
  return runCatalogGenerationTask(node, options)
}
