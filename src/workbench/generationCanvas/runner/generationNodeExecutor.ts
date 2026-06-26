import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import type { CatalogTaskActionOptions } from './catalogTaskResolve'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { generateAudio } from './audioActions'
import { generateImage } from './imageActions'
import { generate3D } from './model3dActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { applyRelayFirstFrame } from './relayFrameResolver'
import { generateText } from './textActions'
import { generateVideo } from './videoActions'

export type GenerationNodeExecutorContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
  /** S2 进度透传:catalog 任务各阶段 → 控制器 → setNodeProgress。 */
  onProgress?: CatalogTaskActionOptions['onProgress']
  /** 付费守卫令牌：透传到 build request 的 extras.grantId。 */
  grantId?: string
}

export type GenerationNodeExecutor = (
  node: GenerationCanvasNode,
  context?: GenerationNodeExecutorContext,
) => Promise<GenerationNodeResult>

export const generationNodeExecutor: GenerationNodeExecutor = async (node, context) => {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  const onProgress = context?.onProgress
  const grantId = context?.grantId
  const gate = grantId ? { grantId } : {}
  if (executionKind === 'image') {
    const references = resolveGenerationReferences(node, context)
    return generateImage(node, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  if (executionKind === 'video') {
    const references = resolveGenerationReferences(node, context)
    // 接力帧：源是视频时，抽其尾帧填本镜首帧（唯一消费 relayFromVideoUrl 的地方）。
    // 抽帧失败会抛错 → 节点标人话错误、不裸跑（不冒充不变量）。
    await applyRelayFirstFrame(references)
    return generateVideo(node, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  if (executionKind === 'text') {
    return generateText(node, onProgress ? { onProgress } : undefined)
  }
  if (executionKind === 'audio') {
    const references = resolveGenerationReferences(node, context)
    return generateAudio(node, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  if (executionKind === 'model3d') {
    const references = resolveGenerationReferences(node, context)
    return generate3D(node, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  throw new Error(`${node.kind} generation is not implemented yet`)
}

export const placeholderGenerationNodeExecutor = generationNodeExecutor
