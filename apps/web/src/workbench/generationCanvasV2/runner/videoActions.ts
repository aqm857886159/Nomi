import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import {
  buildCatalogTaskRequest,
  normalizeCatalogTaskResult,
  runCatalogGenerationTask,
  type CatalogTaskActionOptions,
} from './catalogTaskActions'

export type GenerateVideoOptions = CatalogTaskActionOptions

export const buildVideoGenerationRequest = buildCatalogTaskRequest

export function normalizeVideoGenerationResult(
  response: unknown,
  node: GenerationCanvasNode,
  _durationSeconds?: number,
): GenerationNodeResult {
  return normalizeCatalogTaskResult(response as Parameters<typeof normalizeCatalogTaskResult>[0], node)
}

export async function generateVideo(
  node: GenerationCanvasNode,
  options: GenerateVideoOptions = {},
): Promise<GenerationNodeResult> {
  return runCatalogGenerationTask(node, options)
}
