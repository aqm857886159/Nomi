import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { runCatalogGenerationTask, type CatalogTaskRunOptions, type GenerationNodeResults } from './catalogTaskActions'

export type GenerateAudioOptions = CatalogTaskRunOptions

// 声音生成（配音 TTS / 转写 Whisper）与图像/视频同走 catalog 任务流：
// resolveExecutableNodeFromCatalog → buildCatalogTaskRequest（kind=text_to_audio/transcribe，由
// resolveTaskKind 据当前模式 transportTaskKind 给出）→ runWorkbenchTask（IPC → runtime 第四路
// runAudioTask）→ normalizeCatalogTaskResults（每份 audio 资产一个结果 / transcribe 文本）。
export async function generateAudio(
  node: GenerationCanvasNode,
  options: GenerateAudioOptions,
): Promise<GenerationNodeResults> {
  return runCatalogGenerationTask(node, options)
}
