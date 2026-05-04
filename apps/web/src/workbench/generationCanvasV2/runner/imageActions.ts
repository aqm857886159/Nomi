import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import {
  buildCatalogTaskRequest,
  normalizeCatalogTaskResult,
  runCatalogGenerationTask,
  type CatalogTaskActionOptions,
} from './catalogTaskActions'

export type GenerateImageOptions = CatalogTaskActionOptions

export const buildImageGenerationRequest = buildCatalogTaskRequest

export function normalizeImageGenerationResult(
  response: unknown,
  node: GenerationCanvasNode,
): GenerationNodeResult {
  return normalizeCatalogTaskResult(response as Parameters<typeof normalizeCatalogTaskResult>[0], node)
}

export async function generateImage(
  node: GenerationCanvasNode,
  options: GenerateImageOptions = {},
): Promise<GenerationNodeResult> {
  return runCatalogGenerationTask(node, options)
}
