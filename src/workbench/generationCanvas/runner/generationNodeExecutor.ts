import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import type { CatalogTaskActionOptions } from './catalogTaskResolve'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { generateAudio } from './audioActions'
import { generateImage } from './imageActions'
import { generate3D } from './model3dActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { withConnectedTextPrompts } from './connectedTextPrompt'
import { generateText } from './textActions'
import { generateVideo } from './videoActions'
import type { MediaDimensions } from '../nodes/nodeSizing'

export type GenerationNodeExecutorContext = {
  /** 运行所属项目（提交那一刻签发）：任务 extras.projectId、结果本地化、接力抽帧都落进它。 */
  projectTarget: ProjectBinding
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
  /** One-shot correction appended to the provider prompt for a bounded QA retry. */
  promptSuffix?: string
  /** S2 进度透传:catalog 任务各阶段 → 控制器 → setNodeProgress。 */
  onProgress?: CatalogTaskActionOptions['onProgress']
  /** 单镜 Run 路（要花钱的节点：单节点 ↑ 与批量卡上的每一镜）：交 / 查都经主进程这一次运行的单镜 Run。缺省 = 本地 / 文本路。 */
  canvasRun?: { runRecordId: string }
  /** 提交幂等键（= node run.id）：透传到 extras.idempotencyKey，让同一次意图提交在 electron 侧 at-most-once。 */
  idempotencyKey?: string
  /** Renderer consent for a disclosed anonymous temporary-host fallback. */
  anonymousAssetHostingConsent?: 'allow'
  onMediaDimensions?: (dimensions: MediaDimensions) => void
}

export type GenerationNodeExecutor = (
  node: GenerationCanvasNode,
  context: GenerationNodeExecutorContext,
) => Promise<GenerationNodeResult>

export const generationNodeExecutor: GenerationNodeExecutor = async (node, context) => {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  const onProgress = context.onProgress
  const projectTarget = context.projectTarget
  // gate = 付费相关透传（单镜 Run 号 + 幂等键），随各付费 action 一路进 buildCatalogTaskRequest 与「交」。
  const gate = {
    referenceContext: { nodes: context.nodes, edges: context.edges },
    projectTarget,
    ...(context.canvasRun ? { canvasRun: context.canvasRun } : {}),
    ...(context.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
    ...(context.anonymousAssetHostingConsent ? { anonymousAssetHostingConsent: context.anonymousAssetHostingConsent } : {}),
    ...(context.promptSuffix ? { promptSuffix: context.promptSuffix } : {}),
  }
  if (executionKind === 'image') {
    const references = resolveGenerationReferences(node, context)
    const promptNode = withConnectedTextPrompts(node, context)
    return generateImage(promptNode, { references, ...gate, ...(onProgress ? { onProgress } : {}), ...(context.onMediaDimensions ? { onMediaDimensions: context.onMediaDimensions } : {}) })
  }
  if (executionKind === 'video') {
    const references = resolveGenerationReferences(node, context)
    const promptNode = withConnectedTextPrompts(node, context)
    return generateVideo(promptNode, { references, ...gate, ...(onProgress ? { onProgress } : {}), ...(context.onMediaDimensions ? { onMediaDimensions: context.onMediaDimensions } : {}) })
  }
  if (executionKind === 'text') {
    return generateText(node, { projectTarget, referenceContext: gate.referenceContext, ...(onProgress ? { onProgress } : {}) })
  }
  if (executionKind === 'audio') {
    const references = resolveGenerationReferences(node, context)
    return generateAudio(node, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  if (executionKind === 'model3d') {
    const references = resolveGenerationReferences(node, context)
    // 连线文本节点同样并入 prompt（与 image/video 同口径）——isTextPromptEdge 已把 text→3D 归类为 prompt 上下文边。
    const promptNode = withConnectedTextPrompts(node, context)
    return generate3D(promptNode, { references, ...gate, ...(onProgress ? { onProgress } : {}) })
  }
  throw new Error(`${node.kind} generation is not implemented yet`)
}

export const placeholderGenerationNodeExecutor = generationNodeExecutor
