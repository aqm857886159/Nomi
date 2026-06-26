import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { runCatalogGenerationTask, type CatalogTaskActionOptions } from './catalogTaskActions'

export type Generate3DOptions = CatalogTaskActionOptions

/**
 * 3D 模型生成（RunningHub 混元/HiTem/Meshy，输出 .glb）。
 * 与视频/图片同走**通用** catalog 任务路径（async create→poll），仅 taskKind(text_to_3d/image_to_3d)
 * 与结果类型(model3d)不同——这些差异由 archetype + catalog mapping 声明驱动，runner 零特判（P1/P4）。
 */
export async function generate3D(
  node: GenerationCanvasNode,
  options: Generate3DOptions = {},
): Promise<GenerationNodeResult> {
  return runCatalogGenerationTask(node, options)
}
