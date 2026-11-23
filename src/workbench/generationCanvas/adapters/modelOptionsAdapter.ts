import { peekCatalogModelOptions } from '../../../config/modelCatalogCache'
import {
  deriveModelCatalogStatus,
  findModelOptionByIdentifier as findCatalogModelOptionByIdentifier,
  useModelOptions,
  useModelOptionsState,
  type ModelOptionsState,
} from '../../../config/useModelOptions'
import type { ModelOption, NodeKind } from '../../../config/models'
import type { ProfileKind } from '../../api/modelCatalogApi'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeCatalogKind } from '../model/generationNodeKinds'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { resolveTaskKind } from '../runner/catalogTaskResolve'

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
  vendor?: string | null | undefined,
): ModelOption | null {
  return findCatalogModelOptionByIdentifier(options, value, vendor)
}

export function useGenerationModelOptions(kind: GenerationNodeKind, requiredMode?: ProfileKind): ModelOption[] {
  return useModelOptions(toCatalogNodeKind(kind, requiredMode), requiredMode)
}

export function useGenerationModelOptionsState(kind: GenerationNodeKind, requiredMode?: ProfileKind): ModelOptionsState {
  return useModelOptionsState(toCatalogNodeKind(kind, requiredMode), requiredMode)
}

export function deriveGenerationModelCatalogStatus(kind: GenerationNodeKind, state: ModelOptionsState) {
  return deriveModelCatalogStatus({
    kind: toCatalogNodeKind(kind),
    options: state.options,
    health: state.health,
    error: state.error,
    healthError: state.healthError,
    loading: state.loading,
  })
}

function toCatalogNodeKind(kind: GenerationNodeKind, requiredMode?: ProfileKind): NodeKind {
  if (requiredMode === 'image_edit') return 'imageEdit'
  return getGenerationNodeCatalogKind(kind)
}

export function requiredModeForGenerationNode(
  node: GenerationCanvasNode,
  context: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] } = {},
): ProfileKind {
  try {
    return resolveTaskKind(node, resolveGenerationReferences(node, context)) as ProfileKind
  } catch {
    const kind = getGenerationNodeCatalogKind(node.kind)
    if (kind === 'image') return 'text_to_image'
    if (kind === 'video') return 'text_to_video'
    if (kind === 'audio') return 'text_to_audio'
    if (kind === 'model3d') return 'text_to_3d'
    return 'chat'
  }
}

/**
 * 此刻这个节点的生成框拿到的那份模型清单——**同步**读目录缓存（没载入 → null，不触发请求）。
 * 取法和生成框（NodeGenerationComposer 的 `useGenerationModelOptionsState(node.kind, requiredMode)`）是同一个：
 * 按节点**当前生成方式**取（接了参考就是图生视频），不是按种类的默认方式。只发布「图生视频」的模型
 * （Runway Gen-4 Turbo、Vidu Q3）只在图生视频那份清单里，按默认方式（文生视频）取会找不到它。
 */
export function peekGenerationNodeModelOptions(
  node: GenerationCanvasNode,
  context: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] },
): ModelOption[] | null {
  const requiredMode = requiredModeForGenerationNode(node, context)
  return peekCatalogModelOptions(toCatalogNodeKind(node.kind, requiredMode), requiredMode)
}

